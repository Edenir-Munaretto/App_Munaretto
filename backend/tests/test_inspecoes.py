"""Testes do módulo Inspeções (API online + sincronização offline)."""

import pytest


def _seed_base(db_fake):
    db_fake._dados["funcionarios"].extend(
        [
            {"id": 10, "nome": "João Técnico", "ativo": True, "desligado": False, "excluido": False, "cargo_id": 1},
            {"id": 11, "nome": "Maria Técnica", "ativo": True, "desligado": False, "excluido": False, "cargo_id": 2},
        ]
    )
    db_fake._dados["cargos"].extend(
        [
            {"id": 1, "nome": "Eletricista"},
            {"id": 2, "nome": "Engenheira de Segurança"},
        ]
    )
    db_fake._dados["obras"].append(
        {
            "id": 7,
            "nome": "Obra Centro",
            "endereco": "Rua das Flores, 100",
            "cidade": "Concórdia",
            "ativo": True,
            "cliente_celesc": None,
            "clientes": {"nome": "Cliente Teste"},
        }
    )
    db_fake._dados["equipes"].append({"id": 5, "nome": "Equipe A", "numero": "101", "ativa": True})
    db_fake._dados["equipe_membros"].extend(
        [
            {"id": 1, "equipe_id": 5, "funcionario_id": 10, "lider": True},
            {"id": 2, "equipe_id": 5, "funcionario_id": 11, "lider": False},
        ]
    )
    db_fake._dados["inspecao_atividades"].append({"id": 1, "nome": "Segurança", "ativo": True})
    db_fake._dados["inspecao_modelos"].append(
        {"id": 1, "atividade_id": 1, "nome": "Inspeção de Segurança", "ativo": True, "descricao": None}
    )
    db_fake._dados["inspecao_modelo_grupos"].append(
        {"id": 1, "modelo_id": 1, "ordem": 1, "nome": "Verificações"}
    )
    db_fake._dados["inspecao_modelo_itens"].extend(
        [
            {
                "id": 1,
                "modelo_id": 1,
                "grupo_id": 1,
                "ordem": 1,
                "classificacao": "1.1",
                "pergunta": "EPIs conferidos?",
                "exige_foto": False,
                "ativo": True,
            },
            {
                "id": 2,
                "modelo_id": 1,
                "grupo_id": 1,
                "ordem": 2,
                "classificacao": "1.2",
                "pergunta": "Área sinalizada?",
                "exige_foto": True,
                "ativo": True,
            },
        ]
    )


def _payload_inspecao(**overrides):
    dados = {
        "atividade_id": 1,
        "modelo_id": 1,
        "obra_id": 7,
        "funcionario_id": 10,
        "equipe_id": 5,
        "local_inspecao": "Rua Comandante Caleffi, 55",
        "data_inspecao": "2026-11-26",
        "veiculo": "Caminhonete",
        "setor": "Segurança",
        "observacoes": "Inspeção de rotina",
        "assinantes": [],
    }
    dados.update(overrides)
    return dados


class _FakeS3:
    def put_object(self, **kwargs):
        return None

    def get_object(self, Bucket=None, Key=None):
        class _Corpo:
            def read(self):
                return b"\xff\xd8\xff\xe0fake.jpg"

        return {"Body": _Corpo()}

    def delete_object(self, **kwargs):
        return None

    def generate_presigned_url(self, operacao, Params=None, ExpiresIn=None):
        return f"https://presigned.invalido/{Params['Key']}"


def test_opcoes_traz_cadastros_para_o_formulario(inspecoes_campo_client, db_fake):
    _seed_base(db_fake)
    resp = inspecoes_campo_client.get("/api/inspecoes/opcoes")
    assert resp.status_code == 200, resp.text
    dados = resp.json()
    assert dados["atividades"][0]["nome"] == "Segurança"
    assert dados["modelos"][0]["itens"][0]["classificacao"] == "1.1"
    assert dados["obras"][0]["nome"] == "Obra Centro"
    assert dados["equipes"][0]["membros"][0]["nome"] == "João Técnico"


def test_gestor_cadastra_atividade_e_modelo(inspecoes_gestor_client, db_fake):
    _seed_base(db_fake)
    resp = inspecoes_gestor_client.post(
        "/api/inspecoes/atividades",
        json={"nome": "Meio Ambiente", "ativo": True},
    )
    assert resp.status_code == 201, resp.text
    atividade_id = resp.json()["id"]

    resp = inspecoes_gestor_client.post(
        "/api/inspecoes/modelos",
        json={
            "atividade_id": atividade_id,
            "nome": "Inspeção Ambiental",
            "grupos": [
                {
                    "ordem": 1,
                    "nome": "Resíduos",
                    "itens": [
                        {
                            "grupo_ordem": 1,
                            "grupo_nome": "Resíduos",
                            "ordem": 1,
                            "classificacao": "1.1",
                            "pergunta": "Resíduos segregados?",
                            "exige_foto": True,
                        }
                    ],
                }
            ],
        },
    )
    assert resp.status_code == 201, resp.text
    modelo = resp.json()
    assert modelo["modelo"]["nome"] == "Inspeção Ambiental"
    assert modelo["itens"][0]["pergunta"] == "Resíduos segregados?"


def test_campo_ve_apenas_as_proprias_inspecoes(inspecoes_campo_client, inspecoes_gestor_client, db_fake):
    _seed_base(db_fake)
    resp = inspecoes_campo_client.post("/api/inspecoes/", json=_payload_inspecao())
    assert resp.status_code == 201, resp.text
    inspecao_campo = resp.json()["inspecao"]

    resp = inspecoes_gestor_client.post("/api/inspecoes/", json=_payload_inspecao())
    assert resp.status_code == 201, resp.text

    lista_campo = inspecoes_campo_client.get("/api/inspecoes/").json()
    assert [item["id"] for item in lista_campo] == [inspecao_campo["id"]]

    lista_gestor = inspecoes_gestor_client.get("/api/inspecoes/").json()
    assert len(lista_gestor) == 2

    outra = lista_gestor[0]
    assert inspecoes_campo_client.get(f"/api/inspecoes/{outra['id']}").status_code == 403


def test_finalizacao_bloqueia_sem_resposta_e_com_foto_obrigatoria(
    inspecoes_campo_client, db_fake, monkeypatch
):
    _seed_base(db_fake)
    resp = inspecoes_campo_client.post("/api/inspecoes/", json=_payload_inspecao())
    assert resp.status_code == 201, resp.text
    detalhe = resp.json()
    inspecao_id = detalhe["inspecao"]["id"]
    itens = {item["classificacao"]: item["id"] for item in detalhe["itens"]}

    resp = inspecoes_campo_client.post(f"/api/inspecoes/{inspecao_id}/finalizar")
    assert resp.status_code == 400
    assert "sem resposta" in resp.json()["detail"]

    for classificacao in ("1.1", "1.2"):
        resp = inspecoes_campo_client.put(
            f"/api/inspecoes/{inspecao_id}/respostas/{itens[classificacao]}",
            json={"resposta": "conforme"},
        )
        assert resp.status_code == 200, resp.text
    resp = inspecoes_campo_client.post(f"/api/inspecoes/{inspecao_id}/finalizar")
    assert resp.status_code == 400
    assert "foto obrigatória" in resp.json()["detail"]

    fake = _FakeS3()
    monkeypatch.setattr("routers.inspecoes.get_s3_client", lambda: fake)
    monkeypatch.setattr("routers.inspecoes.bucket", lambda: "bucket-teste")
    resp = inspecoes_campo_client.post(
        f"/api/inspecoes/{inspecao_id}/fotos",
        data={"classificacao": "1.2", "id_local": "foto-1", "dispositivo": "tablet-1"},
        files={"arquivo": ("evidencia.jpg", b"\xff\xd8\xff\xe0teste", "image/jpeg")},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["url_temporaria"].startswith("https://presigned.invalido/")

    resp = inspecoes_campo_client.post(f"/api/inspecoes/{inspecao_id}/finalizar")
    assert resp.status_code == 200, resp.text
    assert resp.json()["inspecao"]["status"] == "concluida"

    resp = inspecoes_campo_client.put(
        f"/api/inspecoes/{inspecao_id}/respostas/{itens['1.1']}",
        json={"resposta": "na"},
    )
    assert resp.status_code == 409


def test_sincronizacao_cria_atualiza_e_finaliza_idempotente(inspecoes_campo_client, db_fake):
    _seed_base(db_fake)
    operacao_criar = {
        "operacoes": [
            {
                "id_local": "insp-local-1",
                "tipo": "criar_inspecao",
                "payload": _payload_inspecao(),
            }
        ],
        "dispositivo": "tablet-1",
    }
    resp = inspecoes_campo_client.post("/api/inspecoes/sincronizar", json=operacao_criar)
    assert resp.status_code == 200, resp.text
    resultado = resp.json()["resultados"][0]
    assert resultado["ok"] is True
    inspecao_id = resultado["inspecao_id"]

    resp = inspecoes_campo_client.post("/api/inspecoes/sincronizar", json=operacao_criar)
    assert resp.status_code == 200, resp.text
    repetido = resp.json()["resultados"][0]
    assert repetido["duplicada"] is True
    assert repetido["inspecao_id"] == inspecao_id
    assert len(db_fake._dados["inspecoes"]) == 1

    operacao_salvar = {
        "operacoes": [
            {
                "id_local": "insp-estado-1",
                "tipo": "salvar_inspecao",
                "inspecao_id": inspecao_id,
                "payload": {
                    "itens": [
                        {"classificacao": "1.1", "resposta": "conforme"},
                        {
                            "classificacao": "1.2",
                            "resposta": "nao_conforme",
                            "observacao": "Área sem sinalização",
                        },
                    ]
                },
            }
        ],
        "dispositivo": "tablet-1",
    }
    resp = inspecoes_campo_client.post("/api/inspecoes/sincronizar", json=operacao_salvar)
    assert resp.status_code == 200, resp.text
    assert resp.json()["resultados"][0]["ok"] is True, resp.json()

    resp = inspecoes_campo_client.get(f"/api/inspecoes/{inspecao_id}").json()
    respostas = {i["classificacao"]: i["resposta"]["resposta"] for i in resp["itens"] if i.get("resposta")}
    assert respostas == {"1.1": "conforme", "1.2": "nao_conforme"}

    resp = inspecoes_campo_client.post(
        "/api/inspecoes/sincronizar",
        json={
            "operacoes": [
                {
                    "id_local": "insp-final-1",
                    "tipo": "finalizar_inspecao",
                    "inspecao_id": inspecao_id,
                }
            ],
            "dispositivo": "tablet-1",
        },
    )
    assert resp.status_code == 200, resp.text
    final = resp.json()["resultados"][0]
    assert final["ok"] is False
    assert "foto obrigatória" in final["erro"]


def test_resumo_da_obra_conta_inspecoes(inspecoes_gestor_client, os_gestor_client, db_fake):
    _seed_base(db_fake)
    resp = inspecoes_gestor_client.post("/api/inspecoes/", json=_payload_inspecao())
    assert resp.status_code == 201, resp.text
    inspecao_id = resp.json()["inspecao"]["id"]
    db_fake._dados["inspecoes"][0]["status"] = "concluida"

    resp = os_gestor_client.get("/api/os/obras/7/resumo")
    assert resp.status_code == 200, resp.text
    resumo = resp.json()["resumo"]
    assert resumo["inspecoes_total"] == 1
    assert resumo["inspecoes_concluidas"] == 1
    assert inspecao_id == db_fake._dados["inspecoes"][0]["id"]


def test_pdf_da_inspecao_sem_fotos(inspecoes_campo_client, db_fake):
    _seed_base(db_fake)
    resp = inspecoes_campo_client.post("/api/inspecoes/", json=_payload_inspecao())
    assert resp.status_code == 201, resp.text
    inspecao_id = resp.json()["inspecao"]["id"]

    resp = inspecoes_campo_client.get(f"/api/inspecoes/{inspecao_id}/pdf")
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/pdf")
    assert resp.content.startswith(b"%PDF")


@pytest.mark.parametrize("campo", ["local_inspecao"])
def test_criacao_exige_local(inspecoes_campo_client, db_fake, campo):
    _seed_base(db_fake)
    payload = _payload_inspecao()
    payload.pop(campo, None)
    resp = inspecoes_campo_client.post("/api/inspecoes/", json=payload)
    assert resp.status_code == 422
