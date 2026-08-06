"""Testes básicos de autenticação (T5.1).

Cobre: login OK, senha errada, token inválido, rota protegida sem token e
permissão negada. Usa um cliente Supabase fake (sem rede).
"""

import hashlib


def _hash_senha(senha: str) -> str:
    salt = "0123456789abcdef"
    valor = hashlib.pbkdf2_hmac(
        "sha256", senha.encode("utf-8"), bytes.fromhex(salt), 100000
    ).hex()
    return f"{salt}${valor}"


def _injetar_usuario(db_fake, email="teste@munaretto.com", senha="senhaForte123", permissoes=("clientes",)):
    """Adiciona um usuário de teste com senha conhecida ao banco fake."""
    db_fake._dados["usuarios"].append(
        {
            "id": 99,
            "nome": "Teste",
            "email": email,
            "senha": _hash_senha(senha),
            "permissoes": list(permissoes),
            "ativo": True,
            "precisa_trocar_senha": False,
        }
    )


def _login(client, email="teste@munaretto.com", senha="senhaForte123"):
    resp = client.post("/api/usuarios/login", json={"email": email, "senha": senha})
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


def test_login_ok(client, db_fake):
    _injetar_usuario(db_fake)
    resp = client.post(
        "/api/usuarios/login",
        json={"email": "teste@munaretto.com", "senha": "senhaForte123"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["token"]
    assert body["email"] == "teste@munaretto.com"
    assert "senha" not in body


def test_login_senha_errada(client, db_fake):
    _injetar_usuario(db_fake)
    resp = client.post(
        "/api/usuarios/login",
        json={"email": "teste@munaretto.com", "senha": "senhaErrada1"},
    )
    assert resp.status_code == 401
    assert "inválidos" in resp.json()["detail"].lower()


def test_rota_protegida_sem_token(client):
    resp = client.get("/api/clientes/")
    assert resp.status_code in (401, 403)


def test_rota_protegida_token_invalido(client):
    resp = client.get(
        "/api/clientes/", headers={"Authorization": "Bearer token.invalido.aqui"}
    )
    assert resp.status_code in (401, 403)


def test_rota_protegida_token_valido(client, db_fake):
    _injetar_usuario(db_fake)
    token = _login(client)
    resp = client.get("/api/clientes/", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_permissao_negada(client, db_fake):
    _injetar_usuario(db_fake, senha="outraSenha123")
    token = _login(client, senha="outraSenha123")
    # Usuário de teste só tem permissão "clientes": acessar férias deve falhar
    resp = client.get("/api/ferias/", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_atualizar_usuario_senha_vazia_ok(client, db_fake):
    """Editar usuário sem trocar a senha não pode retornar 422 (senha '').

    Antes da correção, '' violava min_length=8 do Pydantic e o frontend
    renderizava o array de validação no toast, quebrando o React (error #31).
    """
    _injetar_usuario(
        db_fake,
        email="gestor@munaretto.com",
        senha="gestorSenha123",
        permissoes=("configuracoes",),
    )
    token = _login(client, email="gestor@munaretto.com", senha="gestorSenha123")
    resp = client.put(
        "/api/usuarios/99",
        json={
            "nome": "Teste",
            "email": "teste@munaretto.com",
            "senha": "",
            "ativo": True,
            "permissoes": ["clientes", "sst"],
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "sst" in body["permissoes"]
    assert "senha" not in body


def test_health_publico(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "online"
