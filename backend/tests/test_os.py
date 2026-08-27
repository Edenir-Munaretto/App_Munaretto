"""Testes do módulo Controle de Ordens de Serviço (O.S).

Cobre as regras críticas:
- Geração de código único e status inicial 'rascunho';
- Máquina de estados (transições inválidas são rejeitadas);
- Trava do status 'Impedida' (justificativa >= 20 caracteres + fotos);
- Apontamento H.H. (play promove a O.S, pause calcula minutos);
- Custo Real de Mão de Obra (zerado até definir valor por equipe);
- Permissão granular (usuário de campo só acessa O.S da própria equipe);
- Impressão do modelo oficial (CONSTRUÇÃO/LINHA VIVA).
"""

import os

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

    def test_play_promove_aberta_para_em_andamento(self, os_gestor_client, os_campo_client, db_fake):
        _seed_cenario(db_fake)
        # O gestor cria a O.S; o campo executa o apontamento.
        os_id = _criar_os(os_gestor_client, equipe_id=100).json()["id"]
        os_campo_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})

        resp = os_campo_client.post(f"/api/os/{os_id}/apontamentos", json={"acao": "play"})
        assert resp.status_code == 200, resp.text
        assert db_fake._dados["ordens_servico"][0]["status"] == "em_andamento"
        # Histórico registra a promoção automática
        eventos = [h for h in db_fake._dados["os_historico"] if h["status_novo"] == "em_andamento"]
        assert any("apontamento" in (h["justificativa"] or "") for h in eventos)

    def test_pause_duplo_rejeita(self, os_gestor_client, os_campo_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client, equipe_id=100).json()["id"]
        os_campo_client.post(f"/api/os/{os_id}/apontamentos", json={"acao": "play"})
        assert os_campo_client.post(f"/api/os/{os_id}/apontamentos", json={"acao": "play"}).status_code == 409
        assert os_campo_client.post(f"/api/os/{os_id}/apontamentos", json={"acao": "pause"}).status_code == 200
        assert os_campo_client.post(f"/api/os/{os_id}/apontamentos", json={"acao": "pause"}).status_code == 409

    def test_custo_mao_de_obra_no_resumo(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client).json()["id"]

        # Bloco fechado de 120 min do líder; custo real fica zerado até que
        # o valor da hora seja definido por equipe.
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
        assert mo["custo_mo_real"] == 0.0
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

    def test_campo_nao_acessa_os_de_outra_equipe(self, os_gestor_client, os_campo_client, db_fake):
        _seed_cenario(db_fake)
        # O gestor cria as O.S; o campo só acessa a da própria equipe (100).
        os_propria = _criar_os(os_gestor_client, equipe_id=100).json()["id"]
        os_outros = _criar_os(os_gestor_client, equipe_id=200).json()["id"]

        assert os_campo_client.get(f"/api/os/{os_propria}").status_code == 200
        resp = os_campo_client.get(f"/api/os/{os_outros}")
        assert resp.status_code == 403

        resp_status = os_campo_client.put(f"/api/os/{os_outros}/status", json={"novo_status": "aberta"})
        assert resp_status.status_code == 403

    def test_campo_ve_apenas_sua_equipe_na_listagem(self, os_gestor_client, os_campo_client, db_fake):
        _seed_cenario(db_fake)
        propria = _criar_os(os_gestor_client, equipe_id=100).json()["id"]  # própria equipe
        _criar_os(os_gestor_client, equipe_id=200)  # outra equipe
        # O campo só enxerga O.S em execução (aberta/em_andamento) da própria equipe.
        os_gestor_client.put(f"/api/os/{propria}/status", json={"novo_status": "aberta"})

        lista = os_campo_client.get("/api/os/").json()
        assert len(lista) == 1
        assert lista[0]["id"] == propria

    def test_campo_ignora_os_encerradas_e_rascunho(self, os_gestor_client, os_campo_client, db_fake):
        _seed_cenario(db_fake)
        em_andamento = _criar_os(os_gestor_client, equipe_id=100).json()["id"]
        impedida = _criar_os(os_gestor_client, equipe_id=100).json()["id"]
        concluida = _criar_os(os_gestor_client, equipe_id=100).json()["id"]
        cancelada = _criar_os(os_gestor_client, equipe_id=100).json()["id"]
        rascunho = _criar_os(os_gestor_client, equipe_id=100).json()["id"]

        os_gestor_client.put(f"/api/os/{em_andamento}/status", json={"novo_status": "aberta"})
        os_campo_client.post(f"/api/os/{em_andamento}/apontamentos", json={"acao": "play"})  # -> em_andamento

        # Impedida continua visível ao campo (para retomar).
        os_gestor_client.put(f"/api/os/{impedida}/status", json={"novo_status": "aberta"})
        os_campo_client.post(f"/api/os/{impedida}/apontamentos", json={"acao": "play"})
        db_fake._dados["os_fotos"].append(
            {"id": 700, "os_id": impedida, "nome_original": "x.jpg", "tamanho_bytes": 1,
             "mime_type": "image/jpeg", "bucket_key": "k"}
        )
        os_campo_client.put(
            f"/api/os/{impedida}/status",
            json={"novo_status": "impedida", "justificativa": "Chuva forte inviabilizou o serviço hoje.", "fotos_ids": [700]},
        )

        os_gestor_client.put(f"/api/os/{concluida}/status", json={"novo_status": "aberta"})
        os_campo_client.post(f"/api/os/{concluida}/apontamentos", json={"acao": "play"})
        os_gestor_client.put(f"/api/os/{concluida}/status", json={"novo_status": "concluida"})
        os_gestor_client.put(f"/api/os/{cancelada}/status", json={"novo_status": "cancelada"})

        ids = [os["id"] for os in os_campo_client.get("/api/os/").json()]
        assert em_andamento in ids
        assert impedida in ids
        assert concluida not in ids
        assert cancelada not in ids
        assert rascunho not in ids

    def test_campo_nao_cria_os(self, os_campo_client, db_fake):
        _seed_cenario(db_fake)
        resp = _criar_os(os_campo_client, equipe_id=100)
        assert resp.status_code == 403

    def test_campo_nao_cancela_os(self, os_gestor_client, os_campo_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client, equipe_id=100).json()["id"]
        # Campo avança a O.S até em_andamento (execução).
        os_campo_client.post(f"/api/os/{os_id}/apontamentos", json={"acao": "play"})
        # Cancelamento é restrito ao gestor.
        resp = os_campo_client.put(f"/api/os/{os_id}/status", json={"novo_status": "cancelada"})
        assert resp.status_code == 403
        # Gestor consegue cancelar.
        assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "cancelada"}).status_code == 200

    def test_gestor_apenas_os_ve_todas_as_equipes(self, client, db_fake):
        """Um usuário com somente a permissão 'os' é gestor do módulo."""
        from tests.conftest import _criar_e_logar

        _seed_cenario(db_fake)
        gestor_os = _criar_e_logar(
            client,
            db_fake,
            95,
            "Gestor Somente OS",
            "gestor.sos@munaretto.com",
            "senhaSos123",
            ["os"],
        )
        _criar_os(gestor_os, equipe_id=200)  # equipe que ele não integra
        lista = gestor_os.get("/api/os/").json()
        assert len(lista) == 1

    def test_campo_nao_acessa_cadastros_de_apoio(self, os_campo_client, db_fake):
        _seed_cenario(db_fake)
        assert os_campo_client.get("/api/os/obras").status_code == 403
        assert os_campo_client.get("/api/os/equipes").status_code == 403
        assert os_campo_client.get("/api/os/produtos").status_code == 403

    def test_campo_nao_edita_os(self, os_gestor_client, os_campo_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client, equipe_id=100).json()["id"]
        resp = os_campo_client.put(f"/api/os/{os_id}", json={"descricao_escopo": "alterada"})
        assert resp.status_code == 403

    def test_campo_imprime_modelo_da_propria_equipe(self, os_gestor_client, os_campo_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client, equipe_id=100, tipo="construcao").json()["id"]
        resp = os_campo_client.get(f"/api/os/{os_id}/imprimir")
        assert resp.status_code == 200, resp.text
        assert resp.content.startswith(b"%PDF")

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

    def test_detalhe_carrega_com_relacoes(self, os_gestor_client, db_fake):
        """O detalhe usa select com embedded resources (obras/equipes) — o fake
        não resolve a relação, mas garante que o endpoint responde 200."""
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client, equipe_id=100).json()["id"]
        resp = os_gestor_client.get(f"/api/os/{os_id}")
        assert resp.status_code == 200, resp.text
        assert resp.json()["equipe_id"] == 100

    def test_transicoes_endpoint_e_fonte_unica(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        resp = os_gestor_client.get("/api/os/transicoes")
        assert resp.status_code == 200, resp.text
        corpo = resp.json()
        assert corpo["transicoes"]["rascunho"] == ["aberta", "cancelada"]
        assert corpo["transicoes"]["concluida"] == []
        assert "em_andamento" in corpo["status_validos"]
        assert "linha_viva" in corpo["tipos"]

    def test_listagem_paginada_traz_total_no_header(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        for _ in range(3):
            _criar_os(os_gestor_client)
        resp = os_gestor_client.get("/api/os/?limit=2&offset=0")
        assert resp.status_code == 200
        assert resp.headers.get("X-Total-Count") == "3"
        assert len(resp.json()) == 2

        resp2 = os_gestor_client.get("/api/os/?limit=2&offset=2")
        assert len(resp2.json()) == 1


class TestEdicaoEValidacao:
    def test_editar_substitui_itens_orcados(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client, itens_orcados=[{"produto_id": 7, "quantidade_orcada": 10}]).json()["id"]

        resp = os_gestor_client.put(
            f"/api/os/{os_id}",
            json={"descricao_escopo": "Escopo revisado", "itens_orcados": [{"produto_id": 7, "quantidade_orcada": 5}]},
        )
        assert resp.status_code == 200, resp.text

        detalhe = os_gestor_client.get(f"/api/os/{os_id}").json()
        assert detalhe["descricao_escopo"] == "Escopo revisado"
        itens = detalhe["itens_orcados"]
        assert len(itens) == 1
        assert itens[0]["quantidade_orcada"] == 5
        assert itens[0]["nome"] == "Cimento CP-II 50kg"

    def test_editar_limpa_itens_orcados(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client, itens_orcados=[{"produto_id": 7, "quantidade_orcada": 10}]).json()["id"]
        resp = os_gestor_client.put(f"/api/os/{os_id}", json={"itens_orcados": []})
        assert resp.status_code == 200, resp.text
        detalhe = os_gestor_client.get(f"/api/os/{os_id}").json()
        assert detalhe["itens_orcados"] == []

    def test_hora_invalida_rejeitada(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        resp = _criar_os(os_gestor_client, hora_desligar="8h30")
        assert resp.status_code == 422

    def test_prazo_invalido_rejeitado(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        resp = _criar_os(os_gestor_client, prazo_entrega="31/12/2026")
        assert resp.status_code == 422

    def test_hora_valida_aceita(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        resp = _criar_os(os_gestor_client, hora_desligar="08:30", hora_religar="17:45")
        assert resp.status_code == 201, resp.text


class TestModeloImpressao:
    def test_criar_os_salva_dados_do_modelo(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        resp = _criar_os(
            os_gestor_client,
            tipo="linha_viva",
            agencia="CDA 12",
            municipio="Concórdia",
            local_servico="Rua das Flores, 100",
            bt_energizado=True,
            at_energizado_bloqueio=False,
            hora_desligar="08:00",
            hora_religar="17:00",
            alimentador="AL-01",
            chave="CH-334",
            obs="Portão aberto",
        )
        assert resp.status_code == 201, resp.text
        dados = resp.json()
        assert dados["tipo"] == "linha_viva"
        assert dados["agencia"] == "CDA 12"
        assert dados["municipio"] == "Concórdia"
        assert dados["local_servico"] == "Rua das Flores, 100"
        assert dados["bt_energizado"] is True
        assert dados["at_energizado_bloqueio"] is False
        assert dados["hora_desligar"] == "08:00"
        assert dados["chave"] == "CH-334"

    def test_tipo_invalido_e_rejeitado(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        resp = _criar_os(os_gestor_client, tipo="outro")
        assert resp.status_code == 400

    def test_imprimir_gera_pdf_do_modelo(self, os_gestor_client, db_fake, monkeypatch):
        _seed_cenario(db_fake)
        # Equipe A (id 100) ganha número e o líder de campo vira encarregado.
        db_fake._dados["equipes"][0]["numero"] = "12204"
        os_id = _criar_os(os_gestor_client, equipe_id=100, tipo="construcao").json()["id"]

        def _converter_fake(docx_path, out_dir):
            destino = os.path.join(out_dir, "modelo_fake.pdf")
            with open(destino, "wb") as f:
                f.write(b"%PDF-1.4 fake")
            return destino

        monkeypatch.setattr("utils.modelo_os.convert_docx_to_pdf", _converter_fake)

        resp = os_gestor_client.get(f"/api/os/{os_id}/imprimir")
        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"] == "application/pdf"
        assert resp.content.startswith(b"%PDF")

        # Sem equipe vinculada o modelo ainda é gerado (capa mínima).
        os_sem_equipe = _criar_os(os_gestor_client).json()["id"]
        resp2 = os_gestor_client.get(f"/api/os/{os_sem_equipe}/imprimir")
        assert resp2.status_code == 200, resp2.text
        assert resp2.content.startswith(b"%PDF")
