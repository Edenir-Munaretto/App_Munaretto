"""Testes do endpoint de sincronização offline (POST /api/os/sincronizar).

Cobre:
- Aplicação em ordem cronológica de respostas do checklist + status (fluxo do dia);
- Falha parcial não aborta o lote;
- Gate do checklist é revalidado no sync;
- Permissão por equipe é revalidada;
- Apontamentos play/pause via sync.
"""


def _seed_modelos(db_fake):
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


def _itens(client, os_id):
    return client.get(f"/api/os/{os_id}/checklist").json()["itens"]


def _op(id_local, tipo, os_id, payload, criado_em):
    return {
        "id_local": id_local,
        "tipo": tipo,
        "os_id": os_id,
        "criado_em": criado_em,
        "payload": payload,
    }


def _sync(client, operacoes):
    return client.post("/api/os/sincronizar", json={"operacoes": operacoes})


def _fluxo_dia_operacoes(client, os_id):
    """Sequência típica de um dia de campo (em ordem cronológica)."""
    itens = _itens(client, os_id)
    g1 = [i for i in itens if i["grupo"] == 1]
    g2 = [i for i in itens if i["grupo"] == 2]
    ops = [
        _op("r1", "checklist_resposta", os_id,
            {"item_id": g1[0]["id"], "resposta": "sim", "geolocalizacao": "-26.9,-52.3"}, "2026-08-28T06:50:00Z"),
        _op("r2", "checklist_resposta", os_id,
            {"item_id": g1[1]["id"], "resposta": "sim", "geolocalizacao": "-26.9,-52.3"}, "2026-08-28T06:51:00Z"),
        _op("s1", "status", os_id, {"novo_status": "em_andamento", "geolocalizacao": "-27.0,-52.3"},
            "2026-08-28T08:05:00Z"),
        _op("r3", "checklist_resposta", os_id,
            {"item_id": g2[0]["id"], "resposta": "sim", "geolocalizacao": "-27.0,-52.3"}, "2026-08-28T08:10:00Z"),
        _op("s2", "status", os_id, {"novo_status": "concluida", "geolocalizacao": "-27.0,-52.3"},
            "2026-08-28T17:00:00Z"),
    ]
    return ops


def test_sync_fluxo_completo_do_dia(os_gestor_client, db_fake):
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    _seed_modelos(db_fake)
    os_id = _criar_os(os_gestor_client).json()["id"]
    os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})

    resp = _sync(os_gestor_client, _fluxo_dia_operacoes(os_gestor_client, os_id))
    assert resp.status_code == 200, resp.text
    resultados = resp.json()["resultados"]
    assert [r["id_local"] for r in resultados] == ["r1", "r2", "s1", "r3", "s2"]
    assert all(r["ok"] for r in resultados), resultados

    detalhe = os_gestor_client.get(f"/api/os/{os_id}").json()
    assert detalhe["status"] == "concluida"
    assert detalhe["checklist"]["completo"] is True


def test_sync_falha_parcial_nao_aborta_lote(os_gestor_client, db_fake):
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    _seed_modelos(db_fake)
    os_id = _criar_os(os_gestor_client).json()["id"]
    itens = _itens(os_gestor_client, os_id)
    g1 = [i for i in itens if i["grupo"] == 1]

    ops = [
        _op("ok1", "checklist_resposta", os_id,
            {"item_id": g1[0]["id"], "resposta": "sim"}, "2026-08-28T06:50:00Z"),
        _op("erro1", "checklist_resposta", os_id,
            {"item_id": 999999, "resposta": "sim"}, "2026-08-28T06:51:00Z"),  # item inexistente
        _op("ok2", "checklist_resposta", os_id,
            {"item_id": g1[1]["id"], "resposta": "na"}, "2026-08-28T06:52:00Z"),
    ]
    resp = _sync(os_gestor_client, ops)
    assert resp.status_code == 200
    resultados = {r["id_local"]: r for r in resp.json()["resultados"]}
    assert resultados["ok1"]["ok"] is True
    assert resultados["ok2"]["ok"] is True
    assert resultados["erro1"]["ok"] is False
    assert resultados["erro1"]["status"] == 404


def test_sync_revalida_gate_do_checklist(os_gestor_client, db_fake):
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    _seed_modelos(db_fake)
    os_id = _criar_os(os_gestor_client).json()["id"]
    os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})

    # Tenta iniciar a execução SEM o grupo 1 respondido: o servidor recusa.
    resp = _sync(os_gestor_client, [_op("s1", "status", os_id, {"novo_status": "em_andamento"}, "2026-08-28T08:00:00Z")])
    resultado = resp.json()["resultados"][0]
    assert resultado["ok"] is False
    assert resultado["status"] == 422
    assert "checklist" in resultado["erro"].lower()

    # Respostas inválidas também são rejeitadas com mensagem clara.
    itens = _itens(os_gestor_client, os_id)
    resp = _sync(
        os_gestor_client,
        [_op("r1", "checklist_resposta", os_id, {"item_id": itens[0]["id"], "resposta": "talvez"}, "2026-08-28T08:00:00Z")],
    )
    assert resp.json()["resultados"][0]["ok"] is False
    assert resp.json()["resultados"][0]["status"] == 400


def test_sync_revalida_permissao_por_equipe(os_gestor_client, os_campo_client, db_fake):
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    _seed_modelos(db_fake)
    # O.S de OUTRA equipe (200): o usuário de campo não pode mexer.
    os_id = _criar_os(os_gestor_client, equipe_id=200).json()["id"]
    itens = _itens(os_gestor_client, os_id)
    g1 = [i for i in itens if i["grupo"] == 1]

    resp = _sync(
        os_campo_client,
        [_op("r1", "checklist_resposta", os_id, {"item_id": g1[0]["id"], "resposta": "sim"}, "2026-08-28T08:00:00Z")],
    )
    resultado = resp.json()["resultados"][0]
    assert resultado["ok"] is False
    assert resultado["status"] == 403


def test_sync_apontamentos_play_pause(os_gestor_client, os_campo_client, db_fake):
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    _seed_modelos(db_fake)
    os_id = _criar_os(os_gestor_client, equipe_id=100).json()["id"]  # equipe do campo
    os_campo_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})

    itens = _itens(os_campo_client, os_id)
    g1 = [i for i in itens if i["grupo"] == 1]

    ops = [
        _op("r1", "checklist_resposta", os_id, {"item_id": g1[0]["id"], "resposta": "sim"}, "2026-08-28T06:50:00Z"),
        _op("r2", "checklist_resposta", os_id, {"item_id": g1[1]["id"], "resposta": "sim"}, "2026-08-28T06:51:00Z"),
        _op("play", "apontamento_play", os_id, {"geolocalizacao": "-27.0,-52.3"}, "2026-08-28T08:05:00Z"),
        _op("pause", "apontamento_pause", os_id, {"geolocalizacao": "-27.0,-52.3"}, "2026-08-28T12:00:00Z"),
    ]
    resp = _sync(os_campo_client, ops)
    assert resp.status_code == 200, resp.text
    resultados = {r["id_local"]: r for r in resp.json()["resultados"]}
    assert all(r["ok"] for r in resultados.values()), resultados

    # O play promoveu para em_andamento e o pause fechou o bloco com minutos.
    detalhe = os_campo_client.get(f"/api/os/{os_id}").json()
    assert detalhe["status"] == "em_andamento"
    assert detalhe["mao_de_obra"]["total_horas"] > 0


def test_sync_tipo_invalido(os_gestor_client, db_fake):
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    os_id = _criar_os(os_gestor_client).json()["id"]
    resp = _sync(os_gestor_client, [_op("x1", "desligar_rede", os_id, {}, "2026-08-28T08:00:00Z")])
    resultado = resp.json()["resultados"][0]
    assert resultado["ok"] is False
    assert resultado["status"] == 400


def test_sync_status_impedida_com_foto_local_mapeada(os_gestor_client, os_campo_client, db_fake, monkeypatch):
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    _seed_modelos(db_fake)
    os_id = _criar_os(os_gestor_client, equipe_id=100).json()["id"]  # equipe do campo
    os_campo_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})

    itens = _itens(os_campo_client, os_id)
    g1 = [i for i in itens if i["grupo"] == 1]
    g2 = [i for i in itens if i["grupo"] == 2]

    # Foto "tirada offline": grava direto no banco e devolve o id do servidor.
    db_fake._dados["os_fotos"].append(
        {"id": 700, "os_id": os_id, "checklist_item_id": g2[0]["id"], "nome_original": "apr.jpg",
         "tamanho_bytes": 100, "mime_type": "image/jpeg", "bucket_key": "os_fotos/x.jpg"}
    )
    mapa = {"foto-local-abc": 700}

    ops = [
        _op("r1", "checklist_resposta", os_id, {"item_id": g1[0]["id"], "resposta": "sim"}, "2026-08-28T06:50:00Z"),
        _op("r2", "checklist_resposta", os_id, {"item_id": g1[1]["id"], "resposta": "sim"}, "2026-08-28T06:51:00Z"),
        _op("s1", "status", os_id, {"novo_status": "em_andamento"}, "2026-08-28T08:05:00Z"),
        # Impedimento com a evidência LOCAL mapeada pelo lote.
        _op("s2", "status", os_id,
            {"novo_status": "impedida",
             "justificativa": "Chuva forte inviabilizou o serviço na região hoje.",
             "fotos_ids": ["foto-local-abc"]},
            "2026-08-28T09:00:00Z"),
    ]
    resp = os_campo_client.post(
        "/api/os/sincronizar",
        json={"operacoes": ops, "mapa_fotos": mapa},
    )
    assert resp.status_code == 200, resp.text
    resultados = {r["id_local"]: r for r in resp.json()["resultados"]}
    assert all(r["ok"] for r in resultados.values()), resultados

    detalhe = os_campo_client.get(f"/api/os/{os_id}").json()
    assert detalhe["status"] == "impedida"

    # Foto local SEM mapeamento é recusada com mensagem clara.
    resp2 = os_campo_client.post(
        "/api/os/sincronizar",
        json={"operacoes": [_op("x", "status", os_id,
                                {"novo_status": "em_andamento", "fotos_ids": ["foto-sem-mapa"]},
                                "2026-08-28T09:05:00Z")]},
    )
    assert resp2.json()["resultados"][0]["ok"] is False
    assert "ainda não foi sincronizada" in resp2.json()["resultados"][0]["erro"]
