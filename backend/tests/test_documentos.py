"""Testes do Gerador de Documentos (módulo de documentos de clientes).

Cobre: os modelos de O.S (OS_CONSTRUCAO / OS_LINHA_VIVA) NÃO aparecem na
listagem do Gerador de Documentos — eles pertencem à impressão do módulo
Controle de O.S (fallback DOCX do utils/modelo_os.py) — e a geração por
esses modelos é bloqueada.
"""

import hashlib

import pytest


def _hash_senha(senha: str) -> str:
    salt = "0123456789abcdef"
    valor = hashlib.pbkdf2_hmac("sha256", senha.encode("utf-8"), bytes.fromhex(salt), 100000).hex()
    return f"{salt}${valor}"


@pytest.fixture
def documentos_client(client, db_fake):
    """Usuário com permissão apenas do módulo 'documentos'."""
    db_fake._dados["usuarios"].append(
        {
            "id": 55,
            "nome": "Gerador Docs",
            "email": "docs@munaretto.com",
            "senha": _hash_senha("senhaDocs123"),
            "permissoes": ["documentos"],
            "ativo": True,
            "precisa_trocar_senha": False,
        }
    )
    resp = client.post("/api/usuarios/login", json={"email": "docs@munaretto.com", "senha": "senhaDocs123"})
    assert resp.status_code == 200, resp.text
    token = resp.json()["token"]
    client.headers.update({"Authorization": f"Bearer {token}"})
    return client


def test_listagem_nao_inclui_modelos_de_os(documentos_client):
    resp = documentos_client.get("/api/documentos/templates")
    assert resp.status_code == 200, resp.text
    dados = resp.json()
    todos = dados["word"] + dados["excel"]
    assert "OS_CONSTRUCAO" not in todos
    assert "OS_LINHA_VIVA" not in todos
    # Modelos de cliente continuam aparecendo
    assert len(todos) >= 5


def test_gerar_modelo_de_os_bloqueado(documentos_client):
    resp = documentos_client.post(
        "/api/documentos/gerar",
        data={"cliente_id": 1, "template_name": "OS_CONSTRUCAO", "formato": "word"},
    )
    assert resp.status_code == 400
    assert "Controle de O.S" in resp.json()["detail"]

    resp = documentos_client.post(
        "/api/documentos/gerar",
        data={"cliente_id": 1, "template_name": "OS_LINHA_VIVA", "formato": "pdf"},
    )
    assert resp.status_code == 400


def test_sem_permissao_nao_lista(client):
    resp = client.get("/api/documentos/templates")
    assert resp.status_code in (401, 403)
