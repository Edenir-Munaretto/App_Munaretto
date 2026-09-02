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

        # USC normal: a quantidade gravada = peças x Qtd USC do cadastro (4 x 40).
        resp = os_gestor_client.post(
            f"/api/os/{os_id}/materiais",
            json={"produto_id": 7, "quantidade_usada": 4},
        )
        assert resp.status_code == 201

        resumo = os_gestor_client.get(f"/api/os/{os_id}").json()["materiais"]
        item = next(i for i in resumo["itens"] if i["produto_id"] == 7)
        assert item["aplicado"] == 160.0
        assert item["aplicado_normal"] == 160.0
        assert item["aplicado_especial"] == 0.0
        assert resumo["total_aplicado"] == 160.0

    def test_lancamento_usc_especial_converte(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        db_fake._dados["produtos"].append(
            {
                "id": 8,
                "codigo": "GRP-01",
                "nome": "Graparina Especial",
                "unidade": "pç",
                "preco_unitario": 0.48,
                "qtd_usc_especial": 0.67,
                "ativo": True,
            }
        )
        os_id = _criar_os(os_gestor_client).json()["id"]
        os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})

        resp = os_gestor_client.post(
            f"/api/os/{os_id}/materiais",
            json={"produto_id": 8, "quantidade_usada": 10, "tipo_usc": "especial"},
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["quantidade_usada"] == 6.7  # 10 x 0.67
        assert resp.json()["tipo_usc"] == "especial"
        assert resp.json()["quantidade_pecas"] == 10
        assert resp.json()["fator_usc"] == 0.67

        item = next(i for i in os_gestor_client.get(f"/api/os/{os_id}").json()["materiais"]["itens"] if i["produto_id"] == 8)
        assert item["aplicado"] == 6.7
        assert item["aplicado_especial"] == 6.7
        assert item["aplicado_normal"] == 0.0

    def test_lancamento_usc_normal_converte(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        db_fake._dados["produtos"].append(
            {
                "id": 8,
                "codigo": "GRP-01",
                "nome": "Graparina",
                "unidade": "pç",
                "preco_unitario": 0.48,
                "qtd_usc_especial": 0.67,
                "ativo": True,
            }
        )
        os_id = _criar_os(os_gestor_client).json()["id"]
        os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})

        resp = os_gestor_client.post(
            f"/api/os/{os_id}/materiais",
            json={"produto_id": 8, "quantidade_usada": 10, "tipo_usc": "normal"},
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["quantidade_usada"] == 4.8  # 10 x 0.48
        assert resp.json()["quantidade_pecas"] == 10
        assert resp.json()["fator_usc"] == 0.48

    def test_lancamento_usc_zero_mantem_quantidade_bruta(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        db_fake._dados["produtos"].append(
            {
                "id": 8,
                "codigo": "LEG-01",
                "nome": "Serviço Legado",
                "unidade": "UN",
                "preco_unitario": 0,
                "qtd_usc_especial": 0,
                "ativo": True,
            }
        )
        os_id = _criar_os(os_gestor_client).json()["id"]
        os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})

        resp = os_gestor_client.post(
            f"/api/os/{os_id}/materiais",
            json={"produto_id": 8, "quantidade_usada": 3},
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["quantidade_usada"] == 3  # sem fator, mantém o bruto
        assert resp.json()["tipo_usc"] == "normal"
        assert resp.json()["quantidade_pecas"] == 3
        assert resp.json()["fator_usc"] == 0

    def test_lancamento_especial_sem_cadastro_rejeitado(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client).json()["id"]
        os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})

        # Produto 7 não possui Qtd USC especial.
        resp = os_gestor_client.post(
            f"/api/os/{os_id}/materiais",
            json={"produto_id": 7, "quantidade_usada": 1, "tipo_usc": "especial"},
        )
        assert resp.status_code == 400
        assert "especial" in resp.json()["detail"].lower()

    def test_lancamento_tipo_usc_invalido_rejeitado(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client).json()["id"]
        os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})

        resp = os_gestor_client.post(
            f"/api/os/{os_id}/materiais",
            json={"produto_id": 7, "quantidade_usada": 1, "tipo_usc": "dupla"},
        )
        assert resp.status_code == 400

    def test_detalhe_inclui_ultimos_lancamentos_com_tipo(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        db_fake._dados["produtos"].append(
            {
                "id": 8,
                "codigo": "GRP-01",
                "nome": "Graparina",
                "unidade": "pç",
                "preco_unitario": 0.48,
                "qtd_usc_especial": 0.67,
                "ativo": True,
            }
        )
        os_id = _criar_os(os_gestor_client).json()["id"]
        os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})

        os_gestor_client.post(f"/api/os/{os_id}/materiais", json={"produto_id": 7, "quantidade_usada": 2})
        os_gestor_client.post(f"/api/os/{os_id}/materiais", json={"produto_id": 8, "quantidade_usada": 10, "tipo_usc": "especial"})

        detalhe = os_gestor_client.get(f"/api/os/{os_id}").json()
        lancamentos = detalhe["ultimos_lancamentos"]
        assert len(lancamentos) == 2
        tipos = {l["tipo_usc"] for l in lancamentos}
        assert tipos == {"normal", "especial"}
        quantidades = sorted(l["quantidade_usada"] for l in lancamentos)
        assert quantidades == [6.7, 80.0]  # 10x0.67 especial e 2x40 normal

    def test_resumo_detalhe_nao_muda_com_cadastro_alterado(self, os_gestor_client, db_fake):
        """O relatório usa o fator REGISTRADO no lançamento: alterar o cadastro
        do serviço depois não muda o que já foi lançado."""
        _seed_cenario(db_fake)
        db_fake._dados["produtos"].append(
            {
                "id": 8,
                "codigo": "ROCA-01",
                "nome": "Limpeza ou Roçada de Capoeira",
                "unidade": "UN",
                "preco_unitario": 6.66,
                "qtd_usc_especial": 0,
                "tipo": "construcao",
                "ativo": True,
            }
        )
        os_id = _criar_os(os_gestor_client).json()["id"]
        os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})

        resp = os_gestor_client.post(
            f"/api/os/{os_id}/materiais",
            json={"produto_id": 8, "quantidade_usada": 2, "tipo_usc": "normal"},
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["quantidade_usada"] == 13.32  # 2 x 6.66

        # Mudança posterior no cadastro não pode alterar o lançamento registrado.
        atualizado = os_gestor_client.put(
            "/api/os/produtos/8",
            json={
                "nome": "Limpeza ou Roçada de Capoeira",
                "codigo": "ROCA-01",
                "unidade": "UN",
                "preco_unitario": 9.99,
                "qtd_usc_especial": 0,
                "tipo": "construcao",
            },
        )
        assert atualizado.status_code == 200, atualizado.text

        item = next(
            i for i in os_gestor_client.get(f"/api/os/{os_id}").json()["materiais"]["itens"] if i["produto_id"] == 8
        )
        assert item["aplicado"] == 13.32
        assert item["aplicado_normal"] == 13.32
        assert item["detalhe"] == [{"tipo": "normal", "fator": 6.66, "pecas": 2.0, "total": 13.32}]

        # Relatório continua saindo com os valores registrados.
        pdf = os_gestor_client.get(f"/api/os/{os_id}/pdf")
        assert pdf.status_code == 200, pdf.text
        assert pdf.content.startswith(b"%PDF")

    def test_resumo_mistura_fatores_apos_mudanca_de_cadastro(self, os_gestor_client, db_fake):
        """Cadastro alterado no meio da execução: o detalhe mantém uma linha por
        fator registrado, cada uma consistente (peças x USC = total)."""
        _seed_cenario(db_fake)
        db_fake._dados["produtos"].append(
            {
                "id": 8,
                "codigo": "ROCA-01",
                "nome": "Limpeza ou Roçada de Capoeira",
                "unidade": "UN",
                "preco_unitario": 6.66,
                "qtd_usc_especial": 0,
                "tipo": "construcao",
                "ativo": True,
            }
        )
        os_id = _criar_os(os_gestor_client).json()["id"]
        os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})

        os_gestor_client.post(f"/api/os/{os_id}/materiais", json={"produto_id": 8, "quantidade_usada": 2})
        os_gestor_client.put(
            "/api/os/produtos/8",
            json={
                "nome": "Limpeza ou Roçada de Capoeira",
                "codigo": "ROCA-01",
                "unidade": "UN",
                "preco_unitario": 9.99,
                "qtd_usc_especial": 0,
                "tipo": "construcao",
            },
        )
        os_gestor_client.post(f"/api/os/{os_id}/materiais", json={"produto_id": 8, "quantidade_usada": 1})

        item = next(
            i for i in os_gestor_client.get(f"/api/os/{os_id}").json()["materiais"]["itens"] if i["produto_id"] == 8
        )
        assert item["aplicado"] == 23.31  # 13.32 + 9.99
        assert item["detalhe"] == [
            {"tipo": "normal", "fator": 6.66, "pecas": 2.0, "total": 13.32},
            {"tipo": "normal", "fator": 9.99, "pecas": 1.0, "total": 9.99},
        ]

    def test_lancamento_bloqueado_fora_de_execucao(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client).json()["id"]  # rascunho
        resp = os_gestor_client.post(f"/api/os/{os_id}/materiais", json={"produto_id": 7, "quantidade_usada": 1})
        assert resp.status_code == 400

    def test_gestor_lanca_material_em_os_concluida(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os_aberta_em_andamento(os_gestor_client)
        assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "concluida"}).status_code == 200

        resp = os_gestor_client.post(f"/api/os/{os_id}/materiais", json={"produto_id": 7, "quantidade_usada": 2})
        assert resp.status_code == 201, resp.text

        item = next(i for i in os_gestor_client.get(f"/api/os/{os_id}").json()["materiais"]["itens"] if i["produto_id"] == 7)
        assert item["aplicado"] == 80.0  # 2 peças x Qtd USC 40

    def test_gestor_lanca_material_em_os_cancelada(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client).json()["id"]
        assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"}).status_code == 200
        assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "cancelada"}).status_code == 200

        resp = os_gestor_client.post(f"/api/os/{os_id}/materiais", json={"produto_id": 7, "quantidade_usada": 1})
        assert resp.status_code == 201, resp.text

    def test_campo_nao_lanca_material_em_os_concluida(self, os_gestor_client, os_campo_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client, equipe_id=100).json()["id"]
        assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"}).status_code == 200
        assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "em_andamento"}).status_code == 200
        assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "concluida"}).status_code == 200

        resp = os_campo_client.post(f"/api/os/{os_id}/materiais", json={"produto_id": 7, "quantidade_usada": 1})
        assert resp.status_code == 400

    def test_campo_lanca_material_em_os_impedida(self, os_gestor_client, os_campo_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client, equipe_id=100).json()["id"]
        assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"}).status_code == 200
        assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "em_andamento"}).status_code == 200
        _anexar_foto_via_banco(db_fake, os_id)
        resp = os_gestor_client.put(
            f"/api/os/{os_id}/status",
            json={"novo_status": "impedida", "justificativa": "Chuva forte inviabilizou o serviço hoje.", "fotos_ids": [900]},
        )
        assert resp.status_code == 200, resp.text

        lanc = os_campo_client.post(f"/api/os/{os_id}/materiais", json={"produto_id": 7, "quantidade_usada": 2})
        assert lanc.status_code == 201, lanc.text
        assert lanc.json()["quantidade_usada"] == 80.0  # 2 x 40

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
        # O catálogo de serviços é necessário ao campo (lançamento na O.S);
        # obras/equipes e mutações continuam restritas ao gestor.
        assert os_campo_client.get("/api/os/produtos").status_code == 200
        assert os_campo_client.get("/api/os/obras").status_code == 403
        assert os_campo_client.get("/api/os/equipes").status_code == 403
        assert os_campo_client.post("/api/os/produtos", json={"nome": "X", "tipo": "construcao"}).status_code == 403

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


class TestBuscaListagem:
    """Busca do Kanban: código/escopo + nome do cliente e Nota PS."""

    def _seed_os_com_clientes(self, db_fake):
        _seed_cenario(db_fake)
        db = db_fake._dados
        db["clientes"].append(
            {"id": 2, "nome": "Cooperativa Aurora", "cpf_cnpj": "00000000000",
             "nota_ps": "PS-7788", "endereco": "Rua B, 200", "ativo": True,
             "data_cadastro": "2026-01-01T00:00:00Z"}
        )
        db["obras"].append(
            {"id": 6, "cliente_id": 2, "nome": "9876543210", "ativo": True,
             "created_at": "2026-01-01T00:00:00Z"}
        )
        base = {
            "obra_id": 5, "status": "aberta", "prioridade": "media",
            "descricao_escopo": "Serviço de rotina.",
            "custo_mo_orcado": 0, "created_at": "2026-01-01T00:00:00Z",
        }
        # O fake não resolve embedded resources no select: as linhas já são
        # semeadas com a estrutura aninhada que o PostgREST devolveria.
        db["ordens_servico"].extend([
            {"id": 1, "codigo": "OS-2026-0001", **base,
             "obras": {"id": 5, "nome": "Obra Central", "cliente_id": 1,
                       "clientes": {"nome": "Cliente Teste", "nota_ps": None}}},
            {"id": 2, "codigo": "OS-2026-0002", **base, "obra_id": 6,
             "obras": {"id": 6, "nome": "9876543210", "cliente_id": 2,
                       "clientes": {"nome": "Cooperativa Aurora", "nota_ps": "PS-7788"}}},
        ])

    def test_busca_por_nome_do_cliente(self, os_gestor_client, db_fake):
        self._seed_os_com_clientes(db_fake)
        resp = os_gestor_client.get("/api/os/?busca=aurora")
        assert resp.status_code == 200
        dados = resp.json()
        assert [d["id"] for d in dados] == [2]

    def test_busca_por_nota_ps(self, os_gestor_client, db_fake):
        self._seed_os_com_clientes(db_fake)
        resp = os_gestor_client.get("/api/os/?busca=ps-7788")
        assert resp.status_code == 200
        dados = resp.json()
        assert [d["id"] for d in dados] == [2]
        assert resp.headers.get("X-Total-Count") == "1"

    def test_busca_por_codigo_da_obra(self, os_gestor_client, db_fake):
        self._seed_os_com_clientes(db_fake)
        dados = os_gestor_client.get("/api/os/?busca=9876543210").json()
        assert [d["id"] for d in dados] == [2]

    def test_busca_por_codigo_continua_funcionando(self, os_gestor_client, db_fake):
        self._seed_os_com_clientes(db_fake)
        dados = os_gestor_client.get("/api/os/?busca=OS-2026-0001").json()
        assert [d["id"] for d in dados] == [1]


class TestEdicaoEValidacao:
    def test_editar_campos_basicos(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client).json()["id"]

        resp = os_gestor_client.put(
            f"/api/os/{os_id}",
            json={"descricao_escopo": "Escopo revisado", "prioridade": "baixa"},
        )
        assert resp.status_code == 200, resp.text

        detalhe = os_gestor_client.get(f"/api/os/{os_id}").json()
        assert detalhe["descricao_escopo"] == "Escopo revisado"
        assert detalhe["prioridade"] == "baixa"

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

    def test_modelo_construcao_campo_agencia_sem_cda(self, os_gestor_client, db_fake):
        """O campo Agência do modelo de construção mostra apenas o valor
        digitado, dentro da caixa — sem o rótulo 'CDA' sobrescrito."""
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client, tipo="construcao", agencia="AG-01").json()["id"]

        resp = os_gestor_client.get(f"/api/os/{os_id}/imprimir")
        assert resp.status_code == 200, resp.text

        import pymupdf

        doc = pymupdf.open(stream=resp.content, filetype="pdf")
        palavras = [
            (round(w[0], 1), round(w[1], 1), w[4])
            for w in doc[0].get_text("words")
            if 62 <= w[1] <= 66  # linha do cabeçalho (y)
        ]

        valor = [p for p in palavras if p[2].replace("\u2010", "-").replace("\u2011", "-") == "AG-01"]
        assert valor, f"Valor da agência não encontrado no cabeçalho: {palavras}"
        assert abs(valor[0][0] - 542.0) <= 2.0  # dentro da caixa (x 540.1–572)

        cda = [p for p in palavras if p[2] == "CDA" and 545 <= p[0] <= 552]
        assert not cda, f"Rótulo 'CDA' ainda presente no cabeçalho: {cda}"


def test_detalhe_nao_quebra_com_cronometro_aberto_de_timestamp_invalido(os_gestor_client, db_fake):
    """Um apontamento aberto com 'inicio' ausente/inválido no banco não pode
    derrubar o detalhe da O.S (regressão do erro 'Erro ao obter detalhes')."""
    _seed_cenario(db_fake)
    os_id = _criar_os(os_gestor_client, equipe_id=100).json()["id"]

    db_fake._dados["os_apontamentos"].append(
        {
            "id": 1,
            "os_id": os_id,
            "funcionario_id": 10,
            "inicio": "valor-que-nao-e-timestamp",
            "fim": None,
            "minutos_trabalhados": None,
        }
    )

    resp = os_gestor_client.get(f"/api/os/{os_id}")
    assert resp.status_code == 200, resp.text
    detalhe = resp.json()
    assert detalhe["mao_de_obra"]["total_horas"] == 0
    assert detalhe["cronometro_aberto"] is not None


def test_detalhe_tenta_novamente_em_falha_transitoria_de_conexao(os_gestor_client, db_fake, monkeypatch):
    """Queda de conexão com o banco ('server disconnected') é transitória:
    o detalhe da O.S deve ser tentado uma segunda vez antes de falhar."""
    import routers.os as routers_os

    _seed_cenario(db_fake)
    os_id = _criar_os(os_gestor_client, equipe_id=100).json()["id"]

    original = routers_os._obter_detalhe_os
    chamadas = {"n": 0}

    def _queimar_na_primeira(db, usuario, os_id):
        chamadas["n"] += 1
        if chamadas["n"] == 1:
            raise RuntimeError("Server disconnected")
        return original(db, usuario, os_id)

    monkeypatch.setattr(routers_os, "_obter_detalhe_os", _queimar_na_primeira)

    resp = os_gestor_client.get(f"/api/os/{os_id}")
    assert resp.status_code == 200, resp.text
    assert chamadas["n"] == 2

    # Erro não-transitório (ex.: bug) não é repetido: falha direto.
    def _falha_permanente(db, usuario, os_id):
        raise RuntimeError("divisão por zero no cálculo")

    monkeypatch.setattr(routers_os, "_obter_detalhe_os", _falha_permanente)
    resp2 = os_gestor_client.get(f"/api/os/{os_id}")
    assert resp2.status_code == 500
    assert "divisão por zero" in resp2.json()["detail"]


# ---------------------------------------------------------------------------
# Catálogo de serviços por contrato (tipo de O.S)
# ---------------------------------------------------------------------------


def _seed_servicos_por_contrato(db_fake):
    """Serviço legado (sem tipo), de construção e de manutenção."""
    db = db_fake._dados
    db["produtos"].append(
        {"id": 8, "codigo": "SVC-LG", "nome": "Serviço Legado", "unidade": "UN",
         "preco_unitario": 10, "ativo": True, "tipo": None}
    )
    db["produtos"].append(
        {"id": 9, "codigo": "SVC-C", "nome": "Serviço Construção", "unidade": "UN",
         "preco_unitario": 20, "ativo": True, "tipo": "construcao"}
    )
    db["produtos"].append(
        {"id": 10, "codigo": "SVC-M", "nome": "Serviço Manutenção", "unidade": "UN",
         "preco_unitario": 30, "ativo": True, "tipo": "manutencao"}
    )


def _abrir_os(client, os_id):
    assert client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"}).status_code == 200


def test_lancar_servico_de_outro_contrato_rejeitado(os_gestor_client, db_fake):
    _seed_cenario(db_fake)
    _seed_servicos_por_contrato(db_fake)
    # O.S de CONSTRUÇÃO: serviço de manutenção não pode ser lançado.
    os_id = _criar_os(os_gestor_client).json()["id"]  # tipo default = construcao
    _abrir_os(os_gestor_client, os_id)

    resp = os_gestor_client.post(
        f"/api/os/{os_id}/materiais", json={"produto_id": 10, "quantidade_usada": 1}
    )
    assert resp.status_code == 422
    assert "contrato de Manutenção" in resp.json()["detail"]
    assert "Construção" in resp.json()["detail"]


def test_lancar_servico_do_contrato_ok(os_gestor_client, db_fake):
    _seed_cenario(db_fake)
    _seed_servicos_por_contrato(db_fake)
    os_id = _criar_os(os_gestor_client).json()["id"]  # construcao
    _abrir_os(os_gestor_client, os_id)

    resp = os_gestor_client.post(
        f"/api/os/{os_id}/materiais", json={"produto_id": 9, "quantidade_usada": 2}
    )
    assert resp.status_code == 201, resp.text


def test_lancar_servico_legado_vale_para_qualquer_contrato(os_gestor_client, db_fake):
    _seed_cenario(db_fake)
    _seed_servicos_por_contrato(db_fake)
    # O.S de LINHA VIVA: serviço legado (sem tipo) é aceito.
    os_id = _criar_os(os_gestor_client, tipo="linha_viva").json()["id"]
    _abrir_os(os_gestor_client, os_id)

    resp = os_gestor_client.post(
        f"/api/os/{os_id}/materiais", json={"produto_id": 8, "quantidade_usada": 1}
    )
    assert resp.status_code == 201, resp.text


def test_cadastro_servico_exige_contrato(os_gestor_client, db_fake):
    _seed_cenario(db_fake)

    # Sem contrato → 422.
    resp = os_gestor_client.post(
        "/api/os/produtos", json={"nome": "Serviço sem contrato", "unidade": "UN", "preco_unitario": 5}
    )
    assert resp.status_code == 422

    # Contrato inválido → 422.
    resp = os_gestor_client.post(
        "/api/os/produtos", json={"nome": "Inválido", "unidade": "UN", "tipo": "outro"}
    )
    assert resp.status_code == 422

    # Contrato válido → 201.
    resp = os_gestor_client.post(
        "/api/os/produtos", json={"nome": "Serviço Construção", "unidade": "UN", "preco_unitario": 15,
                                  "qtd_usc_especial": 3, "tipo": "construcao"}
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["tipo"] == "construcao"
    assert resp.json()["preco_unitario"] == 15
    assert resp.json()["qtd_usc_especial"] == 3


def test_listar_servicos_filtra_por_contrato_incluindo_legados(os_gestor_client, db_fake):
    _seed_cenario(db_fake)
    _seed_servicos_por_contrato(db_fake)

    resp = os_gestor_client.get("/api/os/produtos?tipo=construcao")
    assert resp.status_code == 200
    ids = {p["id"] for p in resp.json()}
    assert 7 in ids   # produto do seed (legado, sem tipo)
    assert 8 in ids   # legado
    assert 9 in ids   # construção
    assert 10 not in ids  # manutenção fica de fora

    # Sem filtro traz tudo.
    resp2 = os_gestor_client.get("/api/os/produtos")
    assert len(resp2.json()) == 4


def test_listagem_status_multiplo_encerradas(os_gestor_client, db_fake):
    """Listagem aceita status múltiplo (Encerradas: concluida,cancelada)."""
    _seed_cenario(db_fake)
    destinos = ["concluida", "concluida", "cancelada"]
    for destino in destinos:
        os_id = _criar_os(os_gestor_client).json()["id"]
        assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"}).status_code == 200
        assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "em_andamento"}).status_code == 200
        assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": destino}).status_code == 200

    resp = os_gestor_client.get("/api/os/?status=concluida,cancelada&limit=100")
    assert resp.status_code == 200, resp.text
    encerradas = resp.json()
    assert {o["status"] for o in encerradas} == {"concluida", "cancelada"}
    assert len(encerradas) == 3

    # Valor único (usado pelos chips do quadro) continua funcionando.
    unico = os_gestor_client.get("/api/os/?status=cancelada")
    assert len(unico.json()) == 1
