"""Testes do módulo isolado Materiais por Cliente.

Regras principais:
- o nome do cliente é texto livre (não cria nem altera `clientes`);
- cada registro é um material com categoria, quantidade e descrição;
- o módulo não escreve em nenhuma outra tabela.
"""


def _payload(**kwargs):
    base = {
        "cliente_nome": "HERMES JOSE BERSAGHI",
        "categoria": "cabo",
        "quantidade": 1064.35,
        "descricao": "CABO COBERTO AL XPE 25KV 35MM2 RURAL",
    }
    base.update(kwargs)
    return base


def test_criar_material_com_cliente_fora_do_cadastro(materiais_client, db_fake):
    clientes_antes = len(db_fake._dados["clientes"])

    resp = materiais_client.post("/api/materiais/", json=_payload())

    assert resp.status_code == 201, resp.text
    corpo = resp.json()
    assert corpo["id"] > 0
    assert corpo["cliente_nome"] == "HERMES JOSE BERSAGHI"
    assert corpo["categoria"] == "cabo"
    assert corpo["quantidade"] == 1064.35
    assert corpo["descricao"] == "CABO COBERTO AL XPE 25KV 35MM2 RURAL"
    # Sem FK: o cadastro de clientes permanece intocado.
    assert len(db_fake._dados["clientes"]) == clientes_antes


def test_listar_com_filtros_de_cliente_categoria_e_busca(materiais_client):
    materiais_client.post("/api/materiais/", json=_payload())
    materiais_client.post(
        "/api/materiais/",
        json=_payload(categoria="poste", quantidade=3, descricao="POSTE CONCRETO DT 11M 300DAN"),
    )
    materiais_client.post(
        "/api/materiais/",
        json=_payload(cliente_nome="AGRO Z LTDA", categoria="trafo", quantidade=1, descricao="TD 3F 75KVA"),
    )

    por_cliente = materiais_client.get("/api/materiais/?cliente=hermes").json()
    assert len(por_cliente) == 2
    assert {m["cliente_nome"] for m in por_cliente} == {"HERMES JOSE BERSAGHI"}

    por_categoria = materiais_client.get("/api/materiais/?categoria=trafo").json()
    assert [m["categoria"] for m in por_categoria] == ["trafo"]

    por_busca = materiais_client.get("/api/materiais/?busca=75kva").json()
    assert len(por_busca) == 1
    assert por_busca[0]["cliente_nome"] == "AGRO Z LTDA"


def test_listagem_ordena_por_cliente_e_categoria(materiais_client):
    materiais_client.post("/api/materiais/", json=_payload(cliente_nome="ZETA", categoria="trafo"))
    materiais_client.post("/api/materiais/", json=_payload(cliente_nome="ALFA", categoria="poste"))
    materiais_client.post("/api/materiais/", json=_payload(cliente_nome="ALFA", categoria="cabo"))

    lista = materiais_client.get("/api/materiais/").json()
    assert [(m["cliente_nome"], m["categoria"]) for m in lista] == [
        ("ALFA", "cabo"),
        ("ALFA", "poste"),
        ("ZETA", "trafo"),
    ]


def test_atualizar_material(materiais_client):
    criado = materiais_client.post("/api/materiais/", json=_payload()).json()

    resp = materiais_client.put(
        f"/api/materiais/{criado['id']}",
        json=_payload(quantidade=80, descricao="CABO MULTIPLEX AL 3X1X10+10MM2 0,6/1KV"),
    )

    assert resp.status_code == 200, resp.text
    corpo = resp.json()
    assert corpo["quantidade"] == 80
    assert corpo["descricao"] == "CABO MULTIPLEX AL 3X1X10+10MM2 0,6/1KV"
    assert corpo["cliente_nome"] == "HERMES JOSE BERSAGHI"


def test_buscar_e_excluir_material(materiais_client):
    criado = materiais_client.post("/api/materiais/", json=_payload()).json()

    detalhe = materiais_client.get(f"/api/materiais/{criado['id']}")
    assert detalhe.status_code == 200
    assert detalhe.json()["id"] == criado["id"]

    resp = materiais_client.delete(f"/api/materiais/{criado['id']}")
    assert resp.status_code == 200

    assert materiais_client.get(f"/api/materiais/{criado['id']}").status_code == 404
    assert materiais_client.get("/api/materiais/").json() == []


def test_material_inexistente_retorna_404(materiais_client):
    assert materiais_client.get("/api/materiais/999").status_code == 404
    assert materiais_client.delete("/api/materiais/999").status_code == 404
    assert materiais_client.put("/api/materiais/999", json=_payload()).status_code == 404


def test_validacoes_de_categoria_quantidade_e_texto(materiais_client):
    assert materiais_client.post("/api/materiais/", json=_payload(categoria="outro")).status_code == 422
    assert materiais_client.post("/api/materiais/", json=_payload(quantidade=0)).status_code == 422
    assert materiais_client.post("/api/materiais/", json=_payload(quantidade=-1)).status_code == 422
    assert materiais_client.post("/api/materiais/", json=_payload(cliente_nome="   ")).status_code == 422
    assert materiais_client.post("/api/materiais/", json=_payload(descricao="   ")).status_code == 422


def test_categoria_invalida_no_filtro_retorna_400(materiais_client):
    resp = materiais_client.get("/api/materiais/?categoria=outro")
    assert resp.status_code == 400


def test_descricao_longa_multilinha_e_quantidade_decimal(materiais_client):
    descricao = "CABO COBERTO AL XPE 25KV 35MM2 RURAL\n" + ("DESCRIÇÃO COMPLEMENTAR " * 40)

    resp = materiais_client.post(
        "/api/materiais/",
        json=_payload(descricao=descricao, quantidade=123456789.123),
    )

    assert resp.status_code == 201, resp.text
    corpo = resp.json()
    assert corpo["descricao"] == descricao.strip()
    assert corpo["quantidade"] == 123456789.123


def test_sem_permissao_retorna_403(os_gestor_client):
    assert os_gestor_client.get("/api/materiais/").status_code == 403
    assert os_gestor_client.post("/api/materiais/", json=_payload()).status_code == 403


def test_modulo_nao_altera_outras_tabelas(materiais_client, db_fake):
    snapshot = {
        tabela: len(linhas)
        for tabela, linhas in db_fake._dados.items()
        if tabela != "materiais"
    }

    materiais_client.post("/api/materiais/", json=_payload())
    criado = materiais_client.get("/api/materiais/").json()[0]
    materiais_client.put(f"/api/materiais/{criado['id']}", json=_payload(quantidade=2))
    materiais_client.delete(f"/api/materiais/{criado['id']}")

    depois = {
        tabela: len(linhas)
        for tabela, linhas in db_fake._dados.items()
        if tabela != "materiais"
    }
    assert depois == snapshot
