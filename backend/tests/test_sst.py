"""Testes do módulo de Segurança do Trabalho (SST).

Cobre: permissão de acesso, CRUD de cargos/treinamentos/matriz,
controle de vencimentos de treinamentos, ASO e Ficha de EPI, além dos alertas.
Usa o cliente Supabase fake (sem rede).
"""

import hashlib
from datetime import date, timedelta


def _hash_senha(senha: str) -> str:
    salt = "0123456789abcdef"
    valor = hashlib.pbkdf2_hmac("sha256", senha.encode("utf-8"), bytes.fromhex(salt), 100000).hex()
    return f"{salt}${valor}"


def _criar_funcionario(db_fake, nome="João da Silva", cpf="12345678901"):
    db_fake._dados["funcionarios"].append(
        {"id": 1, "nome": nome, "cpf": cpf, "ativo": True, "cargo_id": None, "excluido": False}
    )


# ---------------------------------------------------------------------------
# Permissões
# ---------------------------------------------------------------------------
def test_sem_permissao(client, db_fake):
    """Usuário sem permissão 'sst' não acessa o módulo."""
    db_fake._dados["usuarios"].append(
        {
            "id": 78,
            "nome": "Sem SST",
            "email": "semsst@munaretto.com",
            "senha": _hash_senha("senhaSemSST1"),
            "permissoes": ["clientes"],
            "ativo": True,
            "precisa_trocar_senha": False,
        }
    )
    resp = client.post(
        "/api/usuarios/login",
        json={"email": "semsst@munaretto.com", "senha": "senhaSemSST1"},
    )
    token = resp.json()["token"]
    resp2 = client.get("/api/sst/cargos", headers={"Authorization": f"Bearer {token}"})
    assert resp2.status_code == 403


# ---------------------------------------------------------------------------
# Cargos
# ---------------------------------------------------------------------------
def test_crud_cargos(sst_client, db_fake):
    resp = sst_client.post("/api/sst/cargos", json={"nome": "Pedreiro", "descricao": "Executa alvenaria"})
    assert resp.status_code == 201, resp.text
    cargo_id = resp.json()["id"]
    assert resp.json()["nome"] == "Pedreiro"

    resp = sst_client.get("/api/sst/cargos")
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    resp = sst_client.put(f"/api/sst/cargos/{cargo_id}", json={"nome": "Pedreiro I", "descricao": "Alvenaria"})
    assert resp.status_code == 200
    assert resp.json()["nome"] == "Pedreiro I"

    resp = sst_client.delete(f"/api/sst/cargos/{cargo_id}")
    assert resp.status_code == 200
    assert resp.json()["success"] is True

    resp = sst_client.get("/api/sst/cargos")
    assert resp.json() == []


def test_cargo_nome_duplicado(sst_client):
    sst_client.post("/api/sst/cargos", json={"nome": "Eletricista"})
    resp = sst_client.post("/api/sst/cargos", json={"nome": "Eletricista"})
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Treinamentos e matriz
# ---------------------------------------------------------------------------
def test_crud_treinamento_e_matriz(sst_client, db_fake):
    resp = sst_client.post(
        "/api/sst/treinamentos",
        json={"nome": "NR-10 Básico", "norma": "NR-10", "tipo": "Inicial", "validade_meses": 12, "carga_horaria": 40},
    )
    assert resp.status_code == 201, resp.text
    treino_id = resp.json()["id"]

    cargo = sst_client.post("/api/sst/cargos", json={"nome": "Eletricista"}).json()

    # Vincula treinamento ao cargo
    resp = sst_client.post("/api/sst/matriz", json={"cargo_id": cargo["id"], "treinamento_id": treino_id})
    assert resp.status_code == 201, resp.text
    assert resp.json()["cargo_nome"] == "Eletricista"
    assert resp.json()["treinamento_nome"] == "NR-10 Básico"
    vinculo_id = resp.json()["id"]

    # Duplicidade é bloqueada
    resp = sst_client.post("/api/sst/matriz", json={"cargo_id": cargo["id"], "treinamento_id": treino_id})
    assert resp.status_code == 400

    # Lista filtrada por cargo
    resp = sst_client.get(f"/api/sst/matriz?cargo_id={cargo['id']}")
    assert len(resp.json()) == 1

    # Remove vínculo
    resp = sst_client.delete(f"/api/sst/matriz/{vinculo_id}")
    assert resp.status_code == 200
    assert len(sst_client.get("/api/sst/matriz").json()) == 0


# ---------------------------------------------------------------------------
# Vencimentos de treinamentos
# ---------------------------------------------------------------------------
def test_vencimento_treinamento(sst_client, db_fake):
    _criar_funcionario(db_fake)
    treino = sst_client.post(
        "/api/sst/treinamentos",
        json={"nome": "NR-35", "norma": "NR-35", "validade_meses": 24},
    ).json()

    hoje = date.today()
    # Vencido
    sst_client.post(
        "/api/sst/funcionario-treinamentos",
        json={
            "funcionario_id": 1,
            "treinamento_id": treino["id"],
            "data_realizacao": "2020-01-01",
            "data_validade": "2021-01-01",
        },
    )
    # Próximo ao vencimento (10 dias)
    proximo = (hoje + timedelta(days=10)).isoformat()
    sst_client.post(
        "/api/sst/funcionario-treinamentos",
        json={
            "funcionario_id": 1,
            "treinamento_id": treino["id"],
            "data_realizacao": hoje.isoformat(),
            "data_validade": proximo,
        },
    )
    # Vigente (validade longe no futuro)
    vigente = (hoje + timedelta(days=365)).isoformat()
    sst_client.post(
        "/api/sst/funcionario-treinamentos",
        json={
            "funcionario_id": 1,
            "treinamento_id": treino["id"],
            "data_realizacao": hoje.isoformat(),
            "data_validade": vigente,
        },
    )

    resp = sst_client.get("/api/sst/funcionario-treinamentos")
    assert resp.status_code == 200
    dados = resp.json()
    assert len(dados) == 3
    statuses = {d["status"] for d in dados}
    assert "Vencido" in statuses
    assert "Próximo ao Vencimento" in statuses
    assert "Vigente" in statuses

    # Filtro por status
    resp = sst_client.get("/api/sst/funcionario-treinamentos?status=Vencido")
    assert len(resp.json()) == 1


def test_validade_automatica_treinamento(sst_client, db_fake):
    """Sem data_validade, o backend calcula a partir de validade_meses do curso."""
    _criar_funcionario(db_fake)
    treino = sst_client.post(
        "/api/sst/treinamentos",
        json={"nome": "NR-10 Reciclagem", "norma": "NR-10", "tipo": "Reciclagem", "validade_meses": 12},
    ).json()
    resp = sst_client.post(
        "/api/sst/funcionario-treinamentos",
        json={"funcionario_id": 1, "treinamento_id": treino["id"], "data_realizacao": "2026-01-01"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["data_validade"] == "2027-01-01"
    assert resp.json()["funcionario_nome"] == "João da Silva"
    assert resp.json()["treinamento_nome"] == "NR-10 Reciclagem"


# ---------------------------------------------------------------------------
# ASO
# ---------------------------------------------------------------------------
def test_crud_aso(sst_client, db_fake):
    _criar_funcionario(db_fake)
    resp = sst_client.post(
        "/api/sst/aso",
        json={
            "funcionario_id": 1,
            "tipo_exame": "periodico",
            "data_exame": "2026-01-01",
            "validade_meses": 12,
            "medico_responsavel": "Dr. José",
            "clinica": "Clínica Central",
            "resultado": "apto",
        },
    )
    assert resp.status_code == 201, resp.text
    aso = resp.json()
    assert aso["data_validade"] == "2027-01-01"
    assert aso["funcionario_nome"] == "João da Silva"

    resp = sst_client.get("/api/sst/aso?tipo=periodico")
    assert len(resp.json()) == 1

    resp = sst_client.put(
        f"/api/sst/aso/{aso['id']}",
        json={
            "funcionario_id": 1,
            "tipo_exame": "demissional",
            "data_exame": "2026-02-01",
            "resultado": "apto",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["tipo_exame"] == "demissional"

    resp = sst_client.delete(f"/api/sst/aso/{aso['id']}")
    assert resp.status_code == 200


def test_aso_tipo_invalido(sst_client, db_fake):
    _criar_funcionario(db_fake)
    resp = sst_client.post(
        "/api/sst/aso",
        json={"funcionario_id": 1, "tipo_exame": "mensal", "data_exame": "2026-01-01"},
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# EPI e Ficha de EPI
# ---------------------------------------------------------------------------
def test_crud_epi_e_ficha(sst_client, db_fake):
    _criar_funcionario(db_fake)
    resp = sst_client.post(
        "/api/sst/epis",
        json={"nome": "Capacete", "ca_numero": "12345", "fabricante": "Fabricante X", "ca_validade": "2099-12-31"},
    )
    assert resp.status_code == 201, resp.text
    epi = resp.json()
    assert epi["ca_status"] == "Válido"

    resp = sst_client.post(
        "/api/sst/funcionario-epis",
        json={"funcionario_id": 1, "epi_id": epi["id"], "data_entrega": "2026-01-01", "quantidade": 2},
    )
    assert resp.status_code == 201, resp.text
    ficha = resp.json()
    assert ficha["epi_nome"] == "Capacete"
    assert ficha["status"] == "Em uso"
    assert ficha["ca_numero"] == "12345"

    resp = sst_client.put(
        f"/api/sst/funcionario-epis/{ficha['id']}",
        json={
            "funcionario_id": 1,
            "epi_id": epi["id"],
            "data_entrega": "2026-01-01",
            "data_devolucao": "2026-02-01",
            "quantidade": 2,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "Devolvido"

    resp = sst_client.get("/api/sst/funcionario-epis?status=Devolvido")
    assert len(resp.json()) == 1

    resp = sst_client.delete(f"/api/sst/funcionario-epis/{ficha['id']}")
    assert resp.status_code == 200


def test_ca_vencido(sst_client, db_fake):
    resp = sst_client.post(
        "/api/sst/epis",
        json={"nome": "Luvas", "ca_numero": "99999", "fabricante": "Fabricante Y", "ca_validade": "2020-01-01"},
    )
    assert resp.status_code == 201
    assert resp.json()["ca_status"] == "CA Vencido"


# ---------------------------------------------------------------------------
# Pendências da matriz de treinamentos
# ---------------------------------------------------------------------------
def test_pendencias_matriz(sst_client, db_fake):
    _criar_funcionario(db_fake)
    cargo = sst_client.post("/api/sst/cargos", json={"nome": "Eletricista"}).json()
    treino = sst_client.post(
        "/api/sst/treinamentos",
        json={"nome": "NR-10 Básico", "norma": "NR-10", "validade_meses": 12},
    ).json()
    sst_client.post("/api/sst/matriz", json={"cargo_id": cargo["id"], "treinamento_id": treino["id"]})
    db_fake._dados["funcionarios"][0]["cargo_id"] = cargo["id"]

    # Nunca realizou o curso -> Pendente
    pend = sst_client.get("/api/sst/pendencias").json()
    assert len(pend) == 1
    assert pend[0]["situacao"] == "Pendente"
    assert pend[0]["cargo_nome"] == "Eletricista"

    # Realizou, mas a validade venceu -> Vencido
    sst_client.post(
        "/api/sst/funcionario-treinamentos",
        json={
            "funcionario_id": 1,
            "treinamento_id": treino["id"],
            "data_realizacao": "2020-01-01",
            "data_validade": "2021-01-01",
        },
    )
    pend = sst_client.get("/api/sst/pendencias").json()
    assert len(pend) == 1
    assert pend[0]["situacao"] == "Vencido"

    # Realizou com validade vigente -> sem pendência
    hoje = date.today()
    vigente = (hoje + timedelta(days=365)).isoformat()
    sst_client.post(
        "/api/sst/funcionario-treinamentos",
        json={
            "funcionario_id": 1,
            "treinamento_id": treino["id"],
            "data_realizacao": hoje.isoformat(),
            "data_validade": vigente,
        },
    )
    pend = sst_client.get("/api/sst/pendencias").json()
    assert pend == []


def test_funcionario_sem_cargo_sem_pendencia(sst_client, db_fake):
    _criar_funcionario(db_fake)
    assert sst_client.get("/api/sst/pendencias").json() == []


def test_pendencias_considera_duas_funcoes(sst_client, db_fake):
    """Funcionário com 2 funções recebe pendências dos cursos de ambas, sem duplicar."""
    _criar_funcionario(db_fake)
    cargo1 = sst_client.post("/api/sst/cargos", json={"nome": "Eletricista"}).json()
    cargo2 = sst_client.post("/api/sst/cargos", json={"nome": "Servente"}).json()
    treino1 = sst_client.post(
        "/api/sst/treinamentos",
        json={"nome": "NR-10 Básico", "norma": "NR-10", "validade_meses": 12},
    ).json()
    treino2 = sst_client.post(
        "/api/sst/treinamentos",
        json={"nome": "NR-35 Trabalho em Altura", "norma": "NR-35", "validade_meses": 24},
    ).json()
    # Curso em comum para os dois cargos
    treino3 = sst_client.post(
        "/api/sst/treinamentos",
        json={"nome": "NR-6 EPI", "norma": "NR-6"},
    ).json()
    sst_client.post("/api/sst/matriz", json={"cargo_id": cargo1["id"], "treinamento_id": treino1["id"]})
    sst_client.post("/api/sst/matriz", json={"cargo_id": cargo1["id"], "treinamento_id": treino3["id"]})
    sst_client.post("/api/sst/matriz", json={"cargo_id": cargo2["id"], "treinamento_id": treino2["id"]})
    sst_client.post("/api/sst/matriz", json={"cargo_id": cargo2["id"], "treinamento_id": treino3["id"]})

    db_fake._dados["funcionarios"][0]["cargo_id"] = cargo1["id"]
    db_fake._dados["funcionarios"][0]["cargo_id_2"] = cargo2["id"]

    pend = sst_client.get("/api/sst/pendencias").json()
    nomes = {p["treinamento_nome"] for p in pend}
    assert nomes == {"NR-10 Básico", "NR-35 Trabalho em Altura", "NR-6 EPI"}
    assert len(pend) == 3
    assert all(p["situacao"] == "Pendente" for p in pend)


# ---------------------------------------------------------------------------
# PDF da Ficha de EPI
# ---------------------------------------------------------------------------
def test_pdf_ficha_epi(sst_client, db_fake):
    _criar_funcionario(db_fake)
    epi = sst_client.post(
        "/api/sst/epis",
        json={"nome": "Capacete", "ca_numero": "12345", "fabricante": "Fabricante X", "ca_validade": "2099-12-31"},
    ).json()
    ficha = sst_client.post(
        "/api/sst/funcionario-epis",
        json={"funcionario_id": 1, "epi_id": epi["id"], "data_entrega": "2026-01-01", "quantidade": 2},
    ).json()

    resp = sst_client.get(f"/api/sst/funcionario-epis/{ficha['id']}/pdf")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content[:4] == b"%PDF"

    resp = sst_client.get("/api/sst/funcionario-epis/9999/pdf")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Alertas e resumo
# ---------------------------------------------------------------------------
def test_alertas_sst(sst_client, db_fake):
    _criar_funcionario(db_fake)
    treino = sst_client.post(
        "/api/sst/treinamentos",
        json={"nome": "NR-35", "norma": "NR-35", "validade_meses": 24},
    ).json()
    sst_client.post(
        "/api/sst/funcionario-treinamentos",
        json={
            "funcionario_id": 1,
            "treinamento_id": treino["id"],
            "data_realizacao": "2020-01-01",
            "data_validade": "2021-01-01",
        },
    )
    sst_client.post(
        "/api/sst/epis",
        json={"nome": "Luvas", "ca_numero": "99999", "fabricante": "Fabricante Y", "ca_validade": "2020-01-01"},
    )

    resp = sst_client.get("/api/sst/alertas")
    assert resp.status_code == 200
    body = resp.json()
    assert body["resumo"]["treinamentos"]["Vencido"] == 1
    assert body["resumo"]["epis_ca_vencido"] == 1
    assert any("VENCIDO" in a["mensagem"] and a["gravidade"] == "danger" for a in body["alertas"])
