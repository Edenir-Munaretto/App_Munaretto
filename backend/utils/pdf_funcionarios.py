"""Relatório PDF de funcionários (lista filtrada por status e busca).

Usa a base visual de `pdf_base.RelatorioBase` (logo, dados da empresa,
cabeçalho e rodapé) para manter o mesmo padrão dos demais relatórios do app.
"""

from utils.pdf_base import RelatorioBase, _novo_caminho_temp

ROTULOS_STATUS = {
    "ativos": "Ativos",
    "inativos": "Inativos",
    "desligados": "Desligados",
    "todos": "Todos",
}


class _RelatorioFuncionarios(RelatorioBase):
    titulo_documento = "RELATÓRIO DE FUNCIONÁRIOS"
    subtitulo_documento = "Munaretto & Co. - Gestão de Pessoal"


def _fmt_data(valor) -> str:
    """Data no padrão DD/MM/AAAA; mantém o valor original se não for ISO."""
    if not valor:
        return "-"
    texto = str(valor).strip()
    if len(texto) >= 10 and texto[4] == "-" and texto[7] == "-":
        return f"{texto[8:10]}/{texto[5:7]}/{texto[0:4]}"
    return texto


def _fmt_cpf(valor) -> str:
    """Exibe o CPF com máscara quando há 11 dígitos."""
    bruto = str(valor or "").strip()
    digitos = "".join(caractere for caractere in bruto if caractere.isdigit())
    if len(digitos) == 11:
        return f"{digitos[:3]}.{digitos[3:6]}.{digitos[6:9]}-{digitos[9:]}"
    return bruto or "-"


def _nome_cargos(funcionario: dict, cargos: dict[int, str]) -> str:
    """Concatena a função principal e a 2ª função sem repetir o mesmo cargo."""
    nomes = []
    for chave in ("cargo_id", "cargo_id_2"):
        cargo_id = funcionario.get(chave)
        if not cargo_id:
            continue
        nome = cargos.get(cargo_id)
        if nome and nome not in nomes:
            nomes.append(nome)
    return " / ".join(nomes) or "-"


def _status_funcionario(funcionario: dict) -> str:
    if funcionario.get("ativo", True):
        return "Ativo"
    if funcionario.get("desligado"):
        return "Desligado"
    return "Inativo"


def _resumo(funcionarios: list[dict]) -> tuple[int, int, int, int]:
    total = len(funcionarios)
    ativos = sum(1 for funcionario in funcionarios if funcionario.get("ativo", True))
    desligados = sum(
        1 for funcionario in funcionarios if not funcionario.get("ativo", True) and funcionario.get("desligado")
    )
    inativos = total - ativos - desligados
    return total, ativos, inativos, desligados


def gerar_pdf_funcionarios(
    funcionarios: list[dict],
    status: str = "ativos",
    busca: str | None = None,
    cargos: dict[int, str] | None = None,
) -> str:
    """Gera o PDF do relatório de funcionários e retorna o caminho temporário."""
    cargos = cargos or {}
    pdf = _RelatorioFuncionarios()
    pdf.add_page()

    total, ativos, inativos, desligados = _resumo(funcionarios)

    pdf._titulo_secao("RESUMO")
    pdf._linha_dado("Filtro aplicado", ROTULOS_STATUS.get(status, status))
    pdf._linha_dado("Busca", (busca or "").strip() or "Não informada")
    pdf._linha_dado("Total de funcionários", str(total))
    pdf._linha_dado("Ativos", str(ativos))
    pdf._linha_dado("Inativos", str(inativos))
    pdf._linha_dado("Desligados", str(desligados))

    incluir_desligamento = status in ("desligados", "todos")
    pdf._titulo_secao(f"FUNCIONÁRIOS ({total})")

    if not funcionarios:
        pdf._aviso_sem_dados("Nenhum funcionário encontrado para o filtro selecionado.")
    else:
        linhas = []
        for funcionario in funcionarios:
            linha = [
                funcionario.get("nome") or "-",
                _fmt_cpf(funcionario.get("cpf")),
                _nome_cargos(funcionario, cargos),
                _status_funcionario(funcionario),
            ]
            if incluir_desligamento:
                linha.extend(
                    [
                        _fmt_data(funcionario.get("data_desligamento")),
                        funcionario.get("motivo_desligamento") or "-",
                    ]
                )
            linhas.append(linha)

        if incluir_desligamento:
            colunas = {
                "Nome": 44,
                "CPF": 26,
                "Cargo/Função": 36,
                "Status": 20,
                "Desligamento": 24,
                "Motivo": 30,
            }
        else:
            colunas = {"Nome": 64, "CPF": 30, "Cargo/Função": 56, "Status": 30}

        pdf._tabela(colunas, linhas)

    caminho = _novo_caminho_temp("funcionarios_relatorio_")
    pdf.output(caminho)
    return caminho
