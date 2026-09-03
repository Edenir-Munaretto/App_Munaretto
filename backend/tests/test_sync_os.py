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


# ---------------------------------------------------------------------------
# Fase D — conflito real: o gestor altera a O.S enquanto o tablet está offline
# ---------------------------------------------------------------------------


def _responder_tudo(client, os_id):
    """Responde todos os itens do checklist (online) — usado pelo gestor."""
    itens = client.get(f"/api/os/{os_id}/checklist").json()["itens"]
    for item in itens:
        resp = client.put(
            f"/api/os/{os_id}/checklist/{item['id']}",
            json={"resposta": "sim", "justificativa": None},
        )
        assert resp.status_code == 200, resp.text


def test_sync_conflito_gestor_conclui_enquanto_tablet_offline(os_gestor_client, os_campo_client, db_fake):
    """O gestor conclui a O.S no meio do dia; o lote do tablet é rejeitado
    operação por operação (com status de conflito), sem abortar o restante."""
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    _seed_modelos(db_fake)
    os_id = _criar_os(os_gestor_client, equipe_id=100).json()["id"]
    os_campo_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})

    # O gestor responde o checklist e CONCLUI a O.S enquanto o tablet está offline.
    _responder_tudo(os_gestor_client, os_id)
    resp = os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "em_andamento"})
    assert resp.status_code == 200, resp.text
    resp = os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "concluida"})
    assert resp.status_code == 200, resp.text

    # O tablet (que ainda "pensava" a O.S aberta) sincroniza horas depois.
    itens = _itens(os_campo_client, os_id)
    ops = [
        _op("r1", "checklist_resposta", os_id,
            {"item_id": itens[0]["id"], "resposta": "nao", "justificativa": "Item mudou durante o dia."},
            "2026-08-28T10:00:00Z"),
        _op("s1", "status", os_id, {"novo_status": "em_andamento"}, "2026-08-28T10:05:00Z"),
        _op("play", "apontamento_play", os_id, {}, "2026-08-28T10:06:00Z"),
    ]
    resp = _sync(os_campo_client, ops)
    assert resp.status_code == 200
    resultados = {r["id_local"]: r for r in resp.json()["resultados"]}

    # Conflito 1: checklist de O.S encerrada não pode ser alterado.
    assert resultados["r1"]["ok"] is False
    assert resultados["r1"]["status"] == 400
    assert "encerrada" in resultados["r1"]["erro"].lower()

    # Conflito 2: transição inválida a partir do estado REAL (concluida).
    assert resultados["s1"]["ok"] is False
    assert resultados["s1"]["status"] == 422
    assert "transição inválida" in resultados["s1"]["erro"].lower()

    # Conflito 3: não aponta horas em O.S concluída.
    assert resultados["play"]["ok"] is False
    assert resultados["play"]["status"] == 400

    # O estado no servidor permanece o que o gestor definiu.
    detalhe = os_gestor_client.get(f"/api/os/{os_id}").json()
    assert detalhe["status"] == "concluida"


def test_sync_conflito_gestor_cancela_os_offline(os_gestor_client, os_campo_client, db_fake):
    """Cancelamento pelo gestor enquanto o tablet está offline: a transição
    divergente do tablet é rejeitada e a O.S permanece cancelada."""
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    _seed_modelos(db_fake)
    os_id = _criar_os(os_gestor_client, equipe_id=100).json()["id"]
    os_campo_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})

    resp = os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "cancelada"})
    assert resp.status_code == 200, resp.text

    # Tablet ainda via a O.S 'aberta' e tenta liberar a execução.
    itens = _itens(os_campo_client, os_id)
    ops = [
        _op("r1", "checklist_resposta", os_id, {"item_id": itens[0]["id"], "resposta": "sim"},
            "2026-08-28T08:00:00Z"),
        _op("s1", "status", os_id, {"novo_status": "em_andamento"}, "2026-08-28T08:05:00Z"),
    ]
    resp = _sync(os_campo_client, ops)
    resultados = {r["id_local"]: r for r in resp.json()["resultados"]}
    assert resultados["r1"]["ok"] is False
    assert resultados["s1"]["ok"] is False
    assert resultados["s1"]["status"] == 422

    assert os_campo_client.get(f"/api/os/{os_id}").json()["status"] == "cancelada"


def test_sync_resposta_duplicada_ultimo_vence(os_gestor_client, os_campo_client, db_fake):
    """Gestor e campo responderam o MESMO item (upsert): a última operação
    aplicada vence — comportamento documentado (conflito benigno)."""
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    _seed_modelos(db_fake)
    os_id = _criar_os(os_gestor_client, equipe_id=100).json()["id"]
    os_campo_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})

    itens = _itens(os_campo_client, os_id)
    g1 = [i for i in itens if i["grupo"] == 1]

    # Gestor responde 'sim' online; tablet responde 'nao' + justificativa depois.
    resp = os_gestor_client.put(
        f"/api/os/{os_id}/checklist/{g1[0]['id']}", json={"resposta": "sim"}
    )
    assert resp.status_code == 200

    resp = _sync(os_campo_client, [_op("r1", "checklist_resposta", os_id,
                                       {"item_id": g1[0]["id"], "resposta": "nao",
                                        "justificativa": "Conferência refeita no local com novo resultado."},
                                       "2026-08-28T10:00:00Z")])
    assert resp.json()["resultados"][0]["ok"] is True

    detalhe = os_campo_client.get(f"/api/os/{os_id}/checklist").json()
    resposta = next(i["resposta"] for i in detalhe["itens"] if i["id"] == g1[0]["id"])
    assert resposta["resposta"] == "nao"
    assert resposta["justificativa"]


def test_sync_lanca_material_com_conversao_usc(os_gestor_client, os_campo_client, db_fake):
    """Lançamento de serviço offline: operação 'material' é revalidada no
    servidor com a mesma lógica USC (peças x fator) e grava o registro."""
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    db_fake._dados["produtos"].append(
        {
            "id": 8,
            "codigo": "ROCA-01",
            "codigo_especial": "ROCA-ESP",
            "nome": "Limpeza ou Roçada de Capoeira",
            "unidade": "UN",
            "preco_unitario": 6.66,
            "qtd_usc_especial": 0.67,
            "tipo": "construcao",
            "ativo": True,
        }
    )
    os_id = _criar_os(os_gestor_client, equipe_id=100).json()["id"]
    os_campo_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})

    resp = _sync(
        os_campo_client,
        [
            _op("m1", "material", os_id,
                {"produto_id": 8, "quantidade_usada": 2, "tipo_usc": "normal"}, "2026-08-28T09:00:00Z"),
            _op("m2", "material", os_id,
                {"produto_id": 8, "quantidade_usada": 3, "tipo_usc": "especial"}, "2026-08-28T09:05:00Z"),
        ],
    )
    assert resp.status_code == 200, resp.text
    r1, r2 = resp.json()["resultados"]
    assert r1["ok"] is True, r1
    assert r1["dados"]["quantidade_usada"] == 13.32  # 2 x 6.66
    assert r1["dados"]["quantidade_pecas"] == 2
    assert r1["dados"]["fator_usc"] == 6.66
    # Snapshot do código conforme o tipo: normal -> codigo, especial -> codigo_especial.
    assert r1["dados"]["codigo_servico"] == "ROCA-01"
    assert r2["ok"] is True, r2
    assert r2["dados"]["quantidade_usada"] == 2.01  # 3 x 0.67
    assert r2["dados"]["tipo_usc"] == "especial"
    assert r2["dados"]["codigo_servico"] == "ROCA-ESP"


def test_sync_material_em_os_concluida_rejeitado(os_gestor_client, os_campo_client, db_fake):
    """O campo não pode lançar em O.S concluída nem via sync (gate revalidado)."""
    from tests.test_os import _criar_os, _seed_cenario

    _seed_cenario(db_fake)
    os_id = _criar_os(os_gestor_client, equipe_id=100).json()["id"]
    os_campo_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})
    # Play promove para em_andamento (sem checklist cadastrado, gate libera).
    assert os_campo_client.post(f"/api/os/{os_id}/apontamentos", json={"acao": "play"}).status_code == 200

    resp = _sync(
        os_campo_client,
        [
            _op("m1", "material", os_id, {"produto_id": 7, "quantidade_usada": 1}, "2026-08-28T09:00:00Z"),
            _op("s1", "status", os_id, {"novo_status": "concluida"}, "2026-08-28T17:00:00Z"),
            _op("m2", "material", os_id, {"produto_id": 7, "quantidade_usada": 1}, "2026-08-28T17:30:00Z"),
        ],
    )
    resultados = {r["id_local"]: r for r in resp.json()["resultados"]}
    assert resultados["m1"]["ok"] is True
    assert resultados["s1"]["ok"] is True
    assert resultados["m2"]["ok"] is False
    assert resultados["m2"]["status"] == 400
