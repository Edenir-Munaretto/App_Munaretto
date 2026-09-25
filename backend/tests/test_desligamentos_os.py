"""Testes da agenda de Desligamentos Celesc.

Cobre:
- Persistência do snapshot ao imprimir a O.S com a Solicitação de Desligamento;
- Reimpressão atualizando o mesmo registro (um por O.S);
- Espelhamento ao editar a O.S, preservando substituto e equipes de apoio;
- Equipes de apoio (definição, validação e filtro);
- Filtros de período/busca e PDF da agenda;
- Remoção da agenda e permissões (gestor apenas).
"""

def _seed(db_fake):
    """Cliente com Nota PS, obra, três equipes e o líder + substituto na Equipe A."""
    db = db_fake._dados
    db["funcionarios"].append({"id": 10, "nome": "Líder de Campo", "cpf": "11111111111", "ativo": True})
    db["funcionarios"].append({"id": 11, "nome": "Membro Substituto", "cpf": "22222222222", "ativo": True})
    db["obras"].append(
        {
            "id": 5,
            "cliente_id": 1,
            "nome": "Obra Central",
            "endereco": "Rua A, 100",
            "cidade": "Concórdia",
            "ativo": True,
            "created_at": "2026-01-01T00:00:00Z",
        }
    )
    db["equipes"].append({"id": 100, "nome": "Equipe A", "numero": "12102", "ativa": True})
    db["equipes"].append({"id": 200, "nome": "Equipe B", "numero": "12204", "ativa": True})
    db["equipes"].append({"id": 300, "nome": "Equipe C", "numero": "12300", "ativa": True})
    db["equipe_membros"].append({"id": 1, "equipe_id": 100, "funcionario_id": 10, "lider": True})
    db["equipe_membros"].append({"id": 2, "equipe_id": 100, "funcionario_id": 11, "lider": False})
    db["clientes"][0]["nota_ps"] = "400774969"


def _criar_os(client, **overrides):
    payload = {
        "obra_id": 5,
        "equipe_id": 100,
        "prioridade": "alta",
        "prazo_entrega": "2026-10-30",
        "descricao_escopo": "LIGAÇÃO NOVA",
        "agencia": "CDA",
        "municipio": "Ponte Serrada",
        "local_servico": "25 DE MAIO",
        "hora_desligar": "13:00",
        "hora_religar": "17:00",
        "alimentador": "FGS01",
        "chave": "FU 82027",
        **overrides,
    }
    resp = client.post("/api/os/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _imprimir_com_desligamento(client, os_id, substituto_id=None):
    params = {"incluir_desligamento": "true"}
    if substituto_id:
        params["substituto_id"] = substituto_id
    return client.get(f"/api/os/{os_id}/imprimir", params=params)


def _agenda(client, params=None):
    return client.get("/api/os/desligamentos/", params=params or {})


def test_impressao_registra_desligamento_na_agenda(os_gestor_client, db_fake):
    _seed(db_fake)
    os_id = _criar_os(os_gestor_client)

    resp = _imprimir_com_desligamento(os_gestor_client, os_id, substituto_id=11)
    assert resp.status_code == 200, resp.text

    registros = _agenda(os_gestor_client).json()
    assert len(registros) == 1
    registro = registros[0]
    assert registro["os_id"] == os_id
    assert registro["codigo_os"] == "OS-2026-0001"
    assert registro["projeto_sap"] == "400774969"  # Nota PS do cliente
    assert registro["obra"] == "LIGAÇÃO NOVA"  # escopo
    assert registro["local"] == "25 DE MAIO"
    assert registro["municipio"] == "Ponte Serrada"
    assert registro["data"] == "2026-10-30"
    assert registro["hora_desligar"].startswith("13:00")
    assert registro["hora_religar"].startswith("17:00")
    assert registro["alimentador"] == "FGS01"
    assert registro["chave"] == "FU 82027"
    assert registro["equipe_nome"] == "Equipe A"
    assert registro["encarregado"] == "Líder de Campo"
    assert registro["substituto"] == "Membro Substituto"
    assert registro["equipes_apoio"] == []
    assert registro["impresso_em"]


def test_reimpressao_atualiza_o_mesmo_registro(os_gestor_client, db_fake):
    _seed(db_fake)
    os_id = _criar_os(os_gestor_client)

    assert _imprimir_com_desligamento(os_gestor_client, os_id, substituto_id=11).status_code == 200
    assert _imprimir_com_desligamento(os_gestor_client, os_id).status_code == 200

    registros = _agenda(os_gestor_client).json()
    assert len(registros) == 1
    # Reimpressão sem escolher outro substituto preserva o registrado.
    assert registros[0]["substituto"] == "Membro Substituto"


def test_editar_os_espelha_desligamento_preservando_substituto_e_apoio(os_gestor_client, db_fake):
    _seed(db_fake)
    os_id = _criar_os(os_gestor_client)
    _imprimir_com_desligamento(os_gestor_client, os_id, substituto_id=11)

    registro = _agenda(os_gestor_client).json()[0]
    resp = os_gestor_client.put(
        f"/api/os/desligamentos/{registro['id']}/equipes", json={"equipe_ids": [200]}
    )
    assert resp.status_code == 200, resp.text

    resp = os_gestor_client.put(
        f"/api/os/{os_id}",
        json={"descricao_escopo": "SERVIÇO ALTERADO", "local_servico": "NOVA RUA"},
    )
    assert resp.status_code == 200, resp.text

    registro = _agenda(os_gestor_client).json()[0]
    assert registro["servico"] == "SERVIÇO ALTERADO"
    assert registro["obra"] == "SERVIÇO ALTERADO"
    assert registro["local"] == "NOVA RUA"
    assert registro["substituto"] == "Membro Substituto"  # preservado
    assert [a["equipe_id"] for a in registro["equipes_apoio"]] == [200]  # preservadas


def test_editar_os_sem_desligamento_nao_cria_registro(os_gestor_client, db_fake):
    _seed(db_fake)
    os_id = _criar_os(os_gestor_client)

    resp = os_gestor_client.put(f"/api/os/{os_id}", json={"descricao_escopo": "SEM DESLIGAMENTO"})
    assert resp.status_code == 200, resp.text
    assert _agenda(os_gestor_client).json() == []


def test_definir_equipes_de_apoio(os_gestor_client, db_fake):
    _seed(db_fake)
    os_id = _criar_os(os_gestor_client)
    _imprimir_com_desligamento(os_gestor_client, os_id)
    registro_id = _agenda(os_gestor_client).json()[0]["id"]

    resp = os_gestor_client.put(
        f"/api/os/desligamentos/{registro_id}/equipes", json={"equipe_ids": [200, 300]}
    )
    assert resp.status_code == 200, resp.text
    apoios = resp.json()["equipes_apoio"]
    assert sorted(a["equipe_id"] for a in apoios) == [200, 300]
    assert {a["equipe_nome"] for a in apoios} == {"Equipe B", "Equipe C"}

    # Substituir a lista remove as anteriores.
    resp = os_gestor_client.put(
        f"/api/os/desligamentos/{registro_id}/equipes", json={"equipe_ids": [200]}
    )
    assert [a["equipe_id"] for a in resp.json()["equipes_apoio"]] == [200]


def test_equipe_de_apoio_inexistente_retorna_404(os_gestor_client, db_fake):
    _seed(db_fake)
    os_id = _criar_os(os_gestor_client)
    _imprimir_com_desligamento(os_gestor_client, os_id)
    registro_id = _agenda(os_gestor_client).json()[0]["id"]

    resp = os_gestor_client.put(
        f"/api/os/desligamentos/{registro_id}/equipes", json={"equipe_ids": [999]}
    )
    assert resp.status_code == 404


def test_equipes_de_desligamento_inexistente_retorna_404(os_gestor_client, db_fake):
    _seed(db_fake)
    resp = os_gestor_client.put("/api/os/desligamentos/999/equipes", json={"equipe_ids": [200]})
    assert resp.status_code == 404


def test_filtros_de_periodo_busca_e_equipe(os_gestor_client, db_fake):
    _seed(db_fake)
    os1 = _criar_os(os_gestor_client)
    os2 = _criar_os(
        os_gestor_client,
        prazo_entrega="2026-12-15",
        municipio="Ipumirim",
        local_servico="LINHA BOA VISTA",
    )
    _imprimir_com_desligamento(os_gestor_client, os1)
    _imprimir_com_desligamento(os_gestor_client, os2)

    registro1 = next(r for r in _agenda(os_gestor_client).json() if r["os_id"] == os1)
    os_gestor_client.put(
        f"/api/os/desligamentos/{registro1['id']}/equipes", json={"equipe_ids": [200]}
    )

    por_busca = _agenda(os_gestor_client, {"busca": "Ponte"}).json()
    assert [r["os_id"] for r in por_busca] == [os1]

    por_inicio = _agenda(os_gestor_client, {"data_inicio": "2026-12-01"}).json()
    assert [r["os_id"] for r in por_inicio] == [os2]

    por_fim = _agenda(os_gestor_client, {"data_fim": "2026-11-01"}).json()
    assert [r["os_id"] for r in por_fim] == [os1]

    por_equipe = _agenda(os_gestor_client, {"equipe_id": 200}).json()
    assert [r["os_id"] for r in por_equipe] == [os1]

    assert _agenda(os_gestor_client, {"equipe_id": 999}).json() == []


def test_agenda_pdf_tem_colunas_e_equipes_concatenadas(os_gestor_client, db_fake):
    _seed(db_fake)
    os_id = _criar_os(os_gestor_client)
    _imprimir_com_desligamento(os_gestor_client, os_id)
    registro_id = _agenda(os_gestor_client).json()[0]["id"]
    os_gestor_client.put(
        f"/api/os/desligamentos/{registro_id}/equipes", json={"equipe_ids": [200]}
    )

    resp = os_gestor_client.get("/api/os/desligamentos/agenda")
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/pdf")
    assert resp.content.startswith(b"%PDF")

    import pymupdf

    doc = pymupdf.open(stream=resp.content, filetype="pdf")
    texto = "\n".join(pagina.get_text() for pagina in doc)
    assert "AGENDA DE DESLIGAMENTOS" in texto
    assert "25 DE MAIO" in texto
    assert "400774969" in texto
    assert "Ponte Serrada" in texto
    assert "Equipe A + Equipe B" in texto
    assert "13:00" in texto and "17:00" in texto


def test_remover_da_agenda_nao_apaga_a_os(os_gestor_client, db_fake):
    _seed(db_fake)
    os_id = _criar_os(os_gestor_client)
    _imprimir_com_desligamento(os_gestor_client, os_id)
    registro_id = _agenda(os_gestor_client).json()[0]["id"]

    resp = os_gestor_client.delete(f"/api/os/desligamentos/{registro_id}")
    assert resp.status_code == 200, resp.text
    assert _agenda(os_gestor_client).json() == []
    assert os_gestor_client.get(f"/api/os/{os_id}").status_code == 200


def test_agenda_exige_gestor(client, os_campo_client, db_fake):
    _seed(db_fake)
    # Sem token: 401; usuário de campo (os_campo): 403 (a agenda é do gestor).
    assert client.get("/api/os/desligamentos/").status_code == 401
    assert os_campo_client.get("/api/os/desligamentos/").status_code == 403
    assert os_campo_client.get("/api/os/desligamentos/agenda").status_code == 403
