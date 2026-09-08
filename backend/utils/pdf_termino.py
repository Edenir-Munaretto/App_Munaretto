"""PDF da Carta de Término (Conclusão) de Obra.

Reproduz a estrutura do modelo em uso (ex_termino.pdf): logotipo e dados da
empresa no topo, título Celesc, campos do projeto, ficha do transformador
INSTALADO (esquerda), caixa SAIU (direita), linha do encarregado e bloco de
assinatura. Os valores são impressos COMO DIGITADOS (sem conversão numérica)
— o preenchimento vem do modal de término do PainelObra.
"""

import os

from fpdf import FPDF

from utils.pdf_base import _novo_caminho_temp

# ---------------------------------------------------------------------------
# Dados fixos da empresa (mesmos do modelo usado hoje).
# ---------------------------------------------------------------------------

RAZAO_SOCIAL = "Munaretto Eletrificações Eireli - ME"
CNPJ = "27.662.805/0001-57"
IE = "258.319.135"
ENDERECO = "Rua Magdalena Savoldi, nº 1831 - São José"
CIDADE_UF = "Concórdia/SC"
CEP = "89.713-075"

# Logo da empresa (mesmo ativo usado no modelo de O.S impresso).
CAMINHO_LOGO = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "templates",
    "artes_construcao",
    "logo.png",
)

MESES = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
]


def _latin(texto) -> str:
    """FPDF com fontes core é latin-1: troca caracteres fora por '?'."""
    return str(texto or "").encode("latin-1", "replace").decode("latin-1")


def _fmt_data_br(valor) -> str:
    """Aceita YYYY-MM-DD (input date) e devolve dd/mm/aaaa; senão mantém."""
    texto = str(valor or "").strip()
    if len(texto) >= 10 and texto[4] == "-" and texto[7] == "-":
        return f"{texto[8:10]}/{texto[5:7]}/{texto[0:4]}"
    return texto


def _data_por_extenso(valor, cidade: str) -> str:
    """Ex.: 'Concórdia, 31 de Agosto de 2026.' (cidade da assinatura)."""
    texto = str(valor or "").strip()
    if len(texto) >= 10 and texto[4] == "-" and texto[7] == "-":
        try:
            dia = int(texto[8:10])
            mes = MESES[int(texto[5:7]) - 1]
            ano = texto[0:4]
            return f"{cidade}, {dia} de {mes} de {ano}."
        except (ValueError, IndexError):
            return texto
    return texto


def _quebrar(pdf: FPDF, texto: str, largura: float) -> list[str]:
    """Divide por palavras (usa a fonte ativa de `pdf` para medir)."""
    if not texto:
        return [""]
    linhas: list[str] = []
    atual = ""
    for palavra in texto.split(" "):
        if not palavra:
            continue
        candidata = f"{atual} {palavra}" if atual else palavra
        if pdf.get_string_width(candidata) <= largura:
            atual = candidata
            continue
        if atual:
            linhas.append(atual)
            atual = ""
        while palavra and pdf.get_string_width(palavra) > largura:
            corte = max(1, len(palavra) - 1)
            while corte > 1 and pdf.get_string_width(palavra[:corte]) > largura:
                corte -= 1
            linhas.append(palavra[:corte])
            palavra = palavra[corte:]
        atual = palavra
    if atual:
        linhas.append(atual)
    return linhas or [""]


class _CartaTermino(FPDF):
    """Página A4 retrato com margens de 12 mm."""

    def __init__(self):
        super().__init__(orientation="P", unit="mm", format="A4")
        self.set_margins(12, 10, 12)
        self.set_auto_page_break(auto=True, margin=12)


def _grade(
    pdf: _CartaTermino,
    x: float,
    y: float,
    largura: float,
    campos,
    largura_rotulo: float,
    altura_linha: float = 7.0,
):
    """Grade de campos (rótulo à esquerda, valor à direita) com bordas.

    `campos` = lista de tuplas (rotulo, valor). Retorna o `y` final.
    """
    largura_valor = largura - largura_rotulo
    pdf.set_font("Arial", "", 9)
    alturas = []
    for _, valor in campos:
        partes = _quebrar(pdf, _latin(valor), largura_valor - 4)
        n = max(1, len(partes))
        alturas.append(max(altura_linha, n * 5.2 + 1.8))
    total = sum(alturas)

    pdf.set_line_width(0.2)
    pdf.set_draw_color(60, 60, 60)
    pdf.rect(x, y, largura, total, style="D")
    cy = y
    ultimo = len(campos) - 1
    for i, (rotulo, valor) in enumerate(campos):
        h = alturas[i]
        if i < ultimo:
            pdf.line(x, cy + h, x + largura, cy + h)
        pdf.line(x + largura_rotulo, cy, x + largura_rotulo, cy + h)

        pdf.set_font("Arial", "B", 8)
        pdf.set_text_color(71, 85, 105)
        pdf.set_xy(x + 1.8, cy + (h - 4.6) / 2)
        pdf.cell(largura_rotulo - 3.6, 4.6, _latin(rotulo))

        pdf.set_font("Arial", "", 9)
        pdf.set_text_color(15, 23, 42)
        partes = _quebrar(pdf, _latin(valor), largura_valor - 4)
        n = max(1, len(partes))
        py = cy + (h - n * 5.2) / 2
        for parte in partes:
            pdf.set_xy(x + largura_rotulo + 1.8, py)
            pdf.cell(largura_valor - 3.6, 5.2, parte)
            py += 5.2
        cy += h
    return y + total


def gerar_pdf_termino(obra: dict, termo: dict) -> str:
    """Monta a Carta de Término e retorna o caminho temporário do arquivo.

    `termo` é o JSON salvo na obra (campos de texto opcionais).
    """
    instalado = termo.get("instalado") or {}
    saiu = termo.get("saiu") or {}
    cidade = (termo.get("cidade_emissao") or "").strip() or (obra.get("cidade") or "").strip() or "Concórdia"

    pdf = _CartaTermino()
    pdf.add_page()

    # --- Cabeçalho: logo pequena + logotipo em texto + dados da empresa.
    pdf.set_text_color(15, 23, 42)
    # Altura fixa para a logo; largura proporcional ao PNG (159x105 px).
    altura_logo = 14.0
    proporcao_logo = 159.0 / 105.0
    largura_logo = round(altura_logo * proporcao_logo, 1)
    try:
        import pymupdf

        pix = pymupdf.Pixmap(CAMINHO_LOGO)
        if pix.width > 0 and pix.height > 0:
            proporcao_logo = pix.width / pix.height
            largura_logo = round(altura_logo * proporcao_logo, 1)
    except Exception:
        pass  # sem imagem disponível: segue apenas com o texto do logotipo

    if os.path.exists(CAMINHO_LOGO):
        pdf.image(CAMINHO_LOGO, x=12, y=8.5, w=largura_logo, h=altura_logo)
        texto_x = 12 + largura_logo + 4
        pdf.set_font("Arial", "B", 16)
        pdf.set_xy(texto_x, 10.5)
        pdf.cell(80, 7, "MUNARETTO")
        pdf.set_font("Arial", "B", 12.5)
        pdf.set_xy(texto_x, 19)
        pdf.cell(80, 6, "ELETRIFICAÇÕES")
    else:
        pdf.set_font("Arial", "B", 20)
        pdf.set_xy(12, 10)
        pdf.cell(100, 8, "MUNARETTO")
        pdf.set_xy(12, 18.5)
        pdf.set_font("Arial", "B", 15)
        pdf.cell(100, 7, "ELETRIFICAÇÕES")

    pdf.set_font("Arial", "B", 8)
    pdf.set_xy(108, 8)
    pdf.cell(90, 4.4, RAZAO_SOCIAL, align="R")
    pdf.set_font("Arial", "", 8)
    pdf.set_text_color(60, 60, 60)
    pdf.set_xy(108, 12.4)
    pdf.cell(90, 4.4, f"CNPJ: {CNPJ}   |   IE: {IE}", align="R")
    pdf.set_xy(108, 16.8)
    pdf.cell(90, 4.4, ENDERECO, align="R")
    pdf.set_xy(108, 21.2)
    pdf.cell(90, 4.4, f"{CIDADE_UF}  -  CEP: {CEP}", align="R")
    pdf.set_text_color(15, 23, 42)
    pdf.set_line_width(0.35)
    pdf.set_draw_color(15, 23, 42)
    pdf.line(12, 27.5, 198, 27.5)

    # --- Título do documento.
    pdf.set_xy(12, 31)
    pdf.set_font("Arial", "B", 13)
    pdf.cell(186, 7, "CELESC DISTRIBUIÇÃO S.A", align="C")
    pdf.set_xy(12, 38.2)
    pdf.set_font("Arial", "B", 11.5)
    pdf.cell(186, 6, "Carta de conclusão de obra.", align="C")

    # --- Campos do projeto.
    y = 48
    y = _grade(
        pdf,
        12,
        y,
        186,
        [
            ("Número do projeto", termo.get("numero_projeto")),
            ("Consumidor", termo.get("consumidor")),
            ("Local da Rede", termo.get("local_rede")),
            ("Data de conclusão", _fmt_data_br(termo.get("data_conclusao"))),
        ],
        largura_rotulo=42,
        altura_linha=8,
    )

    # --- Transformadores: ficha INSTALADO (esquerda) + SAIU (direita).
    y += 6
    # As duas fichas têm a MESMA largura (90 mm cada, com 6 mm de espaço
    # entre elas): rótulo (44 mm) e valor idênticos lado a lado, sem texto
    # espremido na coluna da direita.
    largura_ficha = 90
    x_saiu = 12 + largura_ficha + 6
    pdf.set_xy(12, y)
    pdf.set_font("Arial", "B", 10.5)
    pdf.cell(largura_ficha, 6, "TRANSFORMADORES INSTALADOS")
    pdf.set_xy(x_saiu, y)
    pdf.cell(largura_ficha, 6, "SAIU")
    y += 6.5
    campos_instalado = [
        ("Marca", instalado.get("marca")),
        ("Nº Trafo", instalado.get("numero")),
        ("Potência", instalado.get("potencia")),
        ("Ano", instalado.get("ano")),
        ("Imp.", instalado.get("impedancia")),
        ("Massa", instalado.get("massa")),
        ("Volume", instalado.get("volume")),
        ("1° TAP", instalado.get("tap_1")),
        ("TAP", instalado.get("tap")),
        ("Nº TAP's", instalado.get("n_taps")),
        ("Placa", instalado.get("placa")),
    ]
    # Coluna da direita com os MESMOS campos do instalado (formulário e ficha
    # equivalentes): largura de rótulo/altura de linha iguais mantêm as duas
    # fichas com a mesma altura e visual.
    campos_saiu = [
        ("Marca", saiu.get("marca")),
        ("Nº Trafo", saiu.get("numero")),
        ("Potência", saiu.get("potencia")),
        ("Ano", saiu.get("ano")),
        ("Imp.", saiu.get("impedancia")),
        ("Massa", saiu.get("massa")),
        ("Volume", saiu.get("volume")),
        ("1° TAP", saiu.get("tap_1")),
        ("TAP", saiu.get("tap")),
        ("Nº TAP's", saiu.get("n_taps")),
        ("Placa", saiu.get("placa")),
    ]
    y_instalado = _grade(pdf, 12, y, largura_ficha, campos_instalado, largura_rotulo=44, altura_linha=7.2)
    y_saiu = _grade(pdf, x_saiu, y, largura_ficha, campos_saiu, largura_rotulo=44, altura_linha=7.2)
    y = max(y_instalado, y_saiu)

    # --- Encarregado.
    y += 7
    pdf.set_xy(12, y)
    pdf.set_font("Arial", "B", 9)
    pdf.set_text_color(71, 85, 105)
    pdf.cell(46, 6, "Encarregado.")
    pdf.set_font("Arial", "", 10)
    pdf.set_text_color(15, 23, 42)
    pdf.cell(140, 6, _latin(termo.get("encarregado")))
    pdf.line(58, y + 7.5, 198, y + 7.5)

    # --- Assinatura.
    y += 16
    pdf.set_font("Arial", "B", 11)
    pdf.set_xy(12, y)
    pdf.cell(186, 6, _data_por_extenso(termo.get("data_emissao"), cidade), align="C")
    y += 22
    pdf.set_xy(12, y)
    pdf.cell(186, 6, RAZAO_SOCIAL, align="C")

    caminho = _novo_caminho_temp("termino_obra_")
    pdf.output(caminho)
    return caminho
