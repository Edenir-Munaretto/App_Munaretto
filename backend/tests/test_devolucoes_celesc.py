"""Testes do módulo Devoluções Celesc (CRUD + status calculado).

Regra de negócio: sem data de devolução o status é "Aberto"; ao preencher a
data de devolução o status passa a "Fechado" (calculado em tempo de leitura).
"""


def _payload(**kwargs):
    base = {
        "consumidor": "João da Silva",
        "nota_ps": "PS-123",
        "data_entrega": "2026-01-10",
        "data_devolucao": None,
    }
    base.update(kwargs)
    return base


def test_criar_devolucao_nasce_aberta(devolucoes_client):
    resp = devolucoes_client.post("/api/devolucoes-celesc/", json=_payload())
    assert resp.status_code == 201, resp.text
    corpo = resp.json()
    assert corpo["id"] > 0
    assert corpo["status"] == "Aberto"
    assert corpo["data_devolucao"] is None


def test_preencher_data_devolucao_fecha_registro(devolucoes_client):
    criada = devolucoes_client.post("/api/devolucoes-celesc/", json=_payload()).json()

    resp = devolucoes_client.put(
        f"/api/devolucoes-celesc/{criada['id']}",
        json=_payload(data_devolucao="2026-01-20"),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "Fechado"

    listagem = devolucoes_client.get("/api/devolucoes-celesc/").json()
    assert listagem[0]["status"] == "Fechado"


def test_filtro_por_status(devolucoes_client):
    devolucoes_client.post("/api/devolucoes-celesc/", json=_payload(consumidor="Aberto Um"))
    devolucoes_client.post(
        "/api/devolucoes-celesc/",
        json=_payload(consumidor="Fechado Um", data_devolucao="2026-02-01"),
    )

    abertos = devolucoes_client.get("/api/devolucoes-celesc/?status=Aberto").json()
    assert [d["consumidor"] for d in abertos] == ["Aberto Um"]

    fechados = devolucoes_client.get("/api/devolucoes-celesc/?status=Fechado").json()
    assert [d["consumidor"] for d in fechados] == ["Fechado Um"]


def test_busca_por_consumidor_e_nota_ps(devolucoes_client):
    devolucoes_client.post(
        "/api/devolucoes-celesc/",
        json=_payload(consumidor="Maria Souza", nota_ps="PS-999"),
    )
    devolucoes_client.post(
        "/api/devolucoes-celesc/",
        json=_payload(consumidor="Carlos Lima", nota_ps="PS-111"),
    )

    por_nome = devolucoes_client.get("/api/devolucoes-celesc/?busca=Maria").json()
    assert [d["consumidor"] for d in por_nome] == ["Maria Souza"]

    por_nota = devolucoes_client.get("/api/devolucoes-celesc/?busca=PS-111").json()
    assert [d["consumidor"] for d in por_nota] == ["Carlos Lima"]


def test_status_invalido_retorna_400(devolucoes_client):
    resp = devolucoes_client.get("/api/devolucoes-celesc/?status=Pendente")
    assert resp.status_code == 400


def test_data_devolucao_anterior_a_entrega_retorna_400(devolucoes_client):
    resp = devolucoes_client.post(
        "/api/devolucoes-celesc/",
        json=_payload(data_entrega="2026-03-10", data_devolucao="2026-03-01"),
    )
    assert resp.status_code == 400
    assert "anterior" in resp.json()["detail"]


def test_data_entrega_invalida_retorna_400(devolucoes_client):
    resp = devolucoes_client.post("/api/devolucoes-celesc/", json=_payload(data_entrega="10/03/2026"))
    assert resp.status_code == 400


def test_excluir_devolucao(devolucoes_client):
    criada = devolucoes_client.post("/api/devolucoes-celesc/", json=_payload()).json()

    resp = devolucoes_client.delete(f"/api/devolucoes-celesc/{criada['id']}")
    assert resp.status_code == 200

    assert devolucoes_client.get("/api/devolucoes-celesc/").json() == []


def test_sem_permissao_nao_acessa(client):
    resp = client.get("/api/devolucoes-celesc/")
    assert resp.status_code in (401, 403)
