"""Testes da importação em lote de comprovantes/boletos via planilha .xlsx.

Cobre: download do modelo, importação com dados válidos e inválidos,
validação de formato e de tipos/valores.
"""

import hashlib
import io

import pytest
from openpyxl import Workbook


def _hash_senha(senha: str) -> str:
    salt = "0123456789abcdef"
    valor = hashlib.pbkdf2_hmac(
        "sha256", senha.encode("utf-8"), bytes.fromhex(salt), 100000
    ).hex()
    return f"{salt}${valor}"


def _montar_planilha(linhas):
    """Monta uma planilha .xlsx com o cabeçalho do modelo e as linhas dadas."""
    cabecalhos = [
        "Tipo do Documento", "Nome", "CNPJ/CPF", "Número NF", "Data de Emissão",
        "Data de Vencimento", "Data de Pagamento", "Descrição", "Valor Total",
        "Base de Cálculo", "Valor INSS", "Valor ISS", "Valor Líquido",
        "Valor Pago", "Valor Juros", "Local de Serviço", "Forma de Pagamento",
    ]
    wb = Workbook()
    ws = wb.active
    for r, linha in enumerate([cabecalhos] + linhas, start=1):
        for c, valor in enumerate(linha, start=1):
            # ws.cell com valor None ainda materializa a linha (como o Excel faz)
            ws.cell(row=r, column=c, value=valor)
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return buffer


@pytest.fixture
def comprovante_client(client, db_fake):
    """Cliente autenticado com permissão de módulo 'comprovantes'."""
    db_fake._dados["usuarios"].append(
        {
            "id": 99,
            "nome": "Contabilidade",
            "email": "contabilidade@munaretto.com",
            "senha": _hash_senha("senhaCont1"),
            "permissoes": ["comprovantes"],
            "ativo": True,
            "precisa_trocar_senha": False,
        }
    )
    resp = client.post(
        "/api/usuarios/login",
        json={"email": "contabilidade@munaretto.com", "senha": "senhaCont1"},
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["token"]
    client.headers.update({"Authorization": f"Bearer {token}"})
    return client


def test_download_modelo(comprovante_client):
    resp = comprovante_client.get("/api/comprovantes/modelo")
    assert resp.status_code == 200
    assert resp.content[:2] == b"PK"  # assinatura de arquivo ZIP/xlsx
    assert "modelo_comprovantes.xlsx" in resp.headers.get("content-disposition", "")


def test_importar_planilha_valida(comprovante_client, db_fake):
    buffer = _montar_planilha([
        ["Boleto", "Energia", "00.000.000/0001-00", None, None,
         "15/08/2026", "16/08/2026", "Conta de energia", None,
         None, None, None, None, "1500,00", "0,00", None, "boleto"],
        ["Nota Fiscal", "Fornecedor Ltda", "12.345.678/0001-90", "12345",
         "10/08/2026", None, None, None, "5000,00",
         "5000,00", "550,00", "250,00", "4200,00", None, None, "São Paulo/SP", None],
    ])
    resp = comprovante_client.post(
        "/api/comprovantes/importar",
        files={"file": ("planilha.xlsx", buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["importados"] == 2
    assert data["erros"] == []
    assert data["total"] == 2

    comprovantes = db_fake._dados["comprovantes"]
    assert len(comprovantes) == 2
    assert comprovantes[0]["tipo_documento"] == "Boleto"
    assert comprovantes[0]["valor_pago"] == 1500.0
    assert comprovantes[0]["data_vencimento"] == "2026-08-15"
    assert comprovantes[0]["forma_pagamento"] == "boleto"
    assert comprovantes[1]["tipo_documento"] == "Nota Fiscal"
    assert comprovantes[1]["valor_liquido"] == 4200.0


def test_importar_linha_invalida_reporta_erro(comprovante_client, db_fake):
    buffer = _montar_planilha([
        ["Boleto", "Energia", None, None, None, None, None, None,
         None, None, None, None, None, None, None, None, None],  # sem descrição/valor
        ["Tipo Errado", "X", None, None, None, None, None, None,
         None, None, None, None, None, "100,00", None, None, None],
    ])
    resp = comprovante_client.post(
        "/api/comprovantes/importar",
        files={"file": ("invalida.xlsx", buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["importados"] == 0
    assert len(data["erros"]) == 2


def test_importar_arquivo_nao_xlsx(comprovante_client):
    resp = comprovante_client.post(
        "/api/comprovantes/importar",
        files={"file": ("arquivo.txt", io.BytesIO(b"dados"), "text/plain")},
    )
    assert resp.status_code == 400


def test_sem_permissao_nao_importa(client, db_fake):
    db_fake._dados["usuarios"].append(
        {
            "id": 98,
            "nome": "Sem Permissão",
            "email": "semperm@munaretto.com",
            "senha": _hash_senha("senhaSem1"),
            "permissoes": ["clientes"],
            "ativo": True,
            "precisa_trocar_senha": False,
        }
    )
    resp = client.post(
        "/api/usuarios/login",
        json={"email": "semperm@munaretto.com", "senha": "senhaSem1"},
    )
    token = resp.json()["token"]
    resp2 = client.get(
        "/api/comprovantes/modelo", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp2.status_code == 403


def test_importar_simulacao_nao_grava(comprovante_client, db_fake):
    """Modo simulação valida e informa o que seria importado sem gravar nada."""
    buffer = _montar_planilha([
        ["Boleto", "Energia", "00.000.000/0001-00", None, None,
         "15/08/2026", "16/08/2026", "Conta de energia", None,
         None, None, None, None, "1500,00", "0,00", None, "boleto"],
    ])
    resp = comprovante_client.post(
        "/api/comprovantes/importar",
        files={"file": ("planilha.xlsx", buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"simular": "true"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["simular"] is True
    assert data["importados"] == 1
    assert data["erros"] == []
    # Nada deve ter sido gravado no banco fake
    assert "comprovantes" not in db_fake._dados or db_fake._dados["comprovantes"] == []


def test_importar_conta_linhas_vazias_ignoradas(comprovante_client, db_fake):
    """Linhas totalmente vazias são contadas como 'ignoradas' no relatório."""
    buffer = _montar_planilha([
        ["Boleto", "Energia", "00.000.000/0001-00", None, None,
         "15/08/2026", "16/08/2026", "Conta de energia", None,
         None, None, None, None, "1500,00", "0,00", None, "boleto"],
        ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ])
    resp = comprovante_client.post(
        "/api/comprovantes/importar",
        files={"file": ("planilha.xlsx", buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["importados"] == 1
    assert data["ignoradas"] == 2
    assert data["total"] == 1


def test_listagem_paginada_interna(comprovante_client, db_fake):
    """A listagem retorna todos os registros mesmo com mais de 1000 linhas."""
    db_fake._dados["comprovantes"] = [
        {"id": i, "tipo_documento": "Boleto", "nome": None, "descricao": f"Registro {i}",
         "data_registro": f"2026-08-14T00:00:0{i % 10}.000Z"}
        for i in range(1, 2005)
    ]
    resp = comprovante_client.get("/api/comprovantes/")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 2004