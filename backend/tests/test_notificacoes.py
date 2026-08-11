"""Testes da central de notificações (T5.x).

Cobre: listar apenas não lidas (incluindo lida NULL de registros legados),
marcar individual como lida, marcar todas como lidas, excluir notificação e
isolamento por destinatário.
"""

import hashlib

EMAIL = "usuario@munaretto.com"
SENHA = "senhaForte123"


def _hash_senha(senha: str) -> str:
    salt = "0123456789abcdef"
    valor = hashlib.pbkdf2_hmac(
        "sha256", senha.encode("utf-8"), bytes.fromhex(salt), 100000
    ).hex()
    return f"{salt}${valor}"


def _injetar_usuario(db_fake):
    db_fake._dados["usuarios"].append(
        {
            "id": 90,
            "nome": "Usuário",
            "email": EMAIL,
            "senha": _hash_senha(SENHA),
            "permissoes": ["ferias"],
            "ativo": True,
            "precisa_trocar_senha": False,
        }
    )


def _login(client):
    resp = client.post("/api/usuarios/login", json={"email": EMAIL, "senha": SENHA})
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


def _sembrar_notificacoes(db_fake):
    db_fake._dados["notificacoes"] = [
        {"id": 1, "tipo": "ferias", "titulo": "Nova", "mensagem": "A",
         "destinatario": EMAIL, "ferias_id": None, "lida": False,
         "criada_por": "Sistema", "created_at": "2026-08-01T10:00:00Z"},
        {"id": 2, "tipo": "ferias", "titulo": "Lida", "mensagem": "B",
         "destinatario": EMAIL, "ferias_id": None, "lida": True,
         "criada_por": "Sistema", "created_at": "2026-08-02T10:00:00Z"},
        # Registro legado sem valor em lida (NULL) — deve contar como NÃO lida
        {"id": 3, "tipo": "ferias", "titulo": "Sem lida", "mensagem": "C",
         "destinatario": EMAIL, "ferias_id": None, "lida": None,
         "criada_por": "Sistema", "created_at": "2026-08-03T10:00:00Z"},
        # Notificação de OUTRO usuário — nunca deve aparecer
        {"id": 4, "tipo": "ferias", "titulo": "Outro", "mensagem": "D",
         "destinatario": "outro@munaretto.com", "ferias_id": None, "lida": False,
         "criada_por": "Sistema", "created_at": "2026-08-04T10:00:00Z"},
    ]


def _token_header(client):
    token = _login(client)
    return {"Authorization": f"Bearer {token}"}


def test_listar_nao_lidas_inclui_nulls(client, db_fake):
    _injetar_usuario(db_fake)
    _sembrar_notificacoes(db_fake)
    resp = client.get("/api/notificacoes/?lida=false", headers=_token_header(client))
    assert resp.status_code == 200, resp.text
    ids = {n["id"] for n in resp.json()}
    # Inclui a não lida e a NULL, mas NÃO a lida nem a de outro destinatário
    assert ids == {1, 3}


def test_listar_lidas(client, db_fake):
    _injetar_usuario(db_fake)
    _sembrar_notificacoes(db_fake)
    resp = client.get("/api/notificacoes/?lida=true", headers=_token_header(client))
    assert resp.status_code == 200, resp.text
    ids = {n["id"] for n in resp.json()}
    assert ids == {2}


def test_listar_todas_escopo_destinatario(client, db_fake):
    _injetar_usuario(db_fake)
    _sembrar_notificacoes(db_fake)
    resp = client.get("/api/notificacoes/", headers=_token_header(client))
    assert resp.status_code == 200, resp.text
    ids = {n["id"] for n in resp.json()}
    # Nunca expõe notificações de outro destinatário
    assert 4 not in ids
    assert len(resp.json()) == 3


def test_marcar_uma_como_lida(client, db_fake):
    _injetar_usuario(db_fake)
    _sembrar_notificacoes(db_fake)
    resp = client.patch("/api/notificacoes/1/lida", headers=_token_header(client))
    assert resp.status_code == 200, resp.text
    reg = next(r for r in db_fake._dados["notificacoes"] if r["id"] == 1)
    assert reg["lida"] is True


def test_marcar_lida_nao_encontrada(client, db_fake):
    _injetar_usuario(db_fake)
    _sembrar_notificacoes(db_fake)
    resp = client.patch("/api/notificacoes/999/lida", headers=_token_header(client))
    assert resp.status_code == 404


def test_marcar_lida_de_outro_destinatario_negado(client, db_fake):
    _injetar_usuario(db_fake)
    _sembrar_notificacoes(db_fake)
    # A notificação 4 é de outro usuário: não pode ser marcada como lida
    resp = client.patch("/api/notificacoes/4/lida", headers=_token_header(client))
    assert resp.status_code == 404


def test_marcar_todas_como_lidas_inclui_nulls(client, db_fake):
    _injetar_usuario(db_fake)
    _sembrar_notificacoes(db_fake)
    resp = client.post(
        "/api/notificacoes/marcar-todas-lidas?destinatario=qualquer",
        headers=_token_header(client),
    )
    assert resp.status_code == 200, resp.text
    # Todas as do destinatário viram lida (incluindo a NULL); a de outro não muda
    for r in db_fake._dados["notificacoes"]:
        if r["destinatario"] == EMAIL:
            assert r["lida"] is True
        else:
            assert r["lida"] is False


def test_excluir_notificacao(client, db_fake):
    _injetar_usuario(db_fake)
    _sembrar_notificacoes(db_fake)
    resp = client.delete("/api/notificacoes/1", headers=_token_header(client))
    assert resp.status_code == 200, resp.text
    ids = {r["id"] for r in db_fake._dados["notificacoes"]}
    assert 1 not in ids
    assert 4 in ids  # não remove a de outro usuário


def test_excluir_notificacao_de_outro_destinatario_negado(client, db_fake):
    _injetar_usuario(db_fake)
    _sembrar_notificacoes(db_fake)
    resp = client.delete("/api/notificacoes/4", headers=_token_header(client))
    assert resp.status_code == 404
    ids = {r["id"] for r in db_fake._dados["notificacoes"]}
    assert 4 in ids
