"""Testes do Gerador de Documentos (módulo de documentos de clientes).

Cobre: os modelos de O.S (OS_CONSTRUCAO / OS_LINHA_VIVA) NÃO aparecem na
listagem do Gerador de Documentos — eles pertencem à impressão do módulo
Controle de O.S (fallback DOCX do utils/modelo_os.py) — e a geração por
esses modelos é bloqueada.
"""

import hashlib

import pytest

from routers.documentos import _mesclar_dados_obra_cliente


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


def test_mesclar_dados_da_obra_adicional():
    cliente = {
        "id": 1,
        "nome": "Cliente Teste",
        "cpf_cnpj": "12345678901",
        "endereco": "Rua antiga, 100",
        "cidade": "Cidade antiga",
        "cep": "00000-000",
        "nota_ps": "PS-LEGADO",
        "valor_da_obra": "10.000,00",
        "valor_de_devolucao": "100,00",
    }
    obra = {
        "nome": "Obra Nova",
        "nota_ps": "PS-NOVA",
        "endereco": "Nova rua, 200",
        "cidade": "Nova cidade",
        "cep": "89600-000",
        "valor_da_obra": "40.000,00",
        "valor_de_devolucao": "1.000,00",
    }

    dados = _mesclar_dados_obra_cliente(cliente, obra)
    assert dados["nome"] == "Cliente Teste"
    assert dados["cpf_cnpj"] == "12345678901"
    assert dados["endereco"] == "Nova rua, 200"
    assert dados["cidade"] == "Nova cidade"
    assert dados["cep"] == "89600-000"
    assert dados["nota_ps"] == "PS-NOVA"
    assert dados["valor_da_obra"] == "40.000,00"
    assert dados["valor_de_devolucao"] == "1.000,00"


def test_mesclar_obra_sem_dados_mantem_cadastro_do_cliente():
    cliente = {
        "nome": "Cliente Teste",
        "cpf_cnpj": "12345678901",
        "endereco": "Rua antiga, 100",
        "cidade": "Cidade antiga",
        "nota_ps": "",
        "valor_da_obra": "10.000,00",
    }
    obra = {
        "nome": "Obra Sem Dados",
        "nota_ps": None,
        "endereco": None,
        "cidade": None,
        "valor_da_obra": None,
    }

    dados = _mesclar_dados_obra_cliente(cliente, obra)
    assert dados["endereco"] == "Rua antiga, 100"
    assert dados["cidade"] == "Cidade antiga"
    assert dados["nota_ps"] == ""
    assert dados["valor_da_obra"] == "10.000,00"


def test_gerar_com_obra_adicional_de_outro_cliente_retorna_404(documentos_client, db_fake):
    db_fake._dados.setdefault("obras_cliente", []).append(
        {"id": 99, "cliente_id": 2, "nome": "Obra de outro cliente", "ativo": True}
    )

    resp = documentos_client.post(
        "/api/documentos/gerar",
        data={
            "cliente_id": 1,
            "template_name": "CONTRATO",
            "formato": "word",
            "obra_cliente_id": 99,
        },
    )
    assert resp.status_code == 404
