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
    assert resp.json()["ativo"] is True
    assert resp.json()["modelo"] == "Fiat Strada Adventure"

    resp = manutencao_client.get("/api/manutencao/veiculos")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


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