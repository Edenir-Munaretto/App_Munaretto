"""Testes do relatório PDF de funcionários.

Cobre os filtros por status e busca, os totais do resumo, as colunas de
desligamento e a integração com o gerador de PDF.
"""

import hashlib

import pymupdf

from utils.pdf_funcionarios import _resumo


def _hash_senha(senha: str) -> str:
    salt = "0123456789abcdef"
    valor = hashlib.pbkdf2_hmac("sha256", senha.encode("utf-8"), bytes.fromhex(salt), 100000).hex()
    return f"{salt}${valor}"


def _criar_usuario(db_fake, uid, email, senha, permissoes):
    db_fake._dados["usuarios"].append(
        {
            "id": uid,
            "nome": f"Usuário {uid}",
            "email": email,
            "senha": _hash_senha(senha),
            "permissoes": permissoes,
            "ativo": True,
            "precisa_trocar_senha": False,
        }
    )


def _preparar_admin(client, db_fake):
    _criar_usuario(db_fake, 600, "admin.relatorio@munaretto.com", "senhaAdmin123", ["funcionarios"])
    resp = client.post(
        "/api/usuarios/login",
        json={"email": "admin.relatorio@munaretto.com", "senha": "senhaAdmin123"},
    )
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


def _semear_funcionarios(db_fake):
    db_fake._dados["cargos"] = [
        {"id": 1, "nome": "Eletricista", "ativo": True},
        {"id": 2, "nome": "Encarregado", "ativo": True},
    ]
    _criar_funcionario(db_fake, 1, "Ana Ativa", "11111111111", cargo_id=1)
    _criar_funcionario(db_fake, 2, "Bruno Inativo", "22222222222", ativo=False)
    _criar_funcionario(
        db_fake,
        3,
        "Carla Desligada",
        "33333333333",
        ativo=False,
        desligado=True,
        cargo_id=1,
        cargo_id_2=2,
        data_desligamento="2026-01-15",
        motivo_desligamento="Pedido de demissão",
        observacao_desligamento="Desligamento de teste",
    )
    _criar_funcionario(db_fake, 4, "Diego Sem Cargo", "44444444444")
    _criar_funcionario(db_fake, 5, "Excluído", "55555555555", ativo=True, excluido=True)


def _texto_pdf(resp) -> str:
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/pdf")
    doc = pymupdf.open(stream=resp.content, filetype="pdf")
    return "\n".join(pagina.get_text() for pagina in doc)


def _relatorio(client, **params):
    return client.get("/api/funcionarios/relatorio", params=params)


def test_resumo_conta_status():
    funcionarios = [
        {"ativo": True, "desligado": False},
        {"ativo": True, "desligado": False},
        {"ativo": False, "desligado": False},
        {"ativo": False, "desligado": True},
    ]
    assert _resumo(funcionarios) == (4, 2, 1, 1)


def test_relatorio_resumo_em_tres_colunas(client, db_fake):
    _preparar_admin(client, db_fake)
    _semear_funcionarios(db_fake)

    resp = _relatorio(client)
    assert resp.status_code == 200, resp.text
    pagina = pymupdf.open(stream=resp.content, filetype="pdf")[0]
    palavras = pagina.get_text("words")

    def y_da_palavra(palavra):
        areas = [item for item in palavras if item[4] == palavra]
        assert areas, f"Palavra não encontrada no PDF: {palavra}"
        return areas[0][1]

    primeira_linha = [y_da_palavra(palavra) for palavra in ("FILTRO", "BUSCA", "TOTAL")]
    segunda_linha = [y_da_palavra(palavra) for palavra in ("ATIVOS", "INATIVOS", "DESLIGADOS")]

    assert max(primeira_linha) - min(primeira_linha) <= 1.5
    assert max(segunda_linha) - min(segunda_linha) <= 1.5
    assert min(segunda_linha) > max(primeira_linha)


def test_relatorio_ativos_por_padrao_exclui_inativos_e_desligados(client, db_fake):
    _preparar_admin(client, db_fake)
    _semear_funcionarios(db_fake)

    resp = _relatorio(client)
    assert "funcionarios_ativos.pdf" in resp.headers.get("content-disposition", "")
    texto = _texto_pdf(resp)

    assert "RELATÓRIO DE FUNCIONÁRIOS" in texto
    assert "Ana Ativa" in texto
    assert "Diego Sem Cargo" in texto
    assert "Eletricista" in texto
    assert "111.111.111-11" in texto
    assert "Bruno Inativo" not in texto
    assert "Carla Desligada" not in texto
    assert "Excluído" not in texto
    assert "FILTRO APLICADO" in texto
    assert "Ativos" in texto


def test_relatorio_inativos_nao_inclui_desligados(client, db_fake):
    _preparar_admin(client, db_fake)
    _semear_funcionarios(db_fake)

    texto = _texto_pdf(_relatorio(client, status="inativos"))

    assert "Bruno Inativo" in texto
    assert "Ana Ativa" not in texto
    assert "Carla Desligada" not in texto
    assert "Diego Sem Cargo" not in texto


def test_relatorio_desligados_inclui_data_motivo_e_dois_cargos(client, db_fake):
    _preparar_admin(client, db_fake)
    _semear_funcionarios(db_fake)

    texto = _texto_pdf(_relatorio(client, status="desligados"))

    assert "Carla Desligada" in texto
    assert "15/01/2026" in texto
    assert "Pedido de demissão" in texto
    assert "Eletricista / Encarregado" in texto
    assert "Desligamento" in texto
    assert "Motivo" in texto
    assert "Ana Ativa" not in texto
    assert "Bruno Inativo" not in texto


def test_relatorio_todos_inclui_status_e_desligamento(client, db_fake):
    _preparar_admin(client, db_fake)
    _semear_funcionarios(db_fake)

    texto = _texto_pdf(_relatorio(client, status="todos"))

    for nome in ("Ana Ativa", "Bruno Inativo", "Carla Desligada", "Diego Sem Cargo"):
        assert nome in texto
    assert "Ativo" in texto
    assert "Inativo" in texto
    assert "Desligado" in texto
    assert "Excluído" not in texto


def test_relatorio_busca_por_nome_e_cpf(client, db_fake):
    _preparar_admin(client, db_fake)
    _semear_funcionarios(db_fake)

    por_nome = _texto_pdf(_relatorio(client, status="todos", busca="Carla"))
    assert "Carla Desligada" in por_nome
    assert "Ana Ativa" not in por_nome

    por_cpf = _texto_pdf(_relatorio(client, busca="44444444444"))
    assert "Diego Sem Cargo" in por_cpf
    assert "Ana Ativa" not in por_cpf


def test_relatorio_sem_resultados_gera_pdf_com_aviso(client, db_fake):
    _preparar_admin(client, db_fake)
    _semear_funcionarios(db_fake)

    texto = _texto_pdf(_relatorio(client, busca="inexistente"))
    assert "Nenhum funcionário encontrado" in texto


def test_relatorio_status_invalido_retorna_422(client, db_fake):
    _preparar_admin(client, db_fake)
    assert _relatorio(client, status="excluidos").status_code == 422


def test_relatorio_com_travessao_nao_quebra(client, db_fake):
    _preparar_admin(client, db_fake)
    _criar_funcionario(db_fake, 10, "João — Teste", "99999999999")

    texto = _texto_pdf(_relatorio(client))
    assert "João" in texto
    assert "Teste" in texto
