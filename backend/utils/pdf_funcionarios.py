"""Relatório PDF de funcionários (lista filtrada por status e busca).

Usa a base visual de `pdf_base.RelatorioBase` (logo, dados da empresa,
cabeçalho e rodapé) para manter o mesmo padrão dos demais relatórios do app.
"""

from utils.pdf_base import RelatorioBase, _novo_caminho_temp, _txt

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


def _desenhar_resumo_em_colunas(
    pdf: RelatorioBase,
    itens: list[tuple[str, str]],
    colunas: int = 3,
) -> None:
    """Desenha o resumo em linhas de até 3 colunas, com altura adaptável ao texto."""
    disponivel = pdf.w - pdf.l_margin - pdf.r_margin
    largura_coluna = disponivel / colunas
    x_inicio = pdf.l_margin
    altura_rotulo = 5.0
    altura_valor = 4.8
    espacamento = 2.0

    for inicio in range(0, len(itens), colunas):
        grupo = itens[inicio : inicio + colunas]
        pdf.set_font("Arial", "B", 9.5)
        valores = [
            pdf._quebrar_texto(_txt(valor if valor is not None else "-"), largura_coluna - 4) for _, valor in grupo
        ]
        altura = altura_rotulo + max(len(partes) for partes in valores) * altura_valor + 3.5

        y_topo = pdf.get_y()
        if y_topo + altura > pdf.page_break_trigger - 2:
            pdf.add_page()
            y_topo = pdf.get_y()

        largura_total = largura_coluna * len(grupo)

        # Fundo e grade do bloco de resumo.
        pdf.set_fill_color(248, 250, 252)
        pdf.set_draw_color(203, 213, 225)
        pdf.set_line_width(0.25)
        pdf.rect(x_inicio, y_topo, largura_total, altura, "DF")
        x_sep = x_inicio
        for _ in grupo[:-1]:
            x_sep += largura_coluna
            pdf.line(x_sep, y_topo, x_sep, y_topo + altura)

        for indice, (rotulo, _valor) in enumerate(grupo):
            x = x_inicio + indice * largura_coluna

            pdf.set_xy(x, y_topo + 1.5)
            pdf.set_font("Arial", "B", 7)
            pdf.set_text_color(100, 116, 139)
            pdf.cell(largura_coluna, 4, f" {_txt(rotulo.upper())}")

            pdf.set_font("Arial", "B", 9.5)
            pdf.set_text_color(15, 23, 42)
            for linha, parte in enumerate(valores[indice]):
                pdf.set_xy(x, y_topo + altura_rotulo + 1.5 + linha * altura_valor)
                pdf.cell(largura_coluna, altura_valor, f" {parte}")

        pdf.set_y(y_topo + altura + espacamento)

    pdf.set_draw_color(15, 23, 42)


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
    _desenhar_resumo_em_colunas(
        pdf,
        [
            ("Filtro aplicado", ROTULOS_STATUS.get(status, status)),
            ("Busca", (busca or "").strip() or "Não informada"),
            ("Total de funcionários", str(total)),
            ("Ativos", str(ativos)),
            ("Inativos", str(inativos)),
            ("Desligados", str(desligados)),
        ],
    )

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
