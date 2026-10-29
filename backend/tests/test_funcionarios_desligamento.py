"""Testes do fluxo de desligamento de funcionários.

Cobre: preservação do cadastro/histórico, desativação de logins, saída das
equipes, bloqueios (apontamento aberto e último administrador), filtros,
estatísticas e reativação.
"""

import hashlib
from datetime import date

HOJE = date.today().isoformat()


def _hash_senha(senha: str) -> str:
    salt = "0123456789abcdef"
    valor = hashlib.pbkdf2_hmac("sha256", senha.encode("utf-8"), bytes.fromhex(salt), 100000).hex()
    return f"{salt}${valor}"


def _criar_usuario(db_fake, uid, email, senha, permissoes, funcionario_id=None, ativo=True):
    db_fake._dados["usuarios"].append(
        {
            "id": uid,
            "nome": f"Usuário {uid}",
            "email": email,
            "senha": _hash_senha(senha),
            "permissoes": permissoes,
            "ativo": ativo,
            "precisa_trocar_senha": False,
            "funcionario_id": funcionario_id,
        }
    )


def _logar(client, email, senha):
    resp = client.post("/api/usuarios/login", json={"email": email, "senha": senha})
    assert resp.status_code == 200, resp.text
    client.headers.update({"Authorization": f"Bearer {resp.json()['token']}"})


def _criar_funcionario(db_fake, fid, nome, cpf, ativo=True, desligado=False, **extras):
    db_fake._dados["funcionarios"].append(
        {
            "id": fid,
            "nome": nome,
            "cpf": cpf,
            "ativo": ativo,
            "desligado": desligado,
            "excluido": False,
            **extras,
        }
    )


def _preparar_admin(client, db_fake):
    _criar_usuario(db_fake, 500, "admin.funcionarios@munaretto.com", "senhaAdmin123", ["funcionarios"])
    _logar(client, "admin.funcionarios@munaretto.com", "senhaAdmin123")


def _payload_desligamento(**extras):
    return {
        "data_desligamento": HOJE,
        "motivo_desligamento": "Pedido de demissão",
        "observacao_desligamento": "Teste",
        **extras,
    }


def test_desligamento_inativa_funcionario_e_desativa_login(client, db_fake):
    _preparar_admin(client, db_fake)
    _criar_funcionario(db_fake, 50, "Maria da Silva", "11111111111")
    _criar_usuario(
        db_fake,
        501,
        "maria@munaretto.com",
        "senhaMaria123",
        ["os_campo"],
        funcionario_id=50,
    )

    resp = client.patch("/api/funcionarios/50/desligamento", json=_payload_desligamento())
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["funcionario"]["ativo"] is False
    assert body["funcionario"]["desligado"] is True
    assert body["funcionario"]["data_desligamento"] == HOJE
    assert body["funcionario"]["motivo_desligamento"] == "Pedido de demissão"
    assert body["funcionario"]["desligado_por"] == "admin.funcionarios@munaretto.com"
    assert body["usuarios_desativados"] == 1

    funcionario = next(f for f in db_fake._dados["funcionarios"] if f["id"] == 50)
    usuario = next(u for u in db_fake._dados["usuarios"] if u["id"] == 501)
    assert funcionario["excluido"] is False
    assert funcionario["desligado"] is True
    assert usuario["ativo"] is False

    desligados = client.get("/api/funcionarios/?status=desligados").json()
    assert [f["id"] for f in desligados] == [50]
    inativos = client.get("/api/funcionarios/?status=inativos").json()
    assert inativos == []

    stats = client.get("/api/funcionarios/stats").json()
    assert stats == {"total": 1, "ativos": 0, "inativos": 0, "desligados": 1}


def test_desligamento_remove_equipe_e_avisa_lideranca(client, db_fake):
    _preparar_admin(client, db_fake)
    _criar_funcionario(db_fake, 51, "Líder de Campo", "22222222222")
    db_fake._dados["equipes"].append({"id": 300, "nome": "Equipe A", "ativa": True})
    db_fake._dados["equipe_membros"].append(
        {"id": 1, "equipe_id": 300, "funcionario_id": 51, "lider": True}
    )

    resp = client.patch("/api/funcionarios/51/desligamento", json=_payload_desligamento())
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["equipes_removidas"] == ["Equipe A"]
    assert any("sem líder" in aviso for aviso in body["avisos"])
    assert db_fake._dados["equipe_membros"] == []


def test_desligamento_bloqueia_apontamento_aberto(client, db_fake):
    _preparar_admin(client, db_fake)
    _criar_funcionario(db_fake, 52, "João da Silva", "33333333333")
    db_fake._dados["os_apontamentos"].append(
        {"id": 1, "os_id": 900, "funcionario_id": 52, "inicio": "2026-01-01T08:00:00Z", "fim": None}
    )

    resp = client.patch("/api/funcionarios/52/desligamento", json=_payload_desligamento())
    assert resp.status_code == 409, resp.text
    assert "apontamento" in resp.json()["detail"].lower()

    funcionario = next(f for f in db_fake._dados["funcionarios"] if f["id"] == 52)
    assert funcionario["ativo"] is True
    assert not funcionario.get("desligado")


def test_desligamento_bloqueia_ultimo_administrador(client, db_fake):
    _criar_funcionario(db_fake, 53, "Sócio Administrador", "44444444444")
    _criar_usuario(
        db_fake,
        503,
        "socio@munaretto.com",
        "senhaSocio123",
        ["configuracoes"],
        funcionario_id=53,
    )
    _criar_usuario(db_fake, 504, "rh@munaretto.com", "senhaRh123", ["funcionarios"])
    db_fake._dados["usuarios"][0]["ativo"] = False

    _logar(client, "rh@munaretto.com", "senhaRh123")
    resp = client.patch("/api/funcionarios/53/desligamento", json=_payload_desligamento())
    assert resp.status_code == 400, resp.text
    assert "último administrador" in resp.json()["detail"].lower()

    funcionario = next(f for f in db_fake._dados["funcionarios"] if f["id"] == 53)
    usuario = next(u for u in db_fake._dados["usuarios"] if u["id"] == 503)
    assert funcionario["ativo"] is True
    assert usuario["ativo"] is True


def test_desligamento_preserva_historico_e_bloqueia_exclusao(client, db_fake):
    _preparar_admin(client, db_fake)
    _criar_funcionario(db_fake, 54, "Carlos Pereira", "55555555555")
    db_fake._dados["aso"].append(
        {"id": 1, "funcionario_id": 54, "tipo_exame": "periodico", "data_exame": "2026-01-01"}
    )
    db_fake._dados["funcionario_treinamentos"].append(
        {"id": 1, "funcionario_id": 54, "treinamento_id": 1, "data_realizacao": "2026-01-01"}
    )

    resp = client.patch("/api/funcionarios/54/desligamento", json=_payload_desligamento())
    assert resp.status_code == 200, resp.text
    assert db_fake._dados["aso"]
    assert db_fake._dados["funcionario_treinamentos"]

    resp = client.delete("/api/funcionarios/54")
    assert resp.status_code == 409
    assert "desligamento registrado" in resp.json()["detail"]


def test_excluir_cadastro_com_historico_e_bloqueado(client, db_fake):
    _preparar_admin(client, db_fake)
    _criar_funcionario(db_fake, 55, "Cadastro com Histórico", "66666666666")
    db_fake._dados["aso"].append(
        {"id": 2, "funcionario_id": 55, "tipo_exame": "admissional", "data_exame": "2026-01-01"}
    )

    resp = client.delete("/api/funcionarios/55")
    assert resp.status_code == 409
    assert "ASO" in resp.json()["detail"]


def test_excluir_cadastro_sem_historico_remove_registro(client, db_fake):
    _preparar_admin(client, db_fake)
    _criar_funcionario(db_fake, 56, "Cadastro Errado", "77777777777")

    resp = client.delete("/api/funcionarios/56")
    assert resp.status_code == 200, resp.text
    assert all(f["id"] != 56 for f in db_fake._dados["funcionarios"])


def test_inativar_e_reativar_nao_confunde_com_desligamento(client, db_fake):
    _preparar_admin(client, db_fake)
    _criar_funcionario(db_fake, 57, "Ana Souza", "88888888888")

    resp = client.patch("/api/funcionarios/57/status", json={"ativo": False})
    assert resp.status_code == 200, resp.text
    assert resp.json()["ativo"] is False
    assert resp.json()["desligado"] is False
    assert any(f["id"] == 57 for f in client.get("/api/funcionarios/?status=inativos").json())

    resp = client.patch("/api/funcionarios/57/desligamento", json=_payload_desligamento())
    assert resp.status_code == 200, resp.text

    resp = client.patch("/api/funcionarios/57/status", json={"ativo": True})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ativo"] is True
    assert body["desligado"] is False
    assert body["data_desligamento"] == HOJE
    assert any(f["id"] == 57 for f in client.get("/api/funcionarios/?status=ativos").json())


def test_checklist_mostra_vinculos_e_bloqueio(client, db_fake):
    _preparar_admin(client, db_fake)
    _criar_funcionario(db_fake, 58, "Pedro Lima", "99999999999")
    _criar_usuario(
        db_fake,
        502,
        "pedro@munaretto.com",
        "senhaPedro123",
        ["os_campo"],
        funcionario_id=58,
    )
    db_fake._dados["equipes"].append({"id": 301, "nome": "Equipe B", "ativa": True})
    db_fake._dados["equipe_membros"].append(
        {"id": 2, "equipe_id": 301, "funcionario_id": 58, "lider": False}
    )
    db_fake._dados["funcionario_epis"].append(
        {"id": 1, "funcionario_id": 58, "epi_id": 1, "data_entrega": "2026-01-01", "data_devolucao": None}
    )

    resp = client.get("/api/funcionarios/58/desligamento/checklist")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [u["id"] for u in body["usuarios_vinculados"]] == [502]
    assert [e["id"] for e in body["equipes"]] == [301]
    assert body["epis_em_uso"] == 1
    assert body["aso_demissional_registrado"] is False
    assert body["bloqueios"] == []

    db_fake._dados["os_apontamentos"].append(
        {"id": 2, "os_id": 901, "funcionario_id": 58, "inicio": "2026-01-01T08:00:00Z", "fim": None}
    )
    resp = client.get("/api/funcionarios/58/desligamento/checklist")
    assert resp.status_code == 200
    assert len(resp.json()["bloqueios"]) == 1


def test_cadastrar_cpf_de_funcionario_desligado_orienta_reativacao(client, db_fake):
    _preparar_admin(client, db_fake)
    _criar_funcionario(
        db_fake,
        59,
        "Ex Funcionário",
        "10101010101",
        ativo=False,
        desligado=True,
        data_desligamento=HOJE,
        motivo_desligamento="Pedido de demissão",
    )

    resp = client.post("/api/funcionarios/", json={"nome": "Ex Funcionário", "cpf": "10101010101"})
    assert resp.status_code == 400, resp.text
    assert "Reative" in resp.json()["detail"]


def test_usuario_sem_permissao_de_gestao_nao_desliga(client, db_fake):
    _criar_funcionario(db_fake, 60, "Funcionário Protegido", "12121212121")
    _criar_usuario(db_fake, 505, "sst@munaretto.com", "senhaSst123", ["sst"])
    _logar(client, "sst@munaretto.com", "senhaSst123")

    resp = client.patch("/api/funcionarios/60/desligamento", json=_payload_desligamento())
    assert resp.status_code == 403


def test_estatisticas_e_filtros_separam_inativos_de_desligados(client, db_fake):
    _preparar_admin(client, db_fake)
    _criar_funcionario(db_fake, 70, "Ativo", "13131313131")
    _criar_funcionario(db_fake, 71, "Inativo", "14141414141", ativo=False)
    _criar_funcionario(db_fake, 72, "Desligado", "15151515151", ativo=False, desligado=True)
    _criar_funcionario(db_fake, 73, "Excluído", "16161616161", excluido=True)

    stats = client.get("/api/funcionarios/stats").json()
    assert stats == {"total": 3, "ativos": 1, "inativos": 1, "desligados": 1}

    assert [f["id"] for f in client.get("/api/funcionarios/?status=ativos").json()] == [70]
    assert [f["id"] for f in client.get("/api/funcionarios/?status=inativos").json()] == [71]
    assert [f["id"] for f in client.get("/api/funcionarios/?status=desligados").json()] == [72]
    assert len(client.get("/api/funcionarios/?status=todos").json()) == 3
