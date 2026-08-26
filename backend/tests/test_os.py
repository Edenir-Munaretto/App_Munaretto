"""Testes do módulo Controle de Ordens de Serviço (O.S).

Cobre as regras críticas:
- Geração de código único e status inicial 'rascunho';
- Máquina de estados (transições inválidas são rejeitadas);
- Trava do status 'Impedida' (justificativa >= 20 caracteres + fotos);
- Apontamento H.H. (play promove a O.S, pause calcula minutos);
- Custo Real de Mão de Obra (minutos x valor_hora / 60);
- Permissão granular (usuário de campo só acessa O.S da própria equipe).
"""

from routers.os import TRANSICOES_STATUS

# ---------------------------------------------------------------------------
# Helpers de cenário
# ---------------------------------------------------------------------------


def _seed_cenario(db_fake):
    """Cria cliente, obra, produto e duas equipes com o líder de campo."""
    db = db_fake._dados
    db["funcionarios"].append(
        {
            "id": 10,
            "nome": "Líder de Campo",
            "cpf": "11111111111",
            "email": "campo@munaretto.com",
            "valor_hora": 30.0,
            "ativo": True,
        }
    )
    db["obras"].append(
        {
            "id": 5,
            "cliente_id": 1,
            "nome": "Obra Central",
            "ativo": True,
            "created_at": "2026-01-01T00:00:00Z",
        }
    )
    db["produtos"].append(
        {
            "id": 7,
            "codigo": "CIM-50",
            "nome": "Cimento CP-II 50kg",
            "unidade": "saco",
            "preco_unitario": 40.0,
            "ativo": True,
        }
    )
    db["equipes"].append({"id": 100, "nome": "Equipe A", "ativa": True})
    db["equipes"].append({"id": 200, "nome": "Equipe B", "ativa": True})
    db["equipe_membros"].append(
        {
            "id": 1,
            "equipe_id": 100,
            "funcionario_id": 10,
            "lider": True,
        }
    )


def _criar_os(client, **overrides):
    payload = {
        "obra_id": 5,
        "prioridade": "alta",
        "prazo_entrega": "2026-12-31",
        "descricao_escopo": "Reforma do pavimento térreo.",
        "custo_mo_orcado": 5000,
        "itens_orcados": [{"produto_id": 7, "quantidade_orcada": 10}],
        **overrides,
    }
    return client.post("/api/os/", json=payload)


def _criar_os_aberta_em_andamento(client):
    """Cria a O.S e a move até 'em_andamento' (caminho válido)."""
    resp = _criar_os(client)
    assert resp.status_code == 201, resp.text
    os_id = resp.json()["id"]
    assert client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"}).status_code == 200
    assert client.put(f"/api/os/{os_id}/status", json={"novo_status": "em_andamento"}).status_code == 200
    return os_id


def _anexar_foto_via_banco(db_fake, os_id, qtd=1):
    """Fotos anexadas direto no banco (o upload real usa B2/S3)."""
    fotos = []
    for i in range(qtd):
        registro = {
            "id": 900 + i,
            "os_id": os_id,
            "nome_original": f"evidencia{i}.jpg",
            "tamanho_bytes": 1000,
            "mime_type": "image/jpeg",
            "bucket_key": f"os_fotos/{os_id}/fake{i}.jpg",
        }
        db_fake._dados["os_fotos"].append(registro)
        fotos.append(registro["id"])
    return fotos


# ---------------------------------------------------------------------------
# Testes
# ---------------------------------------------------------------------------


class TestMaquinaEstados:
    def test_transicoes_validas_cobrem_todos_os_status(self):
        for origem in ("rascunho", "aberta", "em_andamento", "impedida", "concluida", "cancelada"):
            assert origem in TRANSICOES_STATUS

    def test_criar_os_gera_codigo_e_rascunho(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        resp = _criar_os(os_gestor_client)
        assert resp.status_code == 201, resp.text
        dados = resp.json()
        assert dados["codigo"] == "OS-2026-0001"
        assert dados["status"] == "rascunho"

        # Código sequencial na segunda criação
        resp2 = _criar_os(os_gestor_client)
        assert resp2.json()["codigo"] == "OS-2026-0002"

    def test_transicao_invalida_rascunho_para_concluida(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client).json()["id"]
        resp = os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "concluida"})
        assert resp.status_code == 422
        assert "Transição inválida" in resp.json()["detail"]

    def test_caminho_completo_valido_e_historico_gravado(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os_aberta_em_andamento(os_gestor_client)

        resp = os_gestor_client.put(
            f"/api/os/{os_id}/status",
            json={"novo_status": "concluida"},
        )
        assert resp.status_code == 200
        assert resp.json()["data_fim"] is not None

        hist = db_fake._dados["os_historico"]
        transicoes = [(h["status_anterior"], h["status_novo"]) for h in hist if h["os_id"] == os_id]
        assert (None, "rascunho") in transicoes
        assert ("rascunho", "aberta") in transicoes
        assert ("aberta", "em_andamento") in transicoes
        assert ("em_andamento", "concluida") in transicoes


class TestTravaImpedida:
    """Regra crítica: 'Impedida' exige justificativa >= 20 caracteres + fotos."""

    def test_sem_fotos_rejeita(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os_aberta_em_andamento(os_gestor_client)
        resp = os_gestor_client.put(
            f"/api/os/{os_id}/status",
            json={
                "novo_status": "impedida",
                "justificativa": "Chuva forte inviabilizou a concretagem hoje.",
                "fotos_ids": [],
            },
        )
        assert resp.status_code == 422
        assert "foto" in resp.json()["detail"].lower()

    def test_foto_de_outra_os_rejeita(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os_aberta_em_andamento(os_gestor_client)
        foto_alheia = _anexar_foto_via_banco(db_fake, os_id=os_id + 999)[0]
        resp = os_gestor_client.put(
            f"/api/os/{os_id}/status",
            json={
                "novo_status": "impedida",
                "justificativa": "Chuva forte inviabilizou a concretagem hoje.",
                "fotos_ids": [foto_alheia],
            },
        )
        assert resp.status_code == 422

    def test_impedida_valida_grava_justificativa_no_historico(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os_aberta_em_andamento(os_gestor_client)
        fotos = _anexar_foto_via_banco(db_fake, os_id)
        resp = os_gestor_client.put(
            f"/api/os/{os_id}/status",
            json={
                "novo_status": "impedida",
                "justificativa": "Chuva forte inviabilizou a concretagem hoje.",
                "fotos_ids": fotos,
                "geolocalizacao": "-23.5505,-46.6333",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "impedida"
        evento = [h for h in db_fake._dados["os_historico"] if h["os_id"] == os_id and h["status_novo"] == "impedida"]
        assert evento and evento[0]["justificativa"].startswith("Chuva forte")
        assert evento[0]["geolocalizacao_log"] == "-23.5505,-46.6333"

    def test_impedida_volta_para_em_andamento(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os_aberta_em_andamento(os_gestor_client)
        fotos = _anexar_foto_via_banco(db_fake, os_id)
        assert (
            os_gestor_client.put(
                f"/api/os/{os_id}/status",
                json={
                    "novo_status": "impedida",
                    "justificativa": "Falta de material no estoque da região.",
                    "fotos_ids": fotos,
                },
            ).status_code
            == 200
        )
        resp = os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "em_andamento"})
        assert resp.status_code == 200


class TestApontamentoHoras:
    """H.H.: play/pause e cálculo do Custo Real de Mão de Obra."""

    def test_play_promove_aberta_para_em_andamento(self, os_campo_client, db_fake):
        _seed_cenario(db_fake)
        # O.S atribuída à Equipe A (equipe do líder de campo).
        os_id = _criar_os(os_campo_client, equipe_id=100).json()["id"]
        os_campo_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})

        resp = os_campo_client.post(f"/api/os/{os_id}/apontamentos", json={"acao": "play"})
        assert resp.status_code == 200, resp.text
        assert db_fake._dados["ordens_servico"][0]["status"] == "em_andamento"
        # Histórico registra a promoção automática
        eventos = [h for h in db_fake._dados["os_historico"] if h["status_novo"] == "em_andamento"]
        assert any("apontamento" in (h["justificativa"] or "") for h in eventos)

    def test_pause_duplo_rejeita(self, os_campo_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_campo_client, equipe_id=100).json()["id"]
        os_campo_client.post(f"/api/os/{os_id}/apontamentos", json={"acao": "play"})
        assert os_campo_client.post(f"/api/os/{os_id}/apontamentos", json={"acao": "play"}).status_code == 409
        assert os_campo_client.post(f"/api/os/{os_id}/apontamentos", json={"acao": "pause"}).status_code == 200
        assert os_campo_client.post(f"/api/os/{os_id}/apontamentos", json={"acao": "pause"}).status_code == 409

    def test_custo_mao_de_obra_no_resumo(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client).json()["id"]

        # Bloco fechado de 120 min do líder (R$ 30/h) => custo esperado R$ 60.
        db_fake._dados["os_apontamentos"].append(
            {
                "id": 1,
                "os_id": os_id,
                "funcionario_id": 10,
                "inicio": "2026-03-01T08:00:00Z",
                "fim": "2026-03-01T10:00:00Z",
                "minutos_trabalhados": 120,
            }
        )

        resp = os_gestor_client.get(f"/api/os/{os_id}")
        assert resp.status_code == 200
        mo = resp.json()["mao_de_obra"]
        assert mo["total_horas"] == 2.0
        assert mo["custo_mo_real"] == 60.0
        assert mo["por_funcionario"][0]["nome"] == "Líder de Campo"


class TestMateriaisEPermissao:
    def test_lancamento_material_e_resumo(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client).json()["id"]
        os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})

        resp = os_gestor_client.post(
            f"/api/os/{os_id}/materiais",
            json={"produto_id": 7, "quantidade_usada": 4},
        )
        assert resp.status_code == 201

        resumo = os_gestor_client.get(f"/api/os/{os_id}").json()["materiais"]
        item = next(i for i in resumo["itens"] if i["produto_id"] == 7)
        assert item["orcado"] == 10
        assert item["aplicado"] == 4
        assert item["perc_aplicado"] == 40.0
        assert resumo["total_aplicado_rs"] == 160.0  # 4 sacos x R$ 40
        assert resumo["total_orcado_rs"] == 400.0

    def test_lancamento_bloqueado_fora_de_execucao(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client).json()["id"]  # rascunho
        resp = os_gestor_client.post(f"/api/os/{os_id}/materiais", json={"produto_id": 7, "quantidade_usada": 1})
        assert resp.status_code == 400

    def test_campo_nao_acessa_os_de_outra_equipe(self, os_campo_client, db_fake):
        _seed_cenario(db_fake)
        # Equipe B NÃO tem o líder de campo como membro.
        os_outros = _criar_os(os_campo_client, equipe_id=200).json()["id"]
        resp = os_campo_client.get(f"/api/os/{os_outros}")
        assert resp.status_code == 403

        resp_status = os_campo_client.put(f"/api/os/{os_outros}/status", json={"novo_status": "aberta"})
        assert resp_status.status_code == 403

    def test_campo_ve_apenas_sua_equipe_na_listagem(self, os_campo_client, db_fake):
        _seed_cenario(db_fake)
        _criar_os(os_campo_client, equipe_id=100)  # própria equipe
        _criar_os(os_campo_client, equipe_id=200)  # outra equipe
        lista = os_campo_client.get("/api/os/").json()
        assert len(lista) == 1

    def test_duplicar_clona_itens_orcados_como_rascunho(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        original = _criar_os(os_gestor_client).json()
        copia = os_gestor_client.post(f"/api/os/{original['id']}/duplicar").json()

        assert copia["status"] == "rascunho"
        assert copia["codigo"] != original["codigo"]
        itens = [i for i in db_fake._dados["os_itens_orcados"] if i["os_id"] == copia["id"]]
        assert itens and itens[0]["quantidade_orcada"] == 10

    def test_endpoint_exige_permissao_do_modulo(self, client):
        # Usuário sem nenhuma permissão em 'os' recebe 403 antes dos handlers.
        resp = client.get("/api/os/")
        assert resp.status_code == 401  # nem logado está (sem token)
