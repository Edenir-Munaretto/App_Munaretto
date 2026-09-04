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
        # O.S liberada para o campo (fora do rascunho, onde H.H. é proibido).
        assert os_campo_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"}).status_code == 200
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

    def test_lancamento_grava_codigo_servico_segundo_tipo(self, os_gestor_client, db_fake):
        """O mesmo serviço tem códigos distintos por tipo; o lançamento grava o
        snapshot do código correspondente à escolha (normal/especial)."""
        _seed_cenario(db_fake)
        db_fake._dados["produtos"].append(
            {
                "id": 8,
                "codigo": "GRP-01",
                "codigo_especial": "GRP-ESP",
                "nome": "Graparina",
                "unidade": "pç",
                "preco_unitario": 0.48,
                "qtd_usc_especial": 0.67,
                "ativo": True,
            }
        )
        os_id = _criar_os(os_gestor_client).json()["id"]
        os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"})

        normal = os_gestor_client.post(
            f"/api/os/{os_id}/materiais",
            json={"produto_id": 8, "quantidade_usada": 2, "tipo_usc": "normal"},
        )
        assert normal.status_code == 201, normal.text
        assert normal.json()["codigo_servico"] == "GRP-01"

        especial = os_gestor_client.post(
            f"/api/os/{os_id}/materiais",
            json={"produto_id": 8, "quantidade_usada": 2, "tipo_usc": "especial"},
        )
        assert especial.status_code == 201, especial.text
        assert especial.json()["codigo_servico"] == "GRP-ESP"

        # O detalhe devolve o código em cada lançamento individual.
        detalhe = os_gestor_client.get(f"/api/os/{os_id}").json()
        codigos = [l["codigo_servico"] for l in detalhe["ultimos_lancamentos"]]
        assert sorted(codigos) == ["GRP-01", "GRP-ESP"]

        # O resumo agrupa por (tipo, fator, código) — cada linha do relatório
        # carrega o código do lançamento original.
        resumo = detalhe["materiais"]["itens"]
        item = next(i for i in resumo if i["produto_id"] == 8)
        detalhes = sorted(item["detalhe"], key=lambda d: d["tipo"])
        assert [(d["codigo_servico"], d["tipo"]) for d in detalhes] == [
            ("GRP-ESP", "especial"),
            ("GRP-01", "normal"),
        ]

    def test_lancamento_especial_sem_codigo_proprio_usa_normal(self, os_gestor_client, db_fake):
        """Fallback: serviço sem codigo_especial cadastrado grava o código normal."""
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
            json={"produto_id": 8, "quantidade_usada": 10, "tipo_usc": "especial"},
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["codigo_servico"] == "GRP-01"

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
        assert item["detalhe"] == [{"tipo": "normal", "fator": 6.66, "codigo_servico": "ROCA-01", "pecas": 2.0, "total": 13.32}]

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
            {"tipo": "normal", "fator": 6.66, "codigo_servico": "ROCA-01", "pecas": 2.0, "total": 13.32},
            {"tipo": "normal", "fator": 9.99, "codigo_servico": "ROCA-01", "pecas": 1.0, "total": 9.99},
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
        # Reabertura pelo gestor: encerradas podem voltar para 'aberta'.
        assert corpo["transicoes"]["concluida"] == ["aberta"]
        assert corpo["transicoes"]["cancelada"] == ["aberta"]
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

    # Erro não-transitório (ex.: bug) não é repetido: falha direto com
    # mensagem GENÉRICA (não vaza a exceção interna).
    def _falha_permanente(db, usuario, os_id):
        raise RuntimeError("divisão por zero no cálculo")

    monkeypatch.setattr(routers_os, "_obter_detalhe_os", _falha_permanente)
    resp2 = os_gestor_client.get(f"/api/os/{os_id}")
    assert resp2.status_code == 500
    assert resp2.json()["detail"] == "Erro ao obter detalhes da O.S."
    assert "divisão" not in resp2.json()["detail"]


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


def test_cadastro_servico_com_codigos_normal_e_especial(os_gestor_client, db_fake):
    _seed_cenario(db_fake)

    resp = os_gestor_client.post(
        "/api/os/produtos",
        json={"nome": "Corte e religação", "codigo": "CR-01", "codigo_especial": "CR-ESP",
              "unidade": "UN", "preco_unitario": 0.48, "qtd_usc_especial": 0.67,
              "tipo": "manutencao"},
    )
    assert resp.status_code == 201, resp.text
    corpo = resp.json()
    assert corpo["codigo"] == "CR-01"
    assert corpo["codigo_especial"] == "CR-ESP"

    # O fake não aplica default de coluna; alinha com o banco real (ativo=true).
    next(p for p in db_fake._dados["produtos"] if p["id"] == corpo["id"])["ativo"] = True

    # Busca por nome ou por qualquer um dos códigos encontra o serviço.
    for termo in ("Corte", "CR-01", "CR-ESP"):
        busca = os_gestor_client.get(f"/api/os/produtos?busca={termo}")
        assert busca.status_code == 200
        assert {p["id"] for p in busca.json()} == {corpo["id"]}, termo

    # Espaços nas bordas dos códigos são removidos (e vazio vira nulo).
    resp2 = os_gestor_client.post(
        "/api/os/produtos",
        json={"nome": "Serviço com espaços", "codigo": "  ESP-DOIS  ", "codigo_especial": "  ",
              "tipo": "construcao"},
    )
    assert resp2.status_code == 201, resp2.text
    assert resp2.json()["codigo"] == "ESP-DOIS"
    assert resp2.json()["codigo_especial"] is None


def test_cadastro_servico_rejeita_codigo_duplicado_entre_campos(os_gestor_client, db_fake):
    """Códigos compartilham um namespace único: um código não pode ser o
    normal de um serviço e o especial de outro."""
    _seed_cenario(db_fake)

    a = os_gestor_client.post(
        "/api/os/produtos",
        json={"nome": "Serviço A", "codigo": "ABC-1", "tipo": "construcao"},
    )
    assert a.status_code == 201, a.text

    # Serviço B tenta usar "ABC-1" como código ESPECIAL -> conflito.
    b = os_gestor_client.post(
        "/api/os/produtos",
        json={"nome": "Serviço B", "codigo_especial": "ABC-1", "tipo": "construcao"},
    )
    assert b.status_code == 400
    assert "ABC-1" in b.json()["detail"]

    # Um serviço não pode ter o código normal igual ao especial.
    c = os_gestor_client.post(
        "/api/os/produtos",
        json={"nome": "Serviço C", "codigo": "XYZ", "codigo_especial": "XYZ", "tipo": "construcao"},
    )
    assert c.status_code == 400

    # Editar o PRÓPRIO registro mantendo os códigos é permitido.
    ed = os_gestor_client.put(
        f"/api/os/produtos/{a.json()['id']}",
        json={"nome": "Serviço A editado", "codigo": "ABC-1", "codigo_especial": "ABC-ESP",
              "tipo": "construcao"},
    )
    assert ed.status_code == 200, ed.text
    assert ed.json()["codigo_especial"] == "ABC-ESP"


def test_lancar_servico_de_outro_contrato_rejeitado_m_lv(os_gestor_client, db_fake):
    """Contratos INDEPENDENTES: manutenção e linha viva NÃO compartilham
    catálogo — lançamento cruzado é rejeitado nos dois sentidos (422)."""
    _seed_cenario(db_fake)
    _seed_servicos_por_contrato(db_fake)
    db_fake._dados["produtos"].append(
        {"id": 11, "codigo": "SVC-LV", "nome": "Serviço Linha Viva", "unidade": "UN",
         "preco_unitario": 40, "ativo": True, "tipo": "linha_viva"}
    )

    # O.S de LINHA VIVA tentando lançar serviço de MANUTENÇÃO (produto 10).
    os_lv = _criar_os(os_gestor_client, tipo="linha_viva").json()["id"]
    _abrir_os(os_gestor_client, os_lv)
    resp = os_gestor_client.post(
        f"/api/os/{os_lv}/materiais", json={"produto_id": 10, "quantidade_usada": 1}
    )
    assert resp.status_code == 422, resp.text

    # O.S de MANUTENÇÃO tentando lançar serviço de LINHA VIVA (produto 11).
    os_m = _criar_os(os_gestor_client, tipo="manutencao").json()["id"]
    _abrir_os(os_gestor_client, os_m)
    resp2 = os_gestor_client.post(
        f"/api/os/{os_m}/materiais", json={"produto_id": 11, "quantidade_usada": 1}
    )
    assert resp2.status_code == 422, resp2.text


def test_listar_servicos_contratos_independentes(os_gestor_client, db_fake):
    """Filtro por tipo ESTRITO: cada contrato retorna apenas o SEU catálogo
    (+ legados); manutenção e linha viva não se misturam."""
    _seed_cenario(db_fake)
    _seed_servicos_por_contrato(db_fake)
    db_fake._dados["produtos"].append(
        {"id": 11, "codigo": "SVC-LV", "nome": "Serviço Linha Viva", "unidade": "UN",
         "preco_unitario": 40, "ativo": True, "tipo": "linha_viva"}
    )

    lv = os_gestor_client.get("/api/os/produtos?tipo=linha_viva")
    assert lv.status_code == 200
    ids_lv = {p["id"] for p in lv.json()}
    assert 8 in ids_lv and 11 in ids_lv  # legado + linha viva
    assert 9 not in ids_lv               # construção isolada
    assert 10 not in ids_lv              # manutenção NÃO entra no catálogo de linha viva

    man = os_gestor_client.get("/api/os/produtos?tipo=manutencao")
    ids_man = {p["id"] for p in man.json()}
    assert 8 in ids_man and 10 in ids_man
    assert 9 not in ids_man
    assert 11 not in ids_man

    constr = os_gestor_client.get("/api/os/produtos?tipo=construcao")
    ids_constr = {p["id"] for p in constr.json()}
    assert 8 in ids_constr and 9 in ids_constr
    assert {10, 11}.isdisjoint(ids_constr)


def test_cadastro_mesmo_codigo_em_contratos_diferentes_coexiste(os_gestor_client, db_fake):
    """Contratos independentes: o MESMO código pode ser cadastrado em contratos
    diferentes; duplicar no MESMO contrato é rejeitado."""
    _seed_cenario(db_fake)

    m = os_gestor_client.post(
        "/api/os/produtos",
        json={"nome": "Serviço compartilhado", "codigo": "653608", "tipo": "manutencao"},
    )
    assert m.status_code == 201, m.text

    lv = os_gestor_client.post(
        "/api/os/produtos",
        json={"nome": "Serviço compartilhado", "codigo": "653608", "tipo": "linha_viva"},
    )
    assert lv.status_code == 201, lv.text  # catálogo de outro contrato: permitido

    ct = os_gestor_client.post(
        "/api/os/produtos",
        json={"nome": "Serviço compartilhado", "codigo": "653608", "tipo": "construcao"},
    )
    assert ct.status_code == 201, ct.text

    # Mesmo código no MESMO contrato: bloqueado.
    dup = os_gestor_client.post(
        "/api/os/produtos",
        json={"nome": "Outro", "codigo": "653608", "tipo": "manutencao"},
    )
    assert dup.status_code == 400

    # Código normal de um contrato NÃO colide com código de outro contrato,
    # mas colide com legado (tipo NULL), que vale para todos.
    legado = os_gestor_client.post(
        "/api/os/produtos",
        json={"nome": "Legado", "codigo": "LEG-9", "tipo": "manutencao"},
    )
    assert legado.status_code == 201, legado.text
    db_fake._dados["produtos"].append(
        {"id": 999, "codigo": "LEG-9", "nome": "Legado sem contrato", "unidade": "UN",
         "preco_unitario": 1, "ativo": True, "tipo": None}
    )
    bloqueado = os_gestor_client.post(
        "/api/os/produtos",
        json={"nome": "Colide com legado", "codigo": "LEG-9", "tipo": "linha_viva"},
    )
    assert bloqueado.status_code == 400


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


def test_listar_produtos_retorna_catalogo_completo_acima_de_50(os_gestor_client, db_fake):
    """O catálogo alimenta cadastro, lançamento e Modo Campo: listar_produtos
    NÃO pode truncar em 50 (regressão: serviços além do corte sumiam da busca)."""
    dados = db_fake._dados["produtos"]
    for i in range(1, 121):
        dados.append(
            {
                "id": i,
                "codigo": f"COD-{i:03d}",
                "codigo_especial": None,
                "nome": f"Serviço de catálogo número {i:03d}",
                "unidade": "UN",
                "preco_unitario": 1.0,
                "qtd_usc_especial": 0.0,
                "tipo": "manutencao" if i % 20 == 0 else None,  # 6 de manutenção
                "ativo": True,
            }
        )

    todos = os_gestor_client.get("/api/os/produtos")
    assert todos.status_code == 200
    assert len(todos.json()) == 120

    constr = os_gestor_client.get("/api/os/produtos?tipo=construcao")
    assert constr.status_code == 200
    assert len(constr.json()) == 114  # 120 - 6 (manutenção)

    manu = os_gestor_client.get("/api/os/produtos?tipo=manutencao")
    assert len(manu.json()) == 120  # legados (tipo None) valem para manutenção

    # Busca por código além do antigo corte de 50 agora retorna o serviço.
    busca = os_gestor_client.get("/api/os/produtos?busca=COD-119")
    assert busca.status_code == 200
    assert [p["codigo"] for p in busca.json()] == ["COD-119"]


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


# ---------------------------------------------------------------------------
# Exclusão de O.S (gestor; rascunho ou encerradas)
# ---------------------------------------------------------------------------


class _S3Vazio:
    def delete_object(self, **kwargs):
        return {}


def _monkeypatch_s3(monkeypatch):
    monkeypatch.setattr("routers.os.get_s3_client", lambda: _S3Vazio())
    monkeypatch.setattr("routers.os.bucket", lambda: "bucket-teste")


def test_excluir_os_rascunho(os_gestor_client, db_fake, monkeypatch):
    _seed_cenario(db_fake)
    _monkeypatch_s3(monkeypatch)
    os_id = _criar_os(os_gestor_client).json()["id"]

    resp = os_gestor_client.delete(f"/api/os/{os_id}")
    assert resp.status_code == 200, resp.text

    lista = os_gestor_client.get("/api/os/").json()
    assert all(o["id"] != os_id for o in lista)


def test_excluir_os_concluida_e_cancelada(os_gestor_client, db_fake, monkeypatch):
    _seed_cenario(db_fake)
    _monkeypatch_s3(monkeypatch)
    for destino in ("concluida", "cancelada"):
        os_id = _criar_os(os_gestor_client).json()["id"]
        if destino == "concluida":
            assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"}).status_code == 200
            assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "em_andamento"}).status_code == 200
        assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": destino}).status_code == 200
        resp = os_gestor_client.delete(f"/api/os/{os_id}")
        assert resp.status_code == 200, resp.text


def test_excluir_os_em_andamento_bloqueada(os_gestor_client, db_fake, monkeypatch):
    _seed_cenario(db_fake)
    _monkeypatch_s3(monkeypatch)
    os_id = _criar_os(os_gestor_client).json()["id"]
    assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"}).status_code == 200
    assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "em_andamento"}).status_code == 200

    resp = os_gestor_client.delete(f"/api/os/{os_id}")
    assert resp.status_code == 400
    assert "rascunho" in resp.json()["detail"]

    # A O.S continua existindo
    assert os_gestor_client.get(f"/api/os/{os_id}").status_code == 200


def test_excluir_os_campo_negado(os_gestor_client, os_campo_client, db_fake, monkeypatch):
    _seed_cenario(db_fake)
    _monkeypatch_s3(monkeypatch)
    os_id = _criar_os(os_gestor_client).json()["id"]
    resp = os_campo_client.delete(f"/api/os/{os_id}")
    assert resp.status_code == 403


def test_excluir_os_inexistente(os_gestor_client, db_fake, monkeypatch):
    _seed_cenario(db_fake)
    _monkeypatch_s3(monkeypatch)
    resp = os_gestor_client.delete("/api/os/999999")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Obras com Cliente Celesc (sem cadastro de clientes)
# ---------------------------------------------------------------------------


def _injetar_cliente_cadastro(db_fake):
    db_fake._dados["clientes"].append(
        {
            "id": 55,
            "nome": "Construtora Alfa",
            "cpf_cnpj": "00000000000000",
            "nota_ps": "PS-ALFA-1",
            "endereco": "Av. Central, 100",
            "cidade": "Lages",
            "ativo": True,
        }
    )


def test_criar_obra_cliente_celesc_sem_cadastro(os_gestor_client, db_fake):
    _seed_cenario(db_fake)
    resp = os_gestor_client.post(
        "/api/os/obras",
        json={
            "cliente_id": None,
            "cliente_celesc": "Celesc - Regional X",
            "nome": "PS-TESTE-901",
            "cidade": "Florianópolis",
            "endereco": "Rodovia BR-101",
        },
    )
    assert resp.status_code == 201, resp.text
    obra = resp.json()
    assert obra["cliente_id"] is None
    assert obra["cliente_celesc"] == "Celesc - Regional X"


def test_criar_obra_com_cliente_do_cadastro(os_gestor_client, db_fake):
    _seed_cenario(db_fake)
    _injetar_cliente_cadastro(db_fake)
    resp = os_gestor_client.post(
        "/api/os/obras",
        json={"cliente_id": 55, "cliente_celesc": None, "nome": "PS-ALFA-1", "cidade": None, "endereco": None},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["cliente_id"] == 55


def test_criar_obra_sem_cliente_rejeitado(os_gestor_client, db_fake):
    _seed_cenario(db_fake)
    resp = os_gestor_client.post(
        "/api/os/obras",
        json={"cliente_id": None, "cliente_celesc": None, "nome": "PS-SEMCLIENTE", "cidade": None, "endereco": None},
    )
    assert resp.status_code == 400


def test_criar_obra_ambos_clientes_rejeitado(os_gestor_client, db_fake):
    _seed_cenario(db_fake)
    resp = os_gestor_client.post(
        "/api/os/obras",
        json={"cliente_id": 1, "cliente_celesc": "Celesc", "nome": "PS-AMBOS", "cidade": None, "endereco": None},
    )
    assert resp.status_code == 400


def test_atualizar_obra_vincula_cliente_cadastro_depois(os_gestor_client, db_fake):
    _seed_cenario(db_fake)
    criada = os_gestor_client.post(
        "/api/os/obras",
        json={"cliente_id": None, "cliente_celesc": "Celesc Regional", "nome": "PS-TROCA", "cidade": None, "endereco": None},
    ).json()
    _injetar_cliente_cadastro(db_fake)

    resp = os_gestor_client.put(
        f"/api/os/obras/{criada['id']}",
        json={"cliente_id": 55, "cliente_celesc": None, "nome": "PS-TROCA", "cidade": None, "endereco": None},
    )
    assert resp.status_code == 200, resp.text
    obra = resp.json()
    assert obra["cliente_id"] == 55
    assert obra["cliente_celesc"] is None


def test_listar_obras_filtra_por_cliente_celesc(os_gestor_client, db_fake):
    _seed_cenario(db_fake)
    os_gestor_client.post(
        "/api/os/obras",
        json={"cliente_id": None, "cliente_celesc": "Celesc Regional Sul", "nome": "PS-CEL-1", "cidade": None, "endereco": None},
    )
    # O fake nǜo aplica os defaults do banco (ativo=true) no insert.
    db_fake._dados["obras"][-1]["ativo"] = True
    resp = os_gestor_client.get("/api/os/obras?busca=Regional Sul")
    assert resp.status_code == 200, resp.text
    assert any(o["cliente_celesc"] == "Celesc Regional Sul" for o in resp.json())


# ---------------------------------------------------------------------------
# Concorrência de status e sanidade de apontamentos (A1/A3)
# ---------------------------------------------------------------------------


class TestStatusTransicaoAtomica:
    """A1: update de status com condição de estado (read-modify-write atômico).

    O fake serializa as requisições, então a corrida real (ler estado antigo e
    atualizar depois que outro dispositivo mudou) é emulada gravando a mudança
    do "outro dispositivo" no instante do UPDATE.
    """

    def test_mudanca_concorrente_recebe_409(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client).json()["id"]
        assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"}).status_code == 200

        # "Outro dispositivo" aplica a transição no meio da requisição (entre a
        # leitura/validação e o update do primeiro).
        real_table = db_fake.table

        def _table_com_corrida(nome):
            q = real_table(nome)
            if nome != "ordens_servico":
                return q
            execucao_original = q.execute

            def execute():
                if q._update_payload is not None:
                    linha = next(o for o in db_fake._dados["ordens_servico"] if o["id"] == os_id)
                    linha["status"] = "em_andamento"
                return execucao_original()

            q.execute = execute
            return q

        db_fake.table = _table_com_corrida

        resp = os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "em_andamento"})
        assert resp.status_code == 409
        assert "alterada por outra pessoa" in resp.json()["detail"]
        # O estado final é o do vencedor da corrida (não foi sobrescrito).
        linha = next(o for o in db_fake._dados["ordens_servico"] if o["id"] == os_id)
        assert linha["status"] == "em_andamento"


class TestApontamentoHorasSanidade:
    """A3: H.H. bloqueado em rascunho e parâmetros de origem restritos na web."""

    def test_play_em_rascunho_rejeitado(self, os_gestor_client, os_campo_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client, equipe_id=100).json()["id"]  # nasce em 'rascunho'

        resp = os_campo_client.post(f"/api/os/{os_id}/apontamentos", json={"acao": "play"})
        assert resp.status_code == 400
        assert "rascunho" in resp.json()["detail"].lower()
        assert db_fake._dados["os_apontamentos"] == []

    def test_web_nao_aceita_inicio_fim(self, os_gestor_client, os_campo_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client, equipe_id=100).json()["id"]
        assert os_campo_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"}).status_code == 200

        resp = os_campo_client.post(
            f"/api/os/{os_id}/apontamentos?inicio=2026-08-28T08:00:00Z&fim=2026-08-28T10:00:00Z",
            json={"acao": "play"},
        )
        assert resp.status_code == 400
        assert "sincronização offline" in resp.json()["detail"]
        assert db_fake._dados["os_apontamentos"] == []

# ---------------------------------------------------------------------------
# Lote 3 - robustez (busca sanitizada, rollback/retry da criação, membros)
# ---------------------------------------------------------------------------


def test_busca_com_caracteres_da_gramatica_postgrest_nao_derruba(os_gestor_client, db_fake):
    """Busca com '(', ')' e ',' não pode virar 500 (gramática do or_ do PostgREST)."""
    _seed_cenario(db_fake)
    os_id = _criar_os(os_gestor_client).json()["id"]

    for termo in ("OS-2026-(0", "a,b", "código)", "1.5", "x%y"):
        resp = os_gestor_client.get(f"/api/os/?busca={termo}")
        assert resp.status_code == 200, f"busca '{termo}' -> {resp.status_code}"

    resp = os_gestor_client.get("/api/os/?busca=OS-2026-(0")
    assert resp.status_code == 200
    assert any(o["id"] == os_id for o in resp.json())


def test_criar_os_faz_rollback_se_snapshot_falhar(os_gestor_client, db_fake, monkeypatch):
    """Falha no snapshot do checklist não pode deixar O.S órfã/parcial."""
    import routers.os as routers_os

    _seed_cenario(db_fake)

    def _snapshot_que_estoura(db, os_id):
        raise RuntimeError("falha de banco no snapshot")

    monkeypatch.setattr(routers_os, "snapshot_checklist", _snapshot_que_estoura)

    resp = _criar_os(os_gestor_client)
    assert resp.status_code == 500
    assert db_fake._dados["ordens_servico"] == []  # rollback removeu a O.S
    assert db_fake._dados["os_historico"] == []


def test_criar_os_retenta_quando_codigo_colide_no_insert(os_gestor_client, db_fake, monkeypatch):
    """Corrida TOCTOU do código: colisão no INSERT (não só na leitura) regenera
    o código em vez de devolver 500."""
    import routers.os as routers_os

    _seed_cenario(db_fake)
    # Outra O.S (criação concorrente) já tomou o próximo código sequencial.
    db_fake._dados["ordens_servico"].append(
        {"id": 99, "codigo": "OS-2026-0001", "obra_id": 5, "status": "rascunho", "prioridade": "alta"}
    )
    codigos = iter(["OS-2026-0001", "OS-2026-0002", "OS-2026-0003"])
    monkeypatch.setattr(routers_os, "_gerar_codigo_os", lambda db: next(codigos))

    real_table = db_fake.table

    def _table_com_unique(nome):
        q = real_table(nome)
        if nome != "ordens_servico":
            return q
        insert_original = q.insert

        def insert(payload):
            itens = payload if isinstance(payload, list) else [payload]
            for it in itens:
                if any(r.get("codigo") == it.get("codigo") for r in db_fake._dados["ordens_servico"]):
                    raise Exception('duplicate key value violates unique constraint (SQLSTATE 23505)')
            return insert_original(payload)

        q.insert = insert
        return q

    db_fake.table = _table_com_unique

    resp = _criar_os(os_gestor_client)
    assert resp.status_code == 201, resp.text
    assert resp.json()["codigo"] == "OS-2026-0002"
    codigos_gravados = [o["codigo"] for o in db_fake._dados["ordens_servico"]]
    assert codigos_gravados.count("OS-2026-0001") == 1  # sem duplicar a concorrente


def test_upload_foto_acima_do_limite_rejeitado_sem_gravar(os_gestor_client, db_fake):
    """Foto acima de 15 MB é recusada pela leitura limitada (antes do B2)."""
    from tests.test_checklist_os import _seed_modelos

    _seed_cenario(db_fake)
    _seed_modelos(db_fake)
    os_id = _criar_os(os_gestor_client).json()["id"]
    item = None
    for it in db_fake._dados["os_checklist_itens"]:
        if it["os_id"] == os_id:
            item = it
            break

    grande = b"x" * (15 * 1024 * 1024 + 1)
    resp = os_gestor_client.post(
        f"/api/os/{os_id}/checklist/{item['id']}/foto",
        files={"arquivo": ("grande.jpg", grande, "image/jpeg")},
    )
    assert resp.status_code == 400
    assert "15 MB" in resp.json()["detail"]
    assert db_fake._dados["os_fotos"] == []

def test_equipe_recusa_membro_inexistente(os_gestor_client, db_fake):
    """_gravar_membros valida a existência dos funcionários ANTES de gravar."""
    _seed_cenario(db_fake)
    antes = len(db_fake._dados["equipe_membros"])
    resp = os_gestor_client.post(
        "/api/os/equipes", json={"nome": "Equipe Inexistente", "membro_ids": [9999], "lider_id": 9999}
    )
    assert resp.status_code == 400
    assert "não encontrado" in resp.json()["detail"]
    # Nenhum vínculo foi gravado (nem a equipe).
    assert len(db_fake._dados["equipe_membros"]) == antes
    assert all(e["nome"] != "Equipe Inexistente" for e in db_fake._dados["equipes"])


def test_equipe_mudanca_de_membros_aplica_diferenca_sem_recriar(os_gestor_client, db_fake):
    """Troca de membros preserva os vínculos mantidos (diff, sem delete+insert
    total que poderia deixar a equipe vazia em falha parcial)."""
    _seed_cenario(db_fake)
    db_fake._dados["funcionarios"].append({"id": 11, "nome": "Membro 2", "cpf": "22222222222", "ativo": True})

    criada = os_gestor_client.post(
        "/api/os/equipes", json={"nome": "Equipe Lote3", "membro_ids": [10], "lider_id": 10}
    )
    assert criada.status_code == 201, criada.text
    eq_id = criada.json()["id"]
    linha10 = next(m for m in db_fake._dados["equipe_membros"] if m["funcionario_id"] == 10 and m["equipe_id"] == eq_id)

    # Entra o membro 11 e a liderança muda (10 continua na equipe).
    r = os_gestor_client.put(
        f"/api/os/equipes/{eq_id}", json={"nome": "Equipe Lote3", "membro_ids": [10, 11], "lider_id": 11}
    )
    assert r.status_code == 200, r.text
    linhas = [m for m in db_fake._dados["equipe_membros"] if m["equipe_id"] == eq_id]
    assert {m["funcionario_id"] for m in linhas} == {10, 11}
    atual_10 = next(m for m in linhas if m["funcionario_id"] == 10)
    assert atual_10["id"] == linha10["id"]  # vínculo mantido, não recriado
    assert atual_10["lider"] is False
    assert next(m for m in linhas if m["funcionario_id"] == 11)["lider"] is True

    # Sai o 10: a equipe fica só com o 11 (mantido).
    r2 = os_gestor_client.put(
        f"/api/os/equipes/{eq_id}", json={"nome": "Equipe Lote3", "membro_ids": [11], "lider_id": 11}
    )
    assert r2.status_code == 200, r2.text
    assert {m["funcionario_id"] for m in db_fake._dados["equipe_membros"] if m["equipe_id"] == eq_id} == {11}

class TestReaberturaOs:
    """Reabertura de O.S concluida/cancelada pelo gestor (decisão nº 2)."""

    def test_gestor_reabre_os_concluida_com_justificativa(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os_aberta_em_andamento(os_gestor_client)
        assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "concluida"}).status_code == 200

        resp = os_gestor_client.put(
            f"/api/os/{os_id}/status",
            json={"novo_status": "aberta", "justificativa": "Cliente pediu retorno da equipe para acabamento."},
        )
        assert resp.status_code == 200, resp.text
        detalhe = os_gestor_client.get(f"/api/os/{os_id}").json()
        assert detalhe["status"] == "aberta"
        assert detalhe["data_fim"] is None  # voltou ao funil sem data de encerramento

        evento = next(
            h for h in db_fake._dados["os_historico"]
            if h["os_id"] == os_id and h["status_anterior"] == "concluida" and h["status_novo"] == "aberta"
        )
        assert "acabamento" in (evento["justificativa"] or "")

    def test_reabrir_cancelada_tambem_volta_ao_funil(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client).json()["id"]
        assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "cancelada"}).status_code == 200
        resp = os_gestor_client.put(
            f"/api/os/{os_id}/status",
            json={"novo_status": "aberta", "justificativa": "Cancelamento indevido; O.S volta para análise."},
        )
        assert resp.status_code == 200, resp.text
        assert os_gestor_client.get(f"/api/os/{os_id}").json()["status"] == "aberta"

    def test_reabertura_exige_gestor(self, os_gestor_client, os_campo_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os(os_gestor_client, equipe_id=100).json()["id"]
        assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "cancelada"}).status_code == 200
        resp = os_campo_client.put(
            f"/api/os/{os_id}/status",
            json={"novo_status": "aberta", "justificativa": "Campo tentando reabrir a O.S."},
        )
        assert resp.status_code == 403

    def test_reabertura_exige_justificativa(self, os_gestor_client, db_fake):
        _seed_cenario(db_fake)
        os_id = _criar_os_aberta_em_andamento(os_gestor_client)
        assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "concluida"}).status_code == 200

        resp = os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta", "justificativa": "curta"})
        assert resp.status_code == 422
        assert "justificativa" in resp.json()["detail"]
        assert os_gestor_client.get(f"/api/os/{os_id}").json()["status"] == "concluida"


def test_editar_os_parcial_nao_zera_campos_omissos(os_gestor_client, db_fake):
    """PUT parcial (só escopo) não pode zerar tipo/prioridade etc (exclude_unset)."""
    _seed_cenario(db_fake)
    os_id = _criar_os(os_gestor_client).json()["id"]  # tipo construcao, prioridade alta

    resp = os_gestor_client.put(f"/api/os/{os_id}", json={"descricao_escopo": "Novo escopo parcial."})
    assert resp.status_code == 200, resp.text
    detalhe = os_gestor_client.get(f"/api/os/{os_id}").json()
    assert detalhe["descricao_escopo"] == "Novo escopo parcial."
    assert detalhe["tipo"] == "construcao"
    assert detalhe["prioridade"] == "alta"
    assert detalhe["custo_mo_orcado"] == 5000


def test_enviar_foto_normaliza_nome_do_arquivo(os_gestor_client, db_fake, monkeypatch):
    """Nome de arquivo do cliente vira apenas basename (sem caminho) e truncado."""
    from tests.test_checklist_os import _FakeS3

    _seed_cenario(db_fake)
    os_id = _criar_os(os_gestor_client, equipe_id=100).json()["id"]

    fake = _FakeS3()
    monkeypatch.setattr("routers.os.get_s3_client", lambda: fake)
    monkeypatch.setattr("routers.os.bucket", lambda: "bucket-teste")

    resp = os_gestor_client.post(
        f"/api/os/{os_id}/fotos",
        files={"arquivo": ("..\\\\..\\\\..\\\\x.jpg", b"\xff\xd8\xff\xe0 fake jpeg", "image/jpeg")},
    )
    assert resp.status_code == 201, resp.text
    gravada = db_fake._dados["os_fotos"][-1]
    assert gravada["nome_original"] == "x.jpg"  # basename, sem navegar diretórios


def test_snapshot_respeita_o_tipo_da_os(os_gestor_client, db_fake):
    """Modelos específicos de um contrato não entram na O.S de outro tipo."""
    _seed_cenario(db_fake)
    db_fake._dados["os_checklist_modelos"].extend(
        [
            {"id": 500, "tipo": "geral", "grupo": 1, "ordem": 1, "classificacao": "1.1",
             "pergunta": "Geral?", "exige_foto": False, "ativo": True},
            {"id": 501, "tipo": "linha_viva", "grupo": 2, "ordem": 1, "classificacao": "2.1",
             "pergunta": "Específico de linha viva?", "exige_foto": False, "ativo": True},
        ]
    )
    os_id = _criar_os(os_gestor_client, tipo="construcao").json()["id"]
    itens = [i for i in db_fake._dados["os_checklist_itens"] if i["os_id"] == os_id]
    assert {i["classificacao"] for i in itens} == {"1.1"}
    assert all(i["pergunta"] == "Geral?" for i in itens)

def test_relatorio_os_layout_sem_historico_e_mao_de_obra(os_gestor_client, db_fake):
    """Relatório de execução: sem LINHA DO TEMPO e sem MÃO DE OBRA; serviços
    aplicados rotulados como USC/ULV."""
    import pymupdf

    _seed_cenario(db_fake)
    os_id = _criar_os_aberta_em_andamento(os_gestor_client)
    resp = os_gestor_client.get(f"/api/os/{os_id}/pdf")
    assert resp.status_code == 200, resp.text

    doc = pymupdf.open(stream=resp.content, filetype="pdf")
    texto = "\n".join(page.get_text() for page in doc)
    assert "APLICADOS (USC/ULV)" in texto
    assert "Total aplicado: 0" in texto
    assert "LINHA DO TEMPO" not in texto
    assert "HIST" not in texto  # HISTÓRICO DE STATUS
    assert "M.O." not in texto  # seção de MÃO DE OBRA removida
    # Unidade aparece apenas no título da seção e no rótulo da coluna de fator.
    assert texto.count("USC/ULV") == 2

def test_relatorio_os_descricao_longa_com_quebra(os_gestor_client, db_fake):
    """Descrição longa de serviço não é truncada: quebra automática na coluna
    Produto mantém o texto completo dentro da célula."""
    import pymupdf

    _seed_cenario(db_fake)
    nome_longo = (
        "Serviço de terraplenagem com caçamba sobre caminhão para transporte de "
        "material excedente até o bota-fora autorizado pelo fiscal da obra central"
    )
    db_fake._dados["produtos"].append(
        {"id": 8, "codigo": "TERRA-01", "nome": nome_longo, "unidade": "UN",
         "preco_unitario": 6.66, "ativo": True, "tipo": "construcao"}
    )
    os_id = _criar_os(os_gestor_client).json()["id"]
    assert os_gestor_client.put(f"/api/os/{os_id}/status", json={"novo_status": "aberta"}).status_code == 200
    resp = os_gestor_client.post(
        f"/api/os/{os_id}/materiais",
        json={"produto_id": 8, "quantidade_usada": 2, "tipo_usc": "normal"},
    )
    assert resp.status_code == 201, resp.text

    pdf = os_gestor_client.get(f"/api/os/{os_id}/pdf")
    assert pdf.status_code == 200, pdf.text
    doc = pymupdf.open(stream=pdf.content, filetype="pdf")
    texto = " ".join(page.get_text() for page in doc)
    import re as _re

    texto = _re.sub(r"\s+", " ", texto)
    # Trechos do MEIO e do FIM da descrição aparecem (nada truncado em 60 chars;
    # quebras de linha da coluna são normalizadas antes da checagem).
    assert "caçamba sobre caminhão" in texto
    assert "bota-fora autorizado" in texto
    assert "fiscal da obra central" in texto
    assert "Total aplicado: 13.32" in texto  # 2 x 6.66, sem sufixo na linha
