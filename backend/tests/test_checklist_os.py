"""Testes do Checklist de Execução da O.S.

Cobre:
- Snapshot do catálogo para a O.S ao criar;
- Gate de início (aberta -> em_andamento e Play do cronômetro) exige grupo 1;
- Gate de conclusão exige todos os grupos;
- Resposta 'Não' exige justificativa; N/A é aceito;
- Respostas não podem ser alteradas em O.S encerrada;
- Relatório em PDF é gerado.
"""


def _seed_modelos(db_fake):
    """Catálogo mínimo: 2 itens no grupo 1 e 1 item no grupo 2."""
    db = db_fake._dados
    db["os_checklist_modelos"].extend(
        [
            {"id": 1, "tipo": "geral", "grupo": 1, "ordem": 1, "classificacao": "1.1",
             "pergunta": "O projeto foi conferido?", "exige_foto": False, "ativo": True},
            {"id": 2, "tipo": "geral", "grupo": 1, "ordem": 2, "classificacao": "1.2",
             "pergunta": "Os materiais foram conferidos?", "exige_foto": False, "ativo": True},
            {"id": 3, "tipo": "geral", "grupo": 2, "ordem": 1, "classificacao": "2.1",
             "pergunta": "Equipe verificou o local?", "exige_foto": True, "ativo": True},
        ]
    )


def _responder(client, os_id, item, resposta, justificativa=None, geolocalizacao=None):
    payload = {"resposta": resposta}
    if justificativa is not None:
        payload["justificativa"] = justificativa
    if geolocalizacao:
        payload["geolocalizacao"] = geolocalizacao
    return client.put(f"/api/os/{os_id}/checklist/{item['id']}", json=payload)


def _itens(client, os_id):
    return client.get(f"/api/os/{os_id}/checklist").json()["itens"]


def _itens_grupo(itens, grupo):
    return [i for i in itens if i["grupo"] == grupo]


def _responder_grupo(client, os_id, itens, grupo, resposta="sim"):
    for item in _itens_grupo(itens, grupo):
        r = _responder(client, os_id, item, resposta)
        assert r.status_code == 200, r.text


def test_criar_os_snapshots_o_checklist(os_gestor_client, db_fake):
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    _seed_modelos(db_fake)
    os_id = _criar_os(os_gestor_client).json()["id"]

    itens = db_fake._dados["os_checklist_itens"]
    da_os = [i for i in itens if i["os_id"] == os_id]
    assert len(da_os) == 3
    assert {i["classificacao"] for i in da_os} == {"1.1", "1.2", "2.1"}
    # Snapshot carrega o texto da pergunta
    assert all(i["pergunta"] for i in da_os)


def test_gate_inicio_bloqueia_sem_grupo_1(os_gestor_client, db_fake):
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    _seed_modelos(db_fake)
    os_id = _criar_os(os_gestor_client).json()["id"]
    assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"}).status_code == 200

    resp = os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "em_andamento"})
    assert resp.status_code == 422
    assert "checklist" in resp.json()["detail"].lower()


def test_gate_inicio_libera_com_grupo_1_completo(os_gestor_client, db_fake):
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    _seed_modelos(db_fake)
    os_id = _criar_os(os_gestor_client).json()["id"]
    os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})

    itens = _itens(os_gestor_client, os_id)
    _responder_grupo(os_gestor_client, os_id, itens, 1)

    resp = os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "em_andamento"})
    assert resp.status_code == 200, resp.text


def test_gate_inicio_tambem_bloqueia_play(os_gestor_client, os_campo_client, db_fake):
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    _seed_modelos(db_fake)
    os_id = _criar_os(os_gestor_client, equipe_id=100).json()["id"]
    os_campo_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})

    resp = os_campo_client.post(f"/api/os/{os_id}/apontamentos", json={"acao": "play"})
    assert resp.status_code == 422
    assert "checklist" in resp.json()["detail"].lower()
    # O cronômetro não fica aberto após a recusa
    assert os_campo_client.post(f"/api/os/{os_id}/apontamentos", json={"acao": "play"}).status_code == 422

    # Com o grupo 1 completo, o play promove a O.S para em_andamento.
    itens = _itens(os_gestor_client, os_id)
    _responder_grupo(os_gestor_client, os_id, itens, 1)
    resp = os_campo_client.post(f"/api/os/{os_id}/apontamentos", json={"acao": "play"})
    assert resp.status_code == 200, resp.text
    assert os_campo_client.get(f"/api/os/{os_id}").json()["status"] == "em_andamento"


def _promover_para_execucao(client, os_id):
    """Responde o grupo 1 e promove aberta -> em_andamento."""
    itens = _itens(client, os_id)
    _responder_grupo(client, os_id, itens, 1)
    client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})
    r = client.put(f"/api/os/{os_id}/status", json={"novo_status": "em_andamento"})
    assert r.status_code == 200, r.text
    return itens


def test_gate_conclusao_exige_todos_os_grupos(os_gestor_client, db_fake):
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    _seed_modelos(db_fake)
    os_id = _criar_os(os_gestor_client).json()["id"]
    _promover_para_execucao(os_gestor_client, os_id)  # grupo 2 fica pendente

    resp = os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "concluida"})
    assert resp.status_code == 422
    assert "Checklist" in resp.json()["detail"]
    assert "2.1" in resp.json()["detail"]


def test_concluir_completo_ok(os_gestor_client, db_fake):
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    _seed_modelos(db_fake)
    os_id = _criar_os(os_gestor_client).json()["id"]
    itens = _promover_para_execucao(os_gestor_client, os_id)
    _responder_grupo(os_gestor_client, os_id, itens, 2)

    resp = os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "concluida"})
    assert resp.status_code == 200, resp.text


def test_resposta_nao_exige_justificativa(os_gestor_client, db_fake):
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    _seed_modelos(db_fake)
    os_id = _criar_os(os_gestor_client).json()["id"]
    item = _itens(os_gestor_client, os_id)[0]

    resp = _responder(os_gestor_client, os_id, item, "nao")
    assert resp.status_code == 422
    assert "justificativa" in resp.json()["detail"].lower()

    resp = _responder(os_gestor_client, os_id, item, "nao", justificativa="Material em falta no estoque.")
    assert resp.status_code == 200, resp.text
    # 'Não' com justificativa não bloqueia o início (grupo completo).
    itens = _itens(os_gestor_client, os_id)
    _responder_grupo(os_gestor_client, os_id, itens, 1)
    os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})
    resp = os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "em_andamento"})
    assert resp.status_code == 200, resp.text


def test_resposta_na_aceita(os_gestor_client, db_fake):
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    _seed_modelos(db_fake)
    os_id = _criar_os(os_gestor_client).json()["id"]
    item = _itens(os_gestor_client, os_id)[0]
    resp = _responder(os_gestor_client, os_id, item, "na")
    assert resp.status_code == 200, resp.text


def test_resposta_invalida_rejeitada(os_gestor_client, db_fake):
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    _seed_modelos(db_fake)
    os_id = _criar_os(os_gestor_client).json()["id"]
    item = _itens(os_gestor_client, os_id)[0]
    resp = _responder(os_gestor_client, os_id, item, "talvez")
    assert resp.status_code == 400


def test_nao_altera_checklist_de_os_encerrada(os_gestor_client, db_fake):
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    _seed_modelos(db_fake)
    os_id = _criar_os(os_gestor_client).json()["id"]
    itens = _promover_para_execucao(os_gestor_client, os_id)
    _responder_grupo(os_gestor_client, os_id, itens, 2)
    assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "concluida"}).status_code == 200

    item = _itens(os_gestor_client, os_id)[0]
    resp = _responder(os_gestor_client, os_id, item, "sim")
    assert resp.status_code == 400


def test_resumo_no_detalhe(os_gestor_client, db_fake):
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    _seed_modelos(db_fake)
    os_id = _criar_os(os_gestor_client).json()["id"]

    detalhe = os_gestor_client.get(f"/api/os/{os_id}").json()
    resumo = detalhe["checklist"]
    assert resumo["total"] == 3
    assert resumo["inicio_liberado"] is False
    assert resumo["completo"] is False
    assert len(resumo["grupos"]) == 5
    assert resumo["grupos"][0]["total"] == 2

    itens = _itens(os_gestor_client, os_id)
    _responder_grupo(os_gestor_client, os_id, itens, 1)
    detalhe = os_gestor_client.get(f"/api/os/{os_id}").json()
    assert detalhe["checklist"]["inicio_liberado"] is True


def test_upload_foto_item(os_gestor_client, db_fake, monkeypatch):
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    _seed_modelos(db_fake)
    os_id = _criar_os(os_gestor_client).json()["id"]
    item = next(i for i in _itens(os_gestor_client, os_id) if i["exige_foto"])

    class FakeS3:
        def __init__(self):
            self.objetos = {}

        def put_object(self, **kwargs):
            self.objetos[kwargs["Key"]] = kwargs["Body"]
            return {}

        def delete_object(self, **kwargs):
            self.objetos.pop(kwargs["Key"], None)

        def generate_presigned_url(self, operacao, Params=None, ExpiresIn=None):
            return f"https://presigned.invalido/{Params['Key']}"

    fake = FakeS3()
    monkeypatch.setattr("routers.os.get_s3_client", lambda: fake)
    monkeypatch.setattr("routers.os.bucket", lambda: "bucket-teste")

    resp = os_gestor_client.post(
        f"/api/os/{os_id}/checklist/{item['id']}/foto",
        files={"arquivo": ("foto.jpg", b"\xff\xd8\xff\xe0 fake jpeg", "image/jpeg")},
    )
    assert resp.status_code == 201, resp.text

    itens = _itens(os_gestor_client, os_id)
    item_atualizado = next(i for i in itens if i["id"] == item["id"])
    assert len(item_atualizado["fotos"]) == 1
    assert item_atualizado["fotos"][0]["url_temporaria"].startswith("https://presigned.invalido/")


def test_relatorio_pdf(os_gestor_client, db_fake):
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    _seed_modelos(db_fake)
    os_id = _criar_os(os_gestor_client, equipe_id=100).json()["id"]
    itens = _itens(os_gestor_client, os_id)
    _responder_grupo(os_gestor_client, os_id, itens, 1)
    _responder_grupo(os_gestor_client, os_id, itens, 2)

    resp = os_gestor_client.get(f"/api/os/{os_id}/checklist/report")
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content.startswith(b"%PDF")
