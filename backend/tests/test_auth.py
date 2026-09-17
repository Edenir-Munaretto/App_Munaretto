"""Testes básicos de autenticação (T5.1).

Cobre: login OK, senha errada, token inválido, rota protegida sem token,
permissão negada e a validade do token (JWT_VALIDADE_MINUTOS). Usa um cliente
Supabase fake (sem rede).
"""

import hashlib
import os

import jwt
import pytest

from auth import criar_token_acesso


def _hash_senha(senha: str) -> str:
    salt = "0123456789abcdef"
    valor = hashlib.pbkdf2_hmac("sha256", senha.encode("utf-8"), bytes.fromhex(salt), 100000).hex()
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
    resp = client.get("/api/clientes/", headers={"Authorization": "Bearer token.invalido.aqui"})
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
            # Mantém "configuracoes" para não acionar o bloqueio de
            # auto-rebaixamento (o usuário edita a si mesmo neste teste).
            "permissoes": ["clientes", "sst", "configuracoes"],
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "sst" in body["permissoes"]
    assert "senha" not in body


def test_usuarios_me_retorna_permissoes_frescas(client, db_fake):
    """/api/usuarios/me deve devolver as permissões atuais do banco."""
    _injetar_usuario(
        db_fake,
        email="gestor2@munaretto.com",
        senha="gestorSenha456",
        permissoes=("clientes", "sst"),
    )
    token = _login(client, email="gestor2@munaretto.com", senha="gestorSenha456")
    resp = client.get("/api/usuarios/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == 99
    assert "sst" in body["permissoes"]
    assert "senha" not in body


def test_funcionarios_permisao_funcionarios_ok(client, db_fake):
    """Usuário com o módulo 'funcionarios' consegue listar funcionários."""
    _injetar_usuario(
        db_fake,
        email="rh@munaretto.com",
        senha="rhSenha123",
        permissoes=("funcionarios",),
    )
    token = _login(client, email="rh@munaretto.com", senha="rhSenha123")
    resp = client.get("/api/funcionarios/", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    assert isinstance(resp.json(), list)


def test_funcionarios_permisao_negada(client, db_fake):
    """Sem nenhuma das permissões do módulo, o acesso deve ser negado (403)."""
    _injetar_usuario(
        db_fake,
        email="semmodulo@munaretto.com",
        senha="semModulo123",
        permissoes=("fluxo",),
    )
    token = _login(client, email="semmodulo@munaretto.com", senha="semModulo123")
    resp = client.get("/api/funcionarios/", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_funcionarios_permisao_sst_ok(client, db_fake):
    """Compatibilidade: quem tem 'sst' (não o módulo funcionários) também acessa."""
    _injetar_usuario(
        db_fake,
        email="sst@munaretto.com",
        senha="sstSenha123",
        permissoes=("sst",),
    )
    token = _login(client, email="sst@munaretto.com", senha="sstSenha123")
    resp = client.get("/api/funcionarios/", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text


def test_health_publico(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "online"


def _validade_do_token(token: str) -> int:
    payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=["HS256"])
    return payload["exp"] - payload["iat"]


def _preparar_segredo(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "chave-de-teste-segura-12345678901234567890")


def test_token_validade_padrao_960_minutos(monkeypatch):
    _preparar_segredo(monkeypatch)
    monkeypatch.delenv("JWT_VALIDADE_MINUTOS", raising=False)

    token = criar_token_acesso(99, "teste@munaretto.com")

    assert abs(_validade_do_token(token) - 960 * 60) <= 1


def test_token_validade_vem_do_ambiente(monkeypatch):
    _preparar_segredo(monkeypatch)
    monkeypatch.setenv("JWT_VALIDADE_MINUTOS", "120")

    token = criar_token_acesso(99, "teste@munaretto.com")

    assert abs(_validade_do_token(token) - 120 * 60) <= 1


@pytest.mark.parametrize("valor", ["", "abc", "0", "-5", "  "])
def test_token_validade_invalida_usa_fallback(monkeypatch, valor):
    _preparar_segredo(monkeypatch)
    monkeypatch.setenv("JWT_VALIDADE_MINUTOS", valor)

    token = criar_token_acesso(99, "teste@munaretto.com")

    assert abs(_validade_do_token(token) - 960 * 60) <= 1


def test_token_validade_explicita_tem_prioridade(monkeypatch):
    _preparar_segredo(monkeypatch)
    monkeypatch.setenv("JWT_VALIDADE_MINUTOS", "120")

    token = criar_token_acesso(99, "teste@munaretto.com", validade_minutos=30)

    assert abs(_validade_do_token(token) - 30 * 60) <= 1


# ---------------------------------------------------------------------------
# Endurecimento (Fase 0): token, rate limit por IP, troca de senha e admins
# ---------------------------------------------------------------------------


def test_token_sem_expiracao_e_rejeitado(client, db_fake):
    """Token sem a claim `exp` não pode ser aceito (options.require)."""
    _injetar_usuario(db_fake)
    token_sem_exp = jwt.encode(
        {"sub": "99", "email": "teste@munaretto.com"},
        os.environ["JWT_SECRET"],
        algorithm="HS256",
    )
    resp = client.get("/api/clientes/", headers={"Authorization": f"Bearer {token_sem_exp}"})
    assert resp.status_code in (401, 403)


def test_ip_cliente_usa_ultima_entrada_do_xff():
    """O IP confiável é o último do X-Forwarded-For (o primeiro pode ser forjado)."""
    from starlette.requests import Request

    from auth import obter_ip_cliente

    scope = {
        "type": "http",
        "headers": [(b"x-forwarded-for", b"9.9.9.9, 8.8.8.8, 7.7.7.7")],
        "client": ("1.2.3.4", 1234),
    }
    assert obter_ip_cliente(Request(scope)) == "7.7.7.7"


def test_hash_novo_usa_600k_iteracoes_e_antigo_continua_valido():
    from routers.usuarios import hash_senha, verificar_senha

    novo = hash_senha("senhaForte123")
    assert novo.startswith("pbkdf2$sha256$600000$")
    assert verificar_senha("senhaForte123", novo)

    antigo = _hash_senha("senhaForte123")  # formato legado salt$hash (100k)
    assert verificar_senha("senhaForte123", antigo)


def test_troca_pendente_bloqueia_rotas_e_permite_trocar_senha(client, db_fake):
    """Com `precisa_trocar_senha`, só as rotas de troca de senha respondem."""
    db_fake._dados["usuarios"].append(
        {
            "id": 98,
            "nome": "Primeiro Acesso",
            "email": "primeiro@munaretto.com",
            "senha": _hash_senha("senhaTemporaria123"),
            "permissoes": ["clientes"],
            "ativo": True,
            "precisa_trocar_senha": True,
        }
    )
    token = _login(client, email="primeiro@munaretto.com", senha="senhaTemporaria123")
    headers = {"Authorization": f"Bearer {token}"}

    bloqueado = client.get("/api/clientes/", headers=headers)
    assert bloqueado.status_code == 403
    assert "Troca de senha obrigatória" in bloqueado.json()["detail"]

    assert client.get("/api/usuarios/me", headers=headers).status_code == 200

    troca = client.post(
        "/api/usuarios/trocar-senha",
        json={"senha_atual": "senhaTemporaria123", "nova_senha": "senhaNovaForte123"},
        headers=headers,
    )
    assert troca.status_code == 200, troca.text

    liberado = client.get("/api/clientes/", headers=headers)
    assert liberado.status_code == 200, liberado.text


def test_admin_nao_pode_remover_o_proprio_acesso(client, db_fake):
    """Auto-rebaixamento (tirar 'configuracoes' de si) deve retornar 400."""
    _injetar_usuario(
        db_fake,
        email="admin2@munaretto.com",
        senha="adminSenha123",
        permissoes=("configuracoes",),
    )
    token = _login(client, email="admin2@munaretto.com", senha="adminSenha123")
    resp = client.put(
        "/api/usuarios/99",
        json={
            "nome": "Teste",
            "email": "teste@munaretto.com",
            "permissoes": ["clientes"],
            "ativo": True,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400
    assert "próprio acesso" in resp.json()["detail"]


def test_admin_nao_pode_excluir_a_propria_conta(client, db_fake):
    _injetar_usuario(
        db_fake,
        email="admin3@munaretto.com",
        senha="adminSenha456",
        permissoes=("configuracoes",),
    )
    token = _login(client, email="admin3@munaretto.com", senha="adminSenha456")
    resp = client.delete("/api/usuarios/99", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 400
    assert "própria conta" in resp.json()["detail"]
