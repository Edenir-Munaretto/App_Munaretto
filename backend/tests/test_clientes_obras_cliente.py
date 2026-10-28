"""Testes das obras adicionais do cliente (tabela isolada `obras_cliente`).

Regra: o cliente continua único por CPF; as obras adicionais ficam em uma
tabela própria e NÃO são gravadas em `obras` (módulo O.S).
"""


def _obra_payload(**overrides):
    dados = {
        "nome": "Obra Secundária",
        "nota_ps": "PS-002",
        "endereco": "Av. Brasil, 500",
        "cidade": "Luzerna",
        "cep": "89609-000",
        "valor_da_obra": "40.000,00",
        "valor_de_devolucao": "1.200,00",
    }
    dados.update(overrides)
    return dados


def _criar_obra(client, cliente_id=1, **overrides):
    resp = client.post(f"/api/clientes/{cliente_id}/obras", json=_obra_payload(**overrides))
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_mesmo_cpf_continua_bloqueado(clientes_client):
    repetido = clientes_client.post(
        "/api/clientes/",
        json={
            "nome": "Outro nome",
            "cpf_cnpj": "12345678901",
            "endereco": "Rua B, 200",
        },
    )
    assert repetido.status_code == 400
    assert "CPF/CNPJ" in repetido.json()["detail"]


def test_cliente_pode_ter_varias_obras_sem_tocar_no_os(clientes_client, db_fake):
    obras_os_antes = list(db_fake._dados.get("obras", []))

    primeira = _criar_obra(clientes_client)
    segunda = _criar_obra(
        clientes_client,
        nome="Obra Bairro Novo",
        nota_ps="PS-003",
        endereco="Rua C, 300",
        cidade="Joaçaba",
        valor_da_obra="55.000,00",
    )

    assert primeira["cliente_id"] == 1
    assert segunda["cliente_id"] == 1
    assert primeira["id"] != segunda["id"]

    lista = clientes_client.get("/api/clientes/1/obras")
    assert lista.status_code == 200, lista.text
    obras = lista.json()
    assert [o["nota_ps"] for o in obras] == ["PS-002", "PS-003"]
    assert obras[1]["valor_da_obra"] == "55.000,00"

    # A tabela do módulo O.S permanece intocada.
    assert db_fake._dados.get("obras", []) == obras_os_antes


def test_obra_de_outro_cliente_nao_pode_ser_alterada(clientes_client, db_fake):
    db_fake._dados["clientes"].append(
        {
            "id": 2,
            "nome": "Outro Cliente",
            "cpf_cnpj": "00000000000",
            "endereco": "Rua D, 400",
            "ativo": True,
        }
    )
    obra = _criar_obra(clientes_client)

    resp = clientes_client.put(
        f"/api/clientes/2/obras/{obra['id']}",
        json=_obra_payload(nome="Tentativa indevida"),
    )
    assert resp.status_code == 404

    resp = clientes_client.delete(f"/api/clientes/2/obras/{obra['id']}")
    assert resp.status_code == 404

    assert len(clientes_client.get("/api/clientes/1/obras").json()) == 1


def test_excluir_obra_faz_soft_delete(clientes_client):
    obra = _criar_obra(clientes_client)

    resp = clientes_client.delete(f"/api/clientes/1/obras/{obra['id']}")
    assert resp.status_code == 200, resp.text

    assert clientes_client.get("/api/clientes/1/obras").json() == []
    inativas = clientes_client.get("/api/clientes/1/obras?incluir_inativas=true").json()
    assert len(inativas) == 1
    assert inativas[0]["ativo"] is False
