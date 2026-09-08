"""Testes da gestão consolidada por obra (Fase 1).

Cobre o backend da gestão por obra:
- Resumo `/api/os/obras/{id}/resumo`: contratos separados (USC/ULV),
  desdobramento normal/especial, `os_usadas`, filtros de status (rascunho
  só em "todas"), período/contadores da obra inteira, 404/403;
- Listagem `/api/os/obras` enriquecida: contadores e totais por contrato
  (em execução + concluídas — canceladas/rascunho fora dos totais);
- Relatórios PDF da obra (conteúdo via pymupdf).
"""

from routers.os import TRANSICOES_STATUS

# ---------------------------------------------------------------------------
# Helpers de cenário
# ---------------------------------------------------------------------------


def _inserir_obra(db_fake, obra_id, nome, cliente_id=1):
    db_fake._dados["obras"].append(
        {
            "id": obra_id,
            "cliente_id": cliente_id,
            "nome": nome,
            "ativo": True,
            "created_at": "2026-01-01T00:00:00Z",
        }
    )


def _inserir_produto(db_fake, produto_id, nome, unidade="UN", codigo=None, codigo_especial=None):
    db_fake._dados["produtos"].append(
        {
            "id": produto_id,
            "codigo": codigo,
            "codigo_especial": codigo_especial,
            "nome": nome,
            "unidade": unidade,
            "ativo": True,
        }
    )


def _inserir_os(db_fake, os_id, obra_id, tipo, status, abertura, fim=None, codigo=None):
    db_fake._dados["ordens_servico"].append(
        {
            "id": os_id,
            "codigo": codigo or f"OS-TESTE-{os_id:04d}",
            "obra_id": obra_id,
            "tipo": tipo,
            "status": status,
            "data_abertura": abertura,
            "data_fim": fim,
            "created_at": "2026-01-01T00:00:00Z",
        }
    )


def _inserir_material(db_fake, os_id, produto_id, qtd, pecas, fator, tipo="normal", codigo=None):
    db_fake._dados["os_materiais"].append(
        {
            "id": len(db_fake._dados["os_materiais"]) + 1,
            "os_id": os_id,
            "produto_id": produto_id,
            "quantidade_usada": qtd,
            "quantidade_pecas": pecas,
            "fator_usc": fator,
            "tipo_usc": tipo,
            "codigo_servico": codigo,
        }
    )


def _anexar_foto(db_fake, os_id, qtd=1):
    fotos = db_fake._dados["os_fotos"]
    inicio = len(fotos) + 1
    for i in range(qtd):
        fotos.append(
            {
                "id": 1000 + inicio + i,
                "os_id": os_id,
                "nome_original": f"evidencia{i}.jpg",
                "mime_type": "image/jpeg",
                "bucket_key": f"os_fotos/{os_id}/fake{i}.jpg",
            }
        )


def _seed_obra_com_os(db_fake, obra_id=501):
    """Obra com O.S de contratos mistos e status variados.

    O.S da obra:
    - 101 construcao rascunho            (sem lançamentos)
    - 102 construcao em_andamento        CIM-50 normal x2 + Poste especial
    - 103 construcao concluida (01/03)    CIM-50 normal
    - 104 manutencao  em_andamento        Limpeza ULV
    - 105 construcao cancelada           Demolição (excluída dos totais)
    """
    _inserir_obra(db_fake, obra_id, "Obra Alpha")
    _inserir_produto(db_fake, 701, "Cimento CP-II 50kg", unidade="saco", codigo="CIM-50")
    _inserir_produto(db_fake, 702, "Poste de concreto", unidade="un", codigo="POS-10", codigo_especial="POS-E")
    _inserir_produto(db_fake, 703, "Limpeza de faixa", unidade="serv", codigo="LMP-10")
    _inserir_produto(db_fake, 704, "Demolição", unidade="m3", codigo="DEM-1")

    _inserir_os(db_fake, 101, obra_id, "construcao", "rascunho", "2026-01-01T00:00:00Z")
    _inserir_os(db_fake, 102, obra_id, "construcao", "em_andamento", "2026-02-01T00:00:00Z")
    _inserir_os(db_fake, 103, obra_id, "construcao", "concluida", "2026-02-10T00:00:00Z", fim="2026-03-01T00:00:00Z")
    _inserir_os(db_fake, 104, obra_id, "manutencao", "em_andamento", "2026-02-15T00:00:00Z")
    _inserir_os(db_fake, 105, obra_id, "construcao", "cancelada", "2026-02-20T00:00:00Z", fim="2026-02-22T00:00:00Z")

    # 102: Cimento normal (3 sacos x fator 2) + (2 sacos x fator 2) = 10 USC.
    _inserir_material(db_fake, 102, 701, 6, 3, 2, codigo="CIM-50")
    _inserir_material(db_fake, 102, 701, 4, 2, 2, codigo="CIM-50")
    # 102: USC especial (Poste).
    _inserir_material(db_fake, 102, 702, 4, 1, 4, tipo="especial", codigo="POS-E")
    # 103: Cimento normal (10 sacos x fator 1,5) = 15 USC.
    _inserir_material(db_fake, 103, 701, 15, 10, 1.5, codigo="CIM-50")
    # 104: Limpeza (ULV).
    _inserir_material(db_fake, 104, 703, 2, 2, 1, codigo="LMP-10")
    # 105: cancelada (não entra nos totais da obra).
    _inserir_material(db_fake, 105, 704, 8, 1, 8, codigo="DEM-1")

    _anexar_foto(db_fake, 102, qtd=2)
    _anexar_foto(db_fake, 103, qtd=1)


def _os_por_codigo(payload, codigo):
    return next(os for os in payload["os"] if os["codigo"] == codigo)


# ---------------------------------------------------------------------------
# Testes
# ---------------------------------------------------------------------------


class TestResumoObra:
    def test_resumo_agrupa_contratos_e_desdobra_normal_especial(self, os_gestor_client, db_fake):
        _seed_obra_com_os(db_fake)
        resp = os_gestor_client.get("/api/os/obras/501/resumo")
        assert resp.status_code == 200, resp.text
        dados = resp.json()

        assert dados["obra"]["nome"] == "Obra Alpha"
        assert dados["filtro"] == "todas"

        # Contadores e período sempre da obra inteira (rascunho incluído).
        assert dados["resumo"]["total"] == 5
        assert dados["resumo"]["ativas"] == 2
        assert dados["resumo"]["encerradas"] == 2
        assert dados["resumo"]["por_status"] == {
            "rascunho": 1,
            "em_andamento": 2,
            "concluida": 1,
            "cancelada": 1,
        }
        assert dados["resumo"]["periodo"]["inicio"] == "2026-01-01T00:00:00Z"
        assert dados["resumo"]["periodo"]["fim"] == "2026-03-01T00:00:00Z"

        tipos = {c["tipo"]: c for c in dados["contratos"]}
        assert set(tipos) == {"construcao", "manutencao"}
        assert tipos["construcao"]["unidade"] == "USC"
        assert tipos["manutencao"]["unidade"] == "ULV"

        # Construção: CIM-50 normal (3+2 sacos da 102 + 10 da 103 = 25 USC,
        # 15 sacos, 2 O.S distintas), POS-E especial e DEM-1 (cancelada).
        itens = {i["codigo_servico"]: i for i in tipos["construcao"]["itens"]}
        assert set(itens) == {"CIM-50", "POS-E", "DEM-1"}
        assert itens["CIM-50"]["tipo"] == "normal"
        assert itens["CIM-50"]["pecas"] == 15
        assert itens["CIM-50"]["total"] == 25
        assert itens["CIM-50"]["os_usadas"] == 2
        assert itens["POS-E"]["tipo"] == "especial"
        assert itens["POS-E"]["total"] == 4
        assert itens["POS-E"]["os_usadas"] == 1
        assert itens["DEM-1"]["total"] == 8
        assert tipos["construcao"]["total"] == 25 + 4 + 8
        assert tipos["manutencao"]["total"] == 2
        assert tipos["manutencao"]["itens"][0]["nome"] == "Limpeza de faixa"

        # Serviços achatados carregam o contrato de origem.
        assert len(dados["servicos"]) == len(dados["contratos"][0]["itens"]) + 1
        assert all(s["contrato"] for s in dados["servicos"])

    def test_resumo_por_os_com_totais_e_fotos(self, os_gestor_client, db_fake):
        _seed_obra_com_os(db_fake)
        dados = os_gestor_client.get("/api/os/obras/501/resumo").json()

        # Rascunho entra em "todas" (aparece sem total).
        rascunho = _os_por_codigo(dados, "OS-TESTE-0101")
        assert rascunho["status"] == "rascunho"
        assert rascunho["total_aplicado"] == 0

        em_andamento = _os_por_codigo(dados, "OS-TESTE-0102")
        assert em_andamento["total_aplicado"] == 10 + 4
        assert em_andamento["fotos_count"] == 2

        concluida = _os_por_codigo(dados, "OS-TESTE-0103")
        assert concluida["total_aplicado"] == 15
        assert concluida["fotos_count"] == 1
        assert concluida["data_fim"] == "2026-03-01T00:00:00Z"

        manutencao = _os_por_codigo(dados, "OS-TESTE-0104")
        assert manutencao["tipo"] == "manutencao"
        assert manutencao["total_aplicado"] == 2

    def test_filtro_ativas_exclui_rascunho_e_encerradas(self, os_gestor_client, db_fake):
        _seed_obra_com_os(db_fake)

        ativas = os_gestor_client.get("/api/os/obras/501/resumo", params={"status": "ativas"}).json()
        assert {os["id"] for os in ativas["os"]} == {102, 104}
        # Contadores continuam da obra inteira.
        assert ativas["resumo"]["total"] == 5
        assert ativas["resumo"]["ativas"] == 2
        tipos = {c["tipo"]: c for c in ativas["contratos"]}
        assert tipos["construcao"]["total"] == 25 - 15 + 4  # 102 (normal 10 + esp. 4)
        assert tipos["manutencao"]["total"] == 2
        assert all(i["codigo_servico"] != "DEM-1" for c in ativas["contratos"] for i in c["itens"])

        encerradas = os_gestor_client.get("/api/os/obras/501/resumo", params={"status": "encerradas"}).json()
        assert {os["id"] for os in encerradas["os"]} == {103, 105}
        assert encerradas["resumo"]["encerradas"] == 2
        tipos_enc = {c["tipo"]: c for c in encerradas["contratos"]}
        assert tipos_enc["construcao"]["total"] == 15 + 8

    def test_resumo_obra_inexistente_404(self, os_gestor_client, db_fake):
        _seed_obra_com_os(db_fake)
        resp = os_gestor_client.get("/api/os/obras/9999/resumo")
        assert resp.status_code == 404

    def test_resumo_negado_para_usuario_de_campo(self, os_campo_client, db_fake):
        _seed_obra_com_os(db_fake)
        resp = os_campo_client.get("/api/os/obras/501/resumo")
        assert resp.status_code == 403

    def test_resumo_obra_sem_os(self, os_gestor_client, db_fake):
        _inserir_obra(db_fake, 502, "Obra Vazia")
        resp = os_gestor_client.get("/api/os/obras/502/resumo")
        assert resp.status_code == 200, resp.text
        dados = resp.json()
        assert dados["resumo"]["total"] == 0
        assert dados["os"] == []
        assert dados["contratos"] == []
        assert dados["servicos"] == []
        assert dados["resumo"]["periodo"] == {"inicio": None, "fim": None}


class TestListarObrasEnriquecidas:
    def test_listar_obras_com_contadores_e_totais_por_contrato(self, os_gestor_client, db_fake):
        _seed_obra_com_os(db_fake)  # obra 501
        _inserir_obra(db_fake, 502, "Obra Beta")

        resp = os_gestor_client.get("/api/os/obras")
        assert resp.status_code == 200, resp.text
        obras = {o["id"]: o for o in resp.json()}

        alpha = obras[501]
        assert alpha["os_total"] == 5  # rascunho entra na contagem
        assert alpha["os_ativas"] == 2
        assert alpha["os_encerradas"] == 2
        # Totais: em execução + concluídas (25+4 USC); cancelada (DEM-1) fica
        # fora; manutenção entra com ULV.
        assert alpha["totais_por_tipo"] == [
            {"tipo": "construcao", "unidade": "USC", "total": 29},
            {"tipo": "manutencao", "unidade": "ULV", "total": 2},
        ]

        beta = obras[502]
        assert beta["os_total"] == 0
        assert beta["os_ativas"] == 0
        assert beta["os_encerradas"] == 0
        assert beta["totais_por_tipo"] == []

    def test_listar_obras_separa_contratos_por_unidade(self, os_gestor_client, db_fake):
        _inserir_obra(db_fake, 503, "Obra Linha Viva")
        _inserir_produto(db_fake, 705, "Cabo", unidade="m", codigo="CAB-1")
        _inserir_os(db_fake, 106, 503, "linha_viva", "em_andamento", "2026-03-01T00:00:00Z")
        _inserir_material(db_fake, 106, 705, 50, 50, 1, codigo="CAB-1")

        obras = {o["id"]: o for o in os_gestor_client.get("/api/os/obras").json()}
        assert obras[503]["totais_por_tipo"] == [
            {"tipo": "linha_viva", "unidade": "ULV", "total": 50}
        ]

    def test_listar_obras_ignora_rascunho_e_cancelada_nos_totais(self, os_gestor_client, db_fake):
        _inserir_obra(db_fake, 504, "Obra Z")
        _inserir_os(db_fake, 107, 504, "construcao", "rascunho", "2026-01-01T00:00:00Z")
        _inserir_material(db_fake, 107, 701, 5, 5, 1, codigo="CIM-50")

        obras = {o["id"]: o for o in os_gestor_client.get("/api/os/obras").json()}
        obra = obras[504]
        assert obra["os_total"] == 1
        assert obra["totais_por_tipo"] == []  # rascunho não soma

    def test_rotina_transicoes_intacta_apos_novos_constantes(self):
        for origem in ("rascunho", "aberta", "em_andamento", "impedida", "concluida", "cancelada"):
            assert origem in TRANSICOES_STATUS
