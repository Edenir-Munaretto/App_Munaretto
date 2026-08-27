"""Testes do vínculo funcionario_id no cadastro de usuários (Configurações)."""

import hashlib


def _hash_senha(senha):
    salt = "0123456789abcdef"
    v = hashlib.pbkdf2_hmac("sha256", senha.encode("utf-8"), bytes.fromhex(salt), 100000).hex()
    return f"{salt}${v}"


def _logar(client, email, senha):
    resp = client.post("/api/usuarios/login", json={"email": email, "senha": senha})
    assert resp.status_code == 200, resp.text
    client.headers.update({"Authorization": f"Bearer {resp.json()['token']}"})


def test_admin_somente_configuracoes_ve_funcionarios(client, db_fake):
    """O cadastro de Usuários precisa da lista de funcionários para vincular
    o responsável — a permissão 'configuracoes' deve bastar."""
    db_fake._dados["funcionarios"].append(
        {"id": 10, "nome": "Líder de Campo", "cpf": "11111111111", "ativo": True, "excluido": False}
    )
    db_fake._dados["usuarios"].append(
        {
            "id": 96,
            "nome": "Admin Config",
            "email": "config@munaretto.com",
            "senha": _hash_senha("senhaConfig1"),
            "permissoes": ["configuracoes"],
            "ativo": True,
            "precisa_trocar_senha": False,
        }
    )
    _logar(client, "config@munaretto.com", "senhaConfig1")
    resp = client.get("/api/funcionarios/")
    assert resp.status_code == 200, resp.text
    assert resp.json()[0]["nome"] == "Líder de Campo"


def test_vinculo_funcionario_no_usuario(client, db_fake):
    # funcionário disponível para vincular
    db_fake._dados["funcionarios"].append(
        {"id": 10, "nome": "Líder de Campo", "cpf": "11111111111", "ativo": True}
    )
    db_fake._dados["usuarios"][0]["senha"] = _hash_senha("senhaAdmin123")
    resp = client.post("/api/usuarios/login", json={"email": "admin@munaretto.com", "senha": "senhaAdmin123"})
    assert resp.status_code == 200
    client.headers.update({"Authorization": f"Bearer {resp.json()['token']}"})

    # cria usuário com funcionário vinculado
    resp = client.post(
        "/api/usuarios/",
        json={
            "nome": "Resp Equipe A",
            "email": "resp@munaretto.com",
            "senha": "senhaResp123",
            "permissoes": ["os"],
            "funcionario_id": 10,
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["funcionario_id"] == 10

    # funcionário inexistente é rejeitado
    resp = client.post(
        "/api/usuarios/",
        json={
            "nome": "Teste Invalido",
            "email": "x@munaretto.com",
            "senha": "senhaXxx123",
            "permissoes": [],
            "funcionario_id": 9999,
        },
    )
    assert resp.status_code == 400

    # lista expõe o vínculo
    resp = client.get("/api/usuarios/")
    assert resp.status_code == 200
    vinculos = [u for u in resp.json() if u.get("funcionario_id") == 10]
    assert len(vinculos) == 1

    # desvincula no update
    uid = vinculos[0]["id"]
    resp = client.put(
        f"/api/usuarios/{uid}",
        json={
            "nome": "Resp Equipe A",
            "email": "resp@munaretto.com",
            "permissoes": ["os"],
            "funcionario_id": None,
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["funcionario_id"] is None

    # login devolve o funcionario_id (para o vínculo de equipes do campo)
    resp = client.post("/api/usuarios/login", json={"email": "resp@munaretto.com", "senha": "senhaResp123"})
    assert resp.status_code == 200
    # o usuário ainda existe com vínculo nulo
    assert "funcionario_id" in resp.json()
