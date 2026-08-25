"""Testes do módulo de Manutenção.

Cobre: permissão de acesso, CRUD de veículos, manutenções e equipamentos.
Usa o cliente Supabase fake (sem rede).
"""

import hashlib

import pytest


def _hash_senha(senha: str) -> str:
    salt = "0123456789abcdef"
    valor = hashlib.pbkdf2_hmac(
        "sha256", senha.encode("utf-8"), bytes.fromhex(salt), 100000
    ).hex()
    return f"{salt}${valor}"


# ---------------------------------------------------------------------------
# Permissões
# ---------------------------------------------------------------------------
def test_sem_permissao(client, db_fake):
    """Usuário sem permissão 'manutencao' não acessa o módulo."""
    db_fake._dados["usuarios"].append(
        {
            "id": 89,
            "nome": "Sem Manutenção",
            "email": "semmanut@munaretto.com",
            "senha": _hash_senha("senhaSemManut1"),
            "permissoes": ["clientes"],
            "ativo": True,
            "precisa_trocar_senha": False,
        }
    )
    resp = client.post(
        "/api/usuarios/login",
        json={"email": "semmanut@munaretto.com", "senha": "senhaSemManut1"},
    )
    token = resp.json()["token"]
    resp2 = client.get(
        "/api/manutencao/veiculos", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp2.status_code == 403


# ---------------------------------------------------------------------------
# Veículos
# ---------------------------------------------------------------------------
def test_crud_veiculos(manutencao_client):
    resp = manutencao_client.post(
        "/api/manutencao/veiculos",
        json={"modelo": "Fiat Strada", "placa": "ABC-1234", "observacao": "Camionete"},
    )
    assert resp.status_code == 201, resp.text
    veiculo_id = resp.json()["id"]
    assert resp.json()["placa"] == "ABC1234"  # normalizada

    resp = manutencao_client.get("/api/manutencao/veiculos")
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    resp = manutencao_client.put(
        f"/api/manutencao/veiculos/{veiculo_id}",
        json={"modelo": "Fiat Strada Adventure", "placa": "abc-1234"},
    )
    assert resp.status_code == 200
    assert resp.json()["modelo"] == "Fiat Strada Adventure"
    assert resp.json()["placa"] == "ABC1234"

    resp = manutencao_client.delete(f"/api/manutencao/veiculos/{veiculo_id}")
    assert resp.status_code == 200
    assert resp.json()["success"] is True

    resp = manutencao_client.get("/api/manutencao/veiculos")
    assert resp.status_code == 200
    assert len(resp.json()) == 0  # soft delete


def test_placa_duplicada(manutencao_client):
    manutencao_client.post(
        "/api/manutencao/veiculos", json={"modelo": "VW Gol", "placa": "XYZ-9876"}
    )
    resp = manutencao_client.post(
        "/api/manutencao/veiculos", json={"modelo": "VW Voyage", "placa": "xyz-9876"}
    )
    assert resp.status_code == 400
    assert "placa" in resp.json()["detail"].lower()


def test_reativa_veiculo_inativo_com_mesma_placa(manutencao_client):
    resp = manutencao_client.post(
        "/api/manutencao/veiculos", json={"modelo": "Fiat Strada", "placa": "REA-1000"}
    )
    assert resp.status_code == 201
    vid = resp.json()["id"]

    resp = manutencao_client.delete(f"/api/manutencao/veiculos/{vid}")
    assert resp.status_code == 200

    # Re-registrar a mesma placa deve reativar o veículo excluído (não dar 500
    # por violar a constraint UNIQUE da coluna placa).
    resp = manutencao_client.post(
        "/api/manutencao/veiculos",
        json={"modelo": "Fiat Strada Adventure", "placa": "rea-1000"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["id"] == vid

    resp = manutencao_client.get("/api/manutencao/veiculos")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["ativo"] is True
    assert resp.json()[0]["modelo"] == "Fiat Strada Adventure"


def test_listar_veiculos_com_pendencias_documentos(manutencao_client, db_fake):
    """Lista de veículos traz contagem de documentos vencidos/próximos do vencimento."""
    from datetime import date, timedelta

    r1 = manutencao_client.post(
        "/api/manutencao/veiculos", json={"modelo": "Vencido Truck", "placa": "PND-0001"}
    )
    vid1 = r1.json()["id"]
    r2 = manutencao_client.post(
        "/api/manutencao/veiculos", json={"modelo": "A Vencer Truck", "placa": "PND-0002"}
    )
    vid2 = r2.json()["id"]
    r3 = manutencao_client.post(
        "/api/manutencao/veiculos", json={"modelo": "Em Dia Truck", "placa": "PND-0003"}
    )
    vid3 = r3.json()["id"]

    db_fake._dados["veiculo_documentos"] = [
        {"id": 1, "veiculo_id": vid1, "data_validade": str(date.today() - timedelta(days=5))},
        {"id": 2, "veiculo_id": vid2, "data_validade": str(date.today() + timedelta(days=10))},
        # vigente (fora da janela de 30 dias) e sem data não contam como pendência
        {"id": 3, "veiculo_id": vid3, "data_validade": str(date.today() + timedelta(days=90))},
        {"id": 4, "veiculo_id": vid3, "data_validade": None},
    ]

    resp = manutencao_client.get("/api/manutencao/veiculos")
    assert resp.status_code == 200
    por_id = {v["id"]: v for v in resp.json()}
    assert por_id[vid1]["docs_vencidos"] == 1
    assert por_id[vid1]["docs_proximos_vencimento"] == 0
    assert por_id[vid2]["docs_vencidos"] == 0
    assert por_id[vid2]["docs_proximos_vencimento"] == 1
    assert por_id[vid3]["docs_vencidos"] == 0
    assert por_id[vid3]["docs_proximos_vencimento"] == 0


def test_busca_veiculos(manutencao_client):
    manutencao_client.post("/api/manutencao/veiculos", json={"modelo": "Fiat Strada", "placa": "AAA-1111"})
    manutencao_client.post("/api/manutencao/veiculos", json={"modelo": "Mercedes Actros", "placa": "BBB-2222"})
    resp = manutencao_client.get("/api/manutencao/veiculos?busca=actros")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["placa"] == "BBB2222"


# ---------------------------------------------------------------------------
# Manutenções
# ---------------------------------------------------------------------------
def _criar_veiculo(manutencao_client):
    resp = manutencao_client.post(
        "/api/manutencao/veiculos", json={"modelo": "Fiat Strada", "placa": "DEF-4321"}
    )
    return resp.json()["id"]


def test_crud_manutencoes(manutencao_client):
    veiculo_id = _criar_veiculo(manutencao_client)

    resp = manutencao_client.post(
        "/api/manutencao/manutencoes",
        json={
            "veiculo_id": veiculo_id,
            "tipo": "Troca de pneus",
            "descricao": "Troca dos 4 pneus dianteiros",
            "data_servico": "2026-08-10",
            "oficina": "Pneu Centro",
            "valor": 1200.50,
            "km_odometro": 45000,
        },
    )
    assert resp.status_code == 201, resp.text
    manut_id = resp.json()["id"]
    assert resp.json()["oficina"] == "Pneu Centro"

    resp = manutencao_client.get(f"/api/manutencao/veiculos/{veiculo_id}/manutencoes")
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    resp = manutencao_client.put(
        f"/api/manutencao/manutencoes/{manut_id}",
        json={
            "veiculo_id": veiculo_id,
            "tipo": "Revisão",
            "descricao": "Revisão completa",
            "data_servico": "2026-08-12",
            "oficina": "Oficina Central",
            "valor": 800,
            "km_odometro": 46000,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["tipo"] == "Revisão"

    resp = manutencao_client.delete(f"/api/manutencao/manutencoes/{manut_id}")
    assert resp.status_code == 200

    resp = manutencao_client.get(f"/api/manutencao/veiculos/{veiculo_id}/manutencoes")
    assert resp.status_code == 200
    assert len(resp.json()) == 0


def test_manutencao_veiculo_inexistente(manutencao_client):
    resp = manutencao_client.post(
        "/api/manutencao/manutencoes",
        json={
            "veiculo_id": 999,
            "tipo": "Manutenção",
            "data_servico": "2026-08-10",
        },
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Equipamentos
# ---------------------------------------------------------------------------
def test_crud_equipamentos(manutencao_client):
    veiculo_id = _criar_veiculo(manutencao_client)

    resp = manutencao_client.post(
        "/api/manutencao/equipamentos",
        json={
            "veiculo_id": veiculo_id,
            "equipamento": "Macaco hidráulico",
            "quantidade": 1,
            "observacao": "Verificar pressão",
        },
    )
    assert resp.status_code == 201, resp.text
    equip_id = resp.json()["id"]

    resp = manutencao_client.post(
        "/api/manutencao/equipamentos",
        json={"veiculo_id": veiculo_id, "equipamento": "Triângulo", "quantidade": 2},
    )
    assert resp.status_code == 201

    resp = manutencao_client.get(f"/api/manutencao/veiculos/{veiculo_id}/equipamentos")
    assert resp.status_code == 200
    assert len(resp.json()) == 2

    resp = manutencao_client.put(
        f"/api/manutencao/equipamentos/{equip_id}",
        json={
            "veiculo_id": veiculo_id,
            "equipamento": "Macaco hidráulico 3t",
            "quantidade": 1,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["equipamento"] == "Macaco hidráulico 3t"

    resp = manutencao_client.delete(f"/api/manutencao/equipamentos/{equip_id}")
    assert resp.status_code == 200

    resp = manutencao_client.get(f"/api/manutencao/veiculos/{veiculo_id}/equipamentos")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


# ---------------------------------------------------------------------------
# Reposições de equipamentos (histórico)
# ---------------------------------------------------------------------------
def test_crud_reposicoes_equipamento(manutencao_client):
    veiculo_id = _criar_veiculo(manutencao_client)

    resp = manutencao_client.post(
        "/api/manutencao/equipamentos",
        json={"veiculo_id": veiculo_id, "equipamento": "Estepe", "quantidade": 1},
    )
    assert resp.status_code == 201
    equip_id = resp.json()["id"]

    # Sem histórico, última reposição é nula
    resp = manutencao_client.get(f"/api/manutencao/veiculos/{veiculo_id}/equipamentos")
    assert resp.status_code == 200
    assert resp.json()[0]["ultima_reposicao"] is None

    resp = manutencao_client.post(
        "/api/manutencao/equipamentos/reposicoes",
        json={"equipamento_id": equip_id, "data_reposicao": "2026-07-01", "quantidade": 2},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["veiculo_id"] == veiculo_id
    rep_id = resp.json()["id"]

    resp = manutencao_client.post(
        "/api/manutencao/equipamentos/reposicoes",
        json={
            "equipamento_id": equip_id,
            "data_reposicao": "2026-08-15",
            "quantidade": 1,
            "observacao": "Troca por desgaste",
        },
    )
    assert resp.status_code == 201

    # Última reposição = maior data
    resp = manutencao_client.get(f"/api/manutencao/veiculos/{veiculo_id}/equipamentos")
    assert resp.json()[0]["ultima_reposicao"] == "2026-08-15"

    resp = manutencao_client.get(f"/api/manutencao/equipamentos/{equip_id}/reposicoes")
    assert resp.status_code == 200
    assert len(resp.json()) == 2
    assert resp.json()[0]["data_reposicao"] == "2026-08-15"  # ordenado por data desc

    resp = manutencao_client.delete(f"/api/manutencao/equipamentos/reposicoes/{rep_id}")
    assert resp.status_code == 200
    assert resp.json()["success"] is True

    resp = manutencao_client.get(f"/api/manutencao/equipamentos/{equip_id}/reposicoes")
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    # Reposição para equipamento inexistente
    resp = manutencao_client.post(
        "/api/manutencao/equipamentos/reposicoes",
        json={"equipamento_id": 999, "data_reposicao": "2026-08-15", "quantidade": 1},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Documentos de veículos (CRLV, cronotacógrafo, etc.)
# ---------------------------------------------------------------------------
class FakeS3:
    """Simula as chamadas do boto3 usadas pelo router de manutenção."""

    def __init__(self):
        self.objetos = {}
        self.removidos = []
        self.put_chamadas = []
        self.geradas = []

    def put_object(self, **kwargs):
        self.put_chamadas.append(kwargs)
        self.objetos[kwargs["Key"]] = kwargs["Body"]
        return {}

    def delete_object(self, **kwargs):
        self.objetos.pop(kwargs["Key"], None)
        self.removidos.append(kwargs["Key"])
        return {}

    def generate_presigned_url(self, operacao, Params=None, ExpiresIn=None):
        self.geradas.append(Params["Key"])
        return f"https://presigned.invalido/{Params['Key']}?expires={ExpiresIn}"


@pytest.fixture
def s3_fake_manutencao(monkeypatch):
    fake = FakeS3()

    def _get_s3_client():
        return fake

    def _bucket():
        return "bucket-teste"

    monkeypatch.setattr("routers.manutencao.get_s3_client", _get_s3_client)
    monkeypatch.setattr("routers.manutencao.bucket", _bucket)
    monkeypatch.setattr("storage.get_s3_client", _get_s3_client)
    monkeypatch.setattr("storage.bucket", _bucket)
    return fake


def _upload_documento(manutencao_client, veiculo_id, tipo="CRLV", data_validade="2026-12-31", nome="crlv.pdf", mime="application/pdf", conteudo=b"%PDF-1.4 crlv"):
    return manutencao_client.post(
        f"/api/manutencao/veiculos/{veiculo_id}/documentos",
        data={"tipo": tipo, "data_validade": data_validade},
        files={"arquivo": (nome, conteudo, mime)},
    )


def test_crud_documentos_veiculo(manutencao_client, s3_fake_manutencao):
    veiculo_id = _criar_veiculo(manutencao_client)

    resp = _upload_documento(manutencao_client, veiculo_id, tipo="CRLV", data_validade="2026-12-31")
    assert resp.status_code == 201, resp.text
    doc = resp.json()
    assert doc["veiculo_id"] == veiculo_id
    assert doc["tipo"] == "CRLV"
    assert doc["data_validade"] == "2026-12-31"
    assert doc["nome_original"] == "crlv.pdf"
    assert doc["bucket_key"].startswith("documentos/veiculos/")

    resp = _upload_documento(manutencao_client, veiculo_id, tipo="Certificado do Cronotacógrafo", data_validade="2026-11-15", nome="crono.pdf", conteudo=b"%PDF-1.4 crono")
    assert resp.status_code == 201, resp.text

    resp = manutencao_client.get(f"/api/manutencao/veiculos/{veiculo_id}/documentos")
    assert resp.status_code == 200
    assert len(resp.json()) == 2

    # Download com presigned URL
    doc_id = doc["id"]
    resp = manutencao_client.get(f"/api/manutencao/documentos/{doc_id}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "https://presigned.invalido/" in body["url_temporaria"]
    assert body["validade_segundos"] == 900
    assert body["mime_type"] == "application/pdf"

    # Exclusão remove o objeto do B2 e os metadados
    resp = manutencao_client.delete(f"/api/manutencao/documentos/{doc_id}")
    assert resp.status_code == 200
    assert resp.json()["success"] is True
    assert len(s3_fake_manutencao.removidos) == 1

    resp = manutencao_client.get(f"/api/manutencao/documentos/{doc_id}")
    assert resp.status_code == 404

    resp = manutencao_client.get(f"/api/manutencao/veiculos/{veiculo_id}/documentos")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_documento_veiculo_inexistente(manutencao_client, s3_fake_manutencao):
    resp = _upload_documento(manutencao_client, 999)
    assert resp.status_code == 404
    assert len(s3_fake_manutencao.put_chamadas) == 0


def test_documento_tipo_arquivo_invalido(manutencao_client, s3_fake_manutencao):
    veiculo_id = _criar_veiculo(manutencao_client)
    resp = manutencao_client.post(
        f"/api/manutencao/veiculos/{veiculo_id}/documentos",
        data={"tipo": "CRLV"},
        files={"arquivo": ("virus.exe", b"MZ...", "application/x-msdownload")},
    )
    assert resp.status_code == 400
    assert len(s3_fake_manutencao.put_chamadas) == 0


def test_documento_sem_tipo(manutencao_client, s3_fake_manutencao):
    veiculo_id = _criar_veiculo(manutencao_client)
    resp = manutencao_client.post(
        f"/api/manutencao/veiculos/{veiculo_id}/documentos",
        files={"arquivo": ("crlv.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert resp.status_code == 422  # tipo é obrigatório


def test_documento_sem_validade(manutencao_client, s3_fake_manutencao):
    veiculo_id = _criar_veiculo(manutencao_client)
    resp = manutencao_client.post(
        f"/api/manutencao/veiculos/{veiculo_id}/documentos",
        data={"tipo": "IPVA"},
        files={"arquivo": ("ipva.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["data_validade"] is None