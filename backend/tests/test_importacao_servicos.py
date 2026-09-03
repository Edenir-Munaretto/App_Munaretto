"""Testes da importação em lote de serviços do módulo Controle de O.S (.xlsx).

Cobre: download do modelo, criação em lote com contrato fixo, atualização de
serviços existentes pelo código normal, relatório de erros por linha,
simulação sem gravação e validações de arquivo.
"""

import io

import pytest
from openpyxl import Workbook

CABECALHOS = [
    "Serviço (descrição)",
    "Código Normal",
    "Código Especial",
    "Unidade",
    "Qtd USC",
    "Qtd USC Especial",
]


def _montar_planilha(linhas, cabecalhos=None):
    """Monta uma planilha .xlsx com o cabeçalho do modelo e as linhas dadas."""
    cabecalhos = cabecalhos or CABECALHOS
    wb = Workbook()
    ws = wb.active
    for r, linha in enumerate([cabecalhos, *linhas], start=1):
        for c, valor in enumerate(linha, start=1):
            ws.cell(row=r, column=c, value=valor)
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return buffer


def _importar(client, buffer, tipo="construcao", simular=False, nome="planilha.xlsx"):
    return client.post(
        "/api/os/produtos/importar",
        files={"file": (nome, buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"tipo": tipo, "simular": "true" if simular else "false"},
    )


def test_download_modelo_servicos(os_gestor_client):
    resp = os_gestor_client.get("/api/os/produtos/modelo")
    assert resp.status_code == 200
    assert resp.content[:2] == b"PK"  # assinatura ZIP/xlsx
    assert "modelo_servicos.xlsx" in resp.headers.get("content-disposition", "")


def test_importar_cria_servicos_com_contrato_fixo(os_gestor_client, db_fake):
    buffer = _montar_planilha(
        [
            ["Corte de árvore", "CRA-01", "CRA-ESP", "UN", "0,48", "0,67"],
            ["Roçada de capoeira", "ROC-01", "", "m²", 6.66, None],
        ]
    )
    resp = _importar(os_gestor_client, buffer, tipo="manutencao")
    assert resp.status_code == 200, resp.text
    dados = resp.json()
    assert dados["criados"] == 2
    assert dados["atualizados"] == 0
    assert dados["importados"] == 2
    assert dados["erros"] == []

    gravados = {p["codigo"]: p for p in db_fake._dados["produtos"]}
    assert set(gravados) == {"CRA-01", "ROC-01"}
    assert gravados["CRA-01"]["nome"] == "Corte de árvore"
    assert gravados["CRA-01"]["codigo_especial"] == "CRA-ESP"
    assert gravados["CRA-01"]["preco_unitario"] == 0.48  # vírgula pt-BR
    assert gravados["CRA-01"]["qtd_usc_especial"] == 0.67
    assert gravados["CRA-01"]["tipo"] == "manutencao"
    assert gravados["CRA-01"]["ativo"] is True
    # Célula numérica e campo vazio.
    assert gravados["ROC-01"]["preco_unitario"] == 6.66
    assert gravados["ROC-01"]["qtd_usc_especial"] == 0.0
    assert gravados["ROC-01"]["unidade"] == "m²"
    assert gravados["ROC-01"]["codigo_especial"] is None


def test_importar_atualiza_existente_pelo_codigo_normal(os_gestor_client, db_fake):
    db_fake._dados["produtos"].append(
        {
            "id": 1,
            "codigo": "CRA-01",
            "codigo_especial": None,
            "nome": "Nome antigo",
            "unidade": "UN",
            "preco_unitario": 0.0,
            "qtd_usc_especial": 0.0,
            "tipo": "manutencao",
            "ativo": True,
        }
    )
    buffer = _montar_planilha(
        [
            ["Corte de árvore (novo nome)", "CRA-01", "CRA-ESP", "UN", "0,48", "0,67"],
            ["Serviço totalmente novo", "NOVO-01", "", "UN", "1", ""],
        ]
    )
    resp = _importar(os_gestor_client, buffer, tipo="manutencao")
    assert resp.status_code == 200, resp.text
    dados = resp.json()
    assert dados["atualizados"] == 1
    assert dados["criados"] == 1
    assert dados["importados"] == 2

    registros = {p["id"]: p for p in db_fake._dados["produtos"]}
    assert len(registros) == 2
    assert registros[1]["nome"] == "Corte de árvore (novo nome)"
    assert registros[1]["codigo_especial"] == "CRA-ESP"
    assert registros[1]["preco_unitario"] == 0.48
    assert registros[1]["tipo"] == "manutencao"


def test_importar_reativa_servico_inativo_pelo_codigo(os_gestor_client, db_fake):
    db_fake._dados["produtos"].append(
        {
            "id": 1,
            "codigo": "ANT-01",
            "nome": "Serviço inativo",
            "unidade": "UN",
            "preco_unitario": 1.0,
            "qtd_usc_especial": 0.0,
            "tipo": "construcao",
            "ativo": False,
        }
    )
    buffer = _montar_planilha([["Serviço inativo (reativado)", "ANT-01", "", "UN", "2", ""]])
    resp = _importar(os_gestor_client, buffer)
    assert resp.status_code == 200, resp.text
    assert resp.json()["atualizados"] == 1
    reg = db_fake._dados["produtos"][0]
    assert reg["ativo"] is True
    assert reg["nome"] == "Serviço inativo (reativado)"


def test_importar_reporta_erros_por_linha(os_gestor_client, db_fake):
    db_fake._dados["produtos"].append(
        {
            "id": 1,
            "codigo": "JA-EXISTE",
            "nome": "Serviço existente",
            "unidade": "UN",
            "preco_unitario": 1.0,
            "qtd_usc_especial": 0.0,
            "tipo": "construcao",
            "ativo": True,
        }
    )
    buffer = _montar_planilha(
        [
            ["", "SEM-NOME", "", "UN", "1", ""],                          # linha 2: nome ausente
            ["Duplicado no arquivo", "DUP-01", "", "UN", "1", ""],        # linha 3
            ["Duplicado de novo", "DUP-01", "", "UN", "1", ""],           # linha 4: duplicado no arquivo
            ["Especial colide", "OK-01", "JA-EXISTE", "UN", "1", ""],     # linha 5: colisão com outro serviço
            ["USC inválida", "NV-01", "", "UN", "abc", ""],               # linha 6
            ["USC negativa", "NV-02", "", "UN", "-1", ""],                # linha 7
            ["Serviço válido", "VLD-01", "", "UN", "1", ""],              # linha 8
        ]
    )
    resp = _importar(os_gestor_client, buffer)
    assert resp.status_code == 200, resp.text
    dados = resp.json()
    assert dados["criados"] == 2  # linhas 3 (DUP-01) e 8 (VLD-01)
    assert dados["importados"] == 2
    erros = {e["linha"]: e["mensagem"] for e in dados["erros"]}
    assert set(erros) == {2, 4, 5, 6, 7}
    assert "nome do serviço" in erros[2]
    assert "DUP-01" in erros[4] and "linha 3" in erros[4]
    assert "JA-EXISTE" in erros[5]
    assert "Qtd USC" in erros[6]
    assert "Qtd USC" in erros[7]
    codigos = {p["codigo"] for p in db_fake._dados["produtos"]}
    assert "VLD-01" in codigos
    assert "DUP-01" in codigos
    assert "OK-01" not in codigos


def test_importar_simulacao_nao_grava(os_gestor_client, db_fake):
    buffer = _montar_planilha([["Serviço simulado", "SIM-01", "SIM-ESP", "UN", "0,5", "0,8"]])
    resp = _importar(os_gestor_client, buffer, simular=True)
    assert resp.status_code == 200, resp.text
    dados = resp.json()
    assert dados["simular"] is True
    assert dados["criados"] == 1
    assert dados["erros"] == []
    assert db_fake._dados["produtos"] == []  # nada gravado


def test_importar_conta_linhas_vazias(os_gestor_client, db_fake):
    buffer = _montar_planilha(
        [
            ["Serviço um", "UM-01", "", "UN", "1", ""],
            [None, None, None, None, None, None],
            ["Serviço dois", "DOIS-01", "", "UN", "2", ""],
        ]
    )
    resp = _importar(os_gestor_client, buffer)
    assert resp.status_code == 200, resp.text
    dados = resp.json()
    assert dados["criados"] == 2
    assert dados["total"] == 2
    assert dados["ignoradas"] == 1


def test_importar_contrato_invalido(os_gestor_client, db_fake):
    buffer = _montar_planilha([["Serviço qualquer", "Q-01", "", "UN", "1", ""]])
    resp = _importar(os_gestor_client, buffer, tipo="outro")
    assert resp.status_code == 422
    assert "Contrato inválido" in resp.json()["detail"]
    assert db_fake._dados["produtos"] == []


def test_importar_rejeita_arquivo_invalido(os_gestor_client):
    # Extensão não-xlsx.
    resp = os_gestor_client.post(
        "/api/os/produtos/importar",
        files={"file": ("lista.txt", io.BytesIO(b"conteudo"), "text/plain")},
        data={"tipo": "construcao"},
    )
    assert resp.status_code == 400
    assert "xlsx" in resp.json()["detail"]

    # .xlsx sem cabeçalho reconhecível.
    buffer = _montar_planilha([["Somente um item"]], cabecalhos=["Coluna desconhecida"])
    resp = _importar(os_gestor_client, buffer)
    assert resp.status_code == 400
    assert "Nenhuma coluna reconhecida" in resp.json()["detail"]


def test_importar_orienta_quando_schema_nao_aplicado(os_gestor_client, db_fake, monkeypatch):
    """Banco sem a coluna codigo_especial (PostgREST 42703): resposta 400 com a
    orientação do ALTER TABLE — e não um 500 genérico."""

    class ErroColunaFaltando(Exception):
        def __init__(self):
            super().__init__("column produtos.codigo_especial does not exist")
            self.message = "column produtos.codigo_especial does not exist"

    tabela_original = db_fake.table

    class _SelectQuebrado:
        def __init__(self, consulta):
            self._consulta = consulta

        def select(self, *args, **kwargs):
            if any("codigo_especial" in str(arg) for arg in args):
                raise ErroColunaFaltando()
            return self._consulta.select(*args, **kwargs)

        def __getattr__(self, nome):
            return getattr(self._consulta, nome)

    def table_quebrada(nome):
        return _SelectQuebrado(tabela_original(nome))

    monkeypatch.setattr(db_fake, "table", table_quebrada)

    buffer = _montar_planilha([["Serviço teste", "T-01", "", "UN", "1", ""]])
    resp = _importar(os_gestor_client, buffer)
    assert resp.status_code == 400
    detalhe = resp.json()["detail"]
    assert "codigo_especial" in detalhe
    assert "ALTER TABLE produtos ADD COLUMN IF NOT EXISTS codigo_especial" in detalhe


def test_importar_restrito_ao_gestor(os_campo_client):
    buffer = _montar_planilha([["Serviço do campo", "CAMPO-01", "", "UN", "1", ""]])
    resp = _importar(os_campo_client, buffer)
    assert resp.status_code == 403
