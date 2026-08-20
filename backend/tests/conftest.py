import hashlib
import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from supabase_client import get_supabase  # noqa: E402
from main import app  # noqa: E402
from tests.supabase_fake import SupabaseFake  # noqa: E402


def _hash_senha(senha: str) -> str:
    salt = "0123456789abcdef"
    valor = hashlib.pbkdf2_hmac(
        "sha256", senha.encode("utf-8"), bytes.fromhex(salt), 100000
    ).hex()
    return f"{salt}${valor}"


def _montar_dados_banco():
    return {
        "usuarios": [
            {
                "id": 1,
                "nome": "Administrador",
                "email": "admin@munaretto.com",
                "senha": "f3a1f7c47d63d1b8d3f5e67b7f9d2b3e$abcd" * 4,
                "permissoes": [
                    "dashboard", "clientes", "ferias", "fluxo",
                    "documentos", "comprovantes", "recebimentos", "configuracoes",
                ],
                "ativo": True,
                "precisa_trocar_senha": False,
            }
        ],
        "clientes": [
            {
                "id": 1,
                "nome": "Cliente Teste",
                "cpf_cnpj": "12345678901",
                "endereco": "Rua A, 100",
                "ativo": True,
                "data_cadastro": "2026-01-01T00:00:00Z",
            }
        ],
        "notificacoes": [],
        "funcionarios": [],
        "cargos": [],
        "treinamentos": [],
        "matriz_treinamentos": [],
        "funcionario_treinamentos": [],
        "aso": [],
        "epis": [],
        "funcionario_epis": [],
        "certificados": [],
        "veiculos": [],
        "manutencoes": [],
        "veiculo_equipamentos": [],
        "equipamento_reposicoes": [],
        "veiculo_documentos": [],
        "login_tentativas": [],
    }


@pytest.fixture
def db_fake():
    return SupabaseFake(_montar_dados_banco())


@pytest.fixture
def client(monkeypatch, db_fake):
    monkeypatch.setenv("JWT_SECRET", "chave-de-teste-segura-12345678901234567890")
    monkeypatch.setenv("SUPABASE_URL", "http://teste")
    monkeypatch.setenv("SUPABASE_KEY", "chave")

    def _get_supabase():
        return db_fake

    app.dependency_overrides[get_supabase] = _get_supabase
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def sst_client(client, db_fake):
    """Cliente autenticado com permissão de módulo 'sst'."""
    db_fake._dados["usuarios"].append(
        {
            "id": 77,
            "nome": "Tecnico SST",
            "email": "sst@munaretto.com",
            "senha": _hash_senha("senhaSST123"),
            "permissoes": ["sst"],
            "ativo": True,
            "precisa_trocar_senha": False,
        }
    )
    resp = client.post(
        "/api/usuarios/login",
        json={"email": "sst@munaretto.com", "senha": "senhaSST123"},
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["token"]
    client.headers.update({"Authorization": f"Bearer {token}"})
    return client


@pytest.fixture
def manutencao_client(client, db_fake):
    """Cliente autenticado com permissão de módulo 'manutencao'."""
    db_fake._dados["usuarios"].append(
        {
            "id": 88,
            "nome": "Frota",
            "email": "frota@munaretto.com",
            "senha": _hash_senha("senhaFrota123"),
            "permissoes": ["manutencao"],
            "ativo": True,
            "precisa_trocar_senha": False,
        }
    )
    resp = client.post(
        "/api/usuarios/login",
        json={"email": "frota@munaretto.com", "senha": "senhaFrota123"},
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["token"]
    client.headers.update({"Authorization": f"Bearer {token}"})
    return client
