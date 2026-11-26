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
        {
            "id": 1,
            "atividade_id": 1,
            "nome": "Inspeção de Segurança",
            "ativo": True,
            "descricao": None,
            "tipo_resposta": "conforme_nao_conforme_na",
            "tipo_servico": None,
        }
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


def _seed_modelo_sim_nao(db_fake):
    db_fake._dados["inspecao_modelos"].append(
        {
            "id": 2,
            "atividade_id": 1,
            "nome": "Inspeção de Segurança do Caminhão Guindauto",
            "ativo": True,
            "descricao": "Checklist do SESMT",
            "tipo_resposta": "sim_nao_na",
            "tipo_servico": "Guindauto",
        }
    )
    db_fake._dados["inspecao_modelo_grupos"].append(
        {"id": 2, "modelo_id": 2, "ordem": 1, "nome": "Guindauto"}
    )
    db_fake._dados["inspecao_modelo_itens"].extend(
        [
            {
                "id": 3,
                "modelo_id": 2,
                "grupo_id": 2,
                "ordem": 1,
                "classificacao": "1.1",
                "pergunta": "Operador possui certificado?",
                "exige_foto": False,
                "ativo": True,
            },
            {
                "id": 4,
                "modelo_id": 2,
                "grupo_id": 2,
                "ordem": 2,
                "classificacao": "1.2",
                "pergunta": "As lanças apresentam rachaduras?",
                "exige_foto": False,
                "ativo": True,
            },
        ]
    )


def test_modelo_sim_nao_na_aceita_respostas_e_pdf_com_colunas_corretas(
    inspecoes_campo_client, db_fake
):
    import pymupdf

    _seed_base(db_fake)
    _seed_modelo_sim_nao(db_fake)
    resp = inspecoes_campo_client.post(
        "/api/inspecoes/",
        json=_payload_inspecao(modelo_id=2),
    )
    assert resp.status_code == 201, resp.text
    detalhe = resp.json()
    assert detalhe["inspecao"]["tipo_resposta"] == "sim_nao_na"
    assert detalhe["inspecao"]["tipo_servico"] == "Guindauto"
    inspecao_id = detalhe["inspecao"]["id"]
    itens = {item["classificacao"]: item["id"] for item in detalhe["itens"]}

    # O formato Sim/Não/N/A não aceita "conforme".
    resp = inspecoes_campo_client.put(
        f"/api/inspecoes/{inspecao_id}/respostas/{itens['1.1']}",
        json={"resposta": "conforme"},
    )
    assert resp.status_code == 400

    resp = inspecoes_campo_client.put(
        f"/api/inspecoes/{inspecao_id}/respostas/{itens['1.1']}",
        json={"resposta": "sim"},
    )
    assert resp.status_code == 200, resp.text
    resp = inspecoes_campo_client.put(
        f"/api/inspecoes/{inspecao_id}/respostas/{itens['1.2']}",
        json={"resposta": "nao"},
    )
    assert resp.status_code == 200, resp.text

    # "Não" em pergunta negativa não é não conformidade e não exige observação.
    resp = inspecoes_campo_client.post(f"/api/inspecoes/{inspecao_id}/finalizar")
    assert resp.status_code == 200, resp.text
    assert resp.json()["inspecao"]["status"] == "concluida"

    resp = inspecoes_campo_client.get(f"/api/inspecoes/{inspecao_id}/pdf")
    assert resp.status_code == 200, resp.text
    doc = pymupdf.open(stream=resp.content, filetype="pdf")
    texto = "\n".join(pagina.get_text() for pagina in doc)
    assert "Sim" in texto
    assert "Não" in texto
    assert "Tipo de serviço" in texto
    assert "Guindauto" in texto
    assert "TÉCNICO DE SEGURANÇA DO TRABALHO" in texto
    assert "RESPONSÁVEL EMPRESA" in texto


def test_pdf_limita_seis_fotos_por_pagina_e_mantem_ordem_das_secoes():
    import os

    import pymupdf

    from utils.pdf_inspecao import gerar_pdf_inspecao

    def imagem_png(indice: int) -> bytes:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 30), 0)
        pix.set_rect(pix.irect, ((40 + indice * 15) % 255, (90 + indice * 7) % 255, 160))
        return pix.tobytes("png")

    fotos = {f"foto-{i}": imagem_png(i) for i in range(13)}
    itens = [
        {
            "grupo_ordem": 1,
            "grupo_nome": "Guindauto",
            "ordem": i + 1,
            "classificacao": f"1.{i + 1}",
            "pergunta": f"Foto de evidência {i + 1}",
            "resposta": {"resposta": "sim", "observacao": None, "criado_em": "2026-11-27T10:35:00-03:00"},
            "fotos": [
                {
                    "bucket_key": f"foto-{i}",
                    "mime_type": "image/png",
                    "capturado_em": "2026-11-27T10:36:00-03:00",
                }
            ],
        }
        for i in range(13)
    ]
    inspecao = {
        "codigo": "INS-2026-0099",
        "modelo_nome": "Inspeção de Segurança do Caminhão Guindauto",
        "atividade_nome": "Segurança",
        "tipo_servico": "Guindauto",
        "tipo_resposta": "sim_nao_na",
        "status": "concluida",
        "iniciada_em": "2026-11-27T10:30:00-03:00",
        "inspetor_nome": "Técnico Campo",
        "encarregado": "João Técnico",
        "local_inspecao": "Concórdia",
        "observacoes": "Fotos para conferência.",
    }

    caminho = gerar_pdf_inspecao(
        inspecao=inspecao,
        itens=itens,
        assinantes=[],
        baixar_foto=lambda chave: fotos.get(chave),
    )
    doc = None
    try:
        doc = pymupdf.open(caminho)
        textos = [pagina.get_text() for pagina in doc]
        logo_xref = doc[0].get_images(full=True)[0][0]
        fotos_por_pagina = [
            len([img for img in pagina.get_images(full=True) if img[0] != logo_xref])
            for pagina in doc
        ]
        assert sum(fotos_por_pagina) == 13
        assert max(fotos_por_pagina) == 6

        indice_observacoes = next(i for i, texto in enumerate(textos) if "OBSERVAÇÕES" in texto)
        indice_fotos = next(i for i, texto in enumerate(textos) if "EVIDÊNCIAS FOTOGRÁFICAS" in texto)
        indice_assinaturas = next(i for i, texto in enumerate(textos) if "ASSINATURAS" in texto)
        assert indice_observacoes <= indice_fotos <= indice_assinaturas
    finally:
        if doc is not None:
            doc.close()
        os.remove(caminho)
