"""Testes das melhorias do implementation_plan.md.

Cobre: renovação de sessão (/api/usuarios/refresh), exportação XLSX de
comprovantes e validação de e-mail com EmailStr.
"""

import hashlib


def _hash_senha(senha: str) -> str:
    salt = "0123456789abcdef"
    valor = hashlib.pbkdf2_hmac(
        "sha256", senha.encode("utf-8"), bytes.fromhex(salt), 100000
    ).hex()
    return f"{salt}${valor}"


def _injetar_usuario(db_fake, email="gestor@munaretto.com", senha="gestorSenha123", permissoes=("configuracoes",)):
    db_fake._dados["usuarios"].append(
        {
            "id": 88,
            "nome": "Gestor",
            "email": email,
            "senha": _hash_senha(senha),
            "permissoes": list(permissoes),
            "ativo": True,
            "precisa_trocar_senha": False,
        }
    )


def test_refresh_emite_novo_token(client, db_fake):
    """POST /api/usuarios/refresh com token válido devolve um novo token."""
    _injetar_usuario(db_fake)
    resp = client.post(
        "/api/usuarios/login",
        json={"email": "gestor@munaretto.com", "senha": "gestorSenha123"},
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["token"]

    resp = client.post(
        "/api/usuarios/refresh",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["token"]
    assert body["email"] == "gestor@munaretto.com"
    assert "senha" not in body


def test_refresh_sem_token_retorna_401(client):
    resp = client.post("/api/usuarios/refresh")
    assert resp.status_code in (401, 403)


def test_exportar_comprovantes_xlsx(client, db_fake):
    """GET /api/comprovantes/exportar devolve um .xlsx válido."""
    db_fake._dados["usuarios"].append(
        {
            "id": 77,
            "nome": "Contabilidade",
            "email": "cont@munaretto.com",
            "senha": _hash_senha("senhaCont1"),
            "permissoes": ["comprovantes"],
            "ativo": True,
            "precisa_trocar_senha": False,
        }
    )
    db_fake._dados.setdefault("comprovantes", []).append(
        {
            "id": 1,
            "tipo_documento": "Boleto",
            "nome": "Energia",
            "descricao": "Conta de energia",
            "valor_pago": 1500.0,
            "data_registro": "2026-08-01",
        }
    )
    resp = client.post(
        "/api/usuarios/login",
        json={"email": "cont@munaretto.com", "senha": "senhaCont1"},
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["token"]

    resp = client.get(
        "/api/comprovantes/exportar",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.content[:2] == b"PK"  # assinatura ZIP/xlsx
    assert "comprovantes.xlsx" in resp.headers.get("content-disposition", "")


def test_email_invalido_rejeitado(client, db_fake):
    """Criação de usuário com e-mail malformado deve retornar 422."""
    _injetar_usuario(db_fake, email="gestor@munaretto.com", senha="gestorSenha123", permissoes=("configuracoes",))
    resp = client.post(
        "/api/usuarios/login",
        json={"email": "gestor@munaretto.com", "senha": "gestorSenha123"},
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["token"]

    resp = client.post(
        "/api/usuarios/",
        json={
            "nome": "Novo",
            "email": "email-sem-arroba",
            "senha": "senhaForte123",
            "permissoes": ["clientes"],
            "ativo": True,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 422


def test_email_valido_aceito(client, db_fake):
    """Criação de usuário com e-mail válido deve retornar 201."""
    _injetar_usuario(db_fake, email="gestor@munaretto.com", senha="gestorSenha123", permissoes=("configuracoes",))
    resp = client.post(
        "/api/usuarios/login",
        json={"email": "gestor@munaretto.com", "senha": "gestorSenha123"},
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["token"]

    resp = client.post(
        "/api/usuarios/",
        json={
            "nome": "Novo Usuário",
            "email": "novo@munaretto.com",
            "senha": "senhaForte123",
            "permissoes": ["clientes"],
            "ativo": True,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201, resp.text


def test_login_com_hash_novo_formato(client, db_fake):
    """Login deve funcionar com hash no novo formato pbkdf2$sha256$100000$salt$hash."""
    import hashlib as _hl

    salt = "0123456789abcdef"
    valor = _hl.pbkdf2_hmac(
        "sha256", "senhaNova123".encode("utf-8"), bytes.fromhex(salt), 100000
    ).hex()
    db_fake._dados["usuarios"].append(
        {
            "id": 55,
            "nome": "Novo Formato",
            "email": "novoformato@munaretto.com",
            "senha": f"pbkdf2$sha256$100000${salt}${valor}",
            "permissoes": ["clientes"],
            "ativo": True,
            "precisa_trocar_senha": False,
        }
    )
    resp = client.post(
        "/api/usuarios/login",
        json={"email": "novoformato@munaretto.com", "senha": "senhaNova123"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["token"]


def test_rate_limiter_persiste_no_banco(client, db_fake):
    """Contador de tentativas fica persistido na tabela login_tentativas."""
    import time as _time

    _injetar_usuario(db_fake)
    chave = "gestor@munaretto.com"

    for _ in range(3):
        resp = client.post(
            "/api/usuarios/login",
            json={"email": chave, "senha": "senha-errada"},
        )
        assert resp.status_code == 401

    linhas = db_fake._dados["login_tentativas"]
    linha = next((r for r in linhas if r["chave"] == chave), None)
    assert linha is not None, "Tentativas deveriam estar persistidas no banco"
    assert linha["contador"] == 3
    assert "janela_inicio" in linha


def test_rate_limiter_bloqueia_apos_limite(client, db_fake):
    """Após o limite de tentativas, o login retorna 429."""
    _injetar_usuario(db_fake)
    chave = "gestor@munaretto.com"

    for _ in range(5):
        resp = client.post(
            "/api/usuarios/login",
            json={"email": chave, "senha": "senha-errada"},
        )
        assert resp.status_code == 401

    resp = client.post(
        "/api/usuarios/login",
        json={"email": chave, "senha": "senha-errada"},
    )
    assert resp.status_code == 429


def test_rate_limiter_restaura_apos_login_bem_sucedido(client, db_fake):
    """Um login bem-sucedido zera o contador persistido."""
    _injetar_usuario(db_fake)
    chave = "gestor@munaretto.com"

    for _ in range(2):
        resp = client.post(
            "/api/usuarios/login",
            json={"email": chave, "senha": "senha-errada"},
        )
        assert resp.status_code == 401

    resp = client.post(
        "/api/usuarios/login",
        json={"email": chave, "senha": "gestorSenha123"},
    )
    assert resp.status_code == 200, resp.text

    linhas = db_fake._dados["login_tentativas"]
    assert all(r["chave"] != chave for r in linhas), "Contador deveria ter sido zerado"