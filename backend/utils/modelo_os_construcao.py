"""Renderização direta do modelo de O.S "Construção" em PDF (pymupdf).

Replica a geometria exata do modelo oficial (Downloads/construção.pdf /
manuais/MODELO O.S/MODELO CONSTRUÇÃO.pdf), medida via extração das posições
de textos, caixas e imagens:

  - Página 1: logo, título, grade de campos com caixas cinza, checkboxes
    BT/AT/Bloqueio, horários, alimentador/chave, observações e arte inferior.
  - Página 2: faixa de título com data, O.S. Nr., arte central, tabela de
    membros (Nome/Cargo/Assinatura) com cabeçalho cinza, linhas alternadas
    branca/#FFFEE8 e linhas de assinatura.

Fonte: Trebuchet MS (regular/negrito) com fallback para Liberation/DejaVu
Sans em ambientes sem a fonte (Linux/Docker).
"""

import logging
import os
import tempfile

import pymupdf

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constantes de layout (medidas em pontos, A4 = 595.2756 x 841.8898)
# ---------------------------------------------------------------------------

PAGINA = (595.2756, 841.8898)
COR_TEXTO = (0.188, 0.188, 0.188)  # #303030
COR_LINHA_TOP = (0.0, 0.0, 0.0)
COR_CAIXA = (0.753, 0.753, 0.753)
COR_LINHA_SUAVE = (0.8, 0.8, 0.8)
COR_CHECK = (0.58, 0.58, 0.58)
COR_ASSINATURA = (0.188, 0.188, 0.188)
FILL_CABECALHO = (0.933, 0.933, 0.933)  # #EEEEEE
FILL_CRIACAO = (1.0, 1.0, 0.91)  # #FFFEE8
FILL_BRANCO = (1.0, 1.0, 1.0)

HELV_ASCENDER = 1.075

TREBUC_REG = None
TREBUC_BOLD = None

# ---------------------------------------------------------------------------
# Fontes
# ---------------------------------------------------------------------------

_CANDIDATAS_REG = [
    r"C:\Windows\Fonts\trebuc.ttf",
    "/usr/share/fonts/truetype/msttcorefonts/Trebuchet_MS.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
_CANDIDATAS_BOLD = [
    r"C:\Windows\Fonts\trebucbd.ttf",
    "/usr/share/fonts/truetype/msttcorefonts/Trebuchet_MS_Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def _achar_fonte(candidatas):
    for p in candidatas:
        if os.path.exists(p):
            return p
    return None


def _fonts():
    global TREBUC_REG, TREBUC_BOLD
    if TREBUC_REG is None:
        TREBUC_REG = _achar_fonte(_CANDIDATAS_REG)
        TREBUC_BOLD = _achar_fonte(_CANDIDATAS_BOLD)
        if not TREBUC_REG or not TREBUC_BOLD:
            raise RuntimeError("Nenhuma fonte Trebuchet/Liberation/DejaVu encontrada no sistema.")
    return TREBUC_REG, TREBUC_BOLD


def _registrar_fontes(pag):
    reg, bold = _fonts()
    pag.insert_font(fontname="trebreg", fontfile=reg)
    pag.insert_font(fontname="trebbold", fontfile=bold)


def _font_medida(bold=False):
    caminho = _fonts()[1 if bold else 0]
    return pymupdf.Font(fontname="trebbold" if bold else "trebreg", fontfile=caminho)


def _texto(pag, x, y0, texto, tamanho, bold=False):
    """Insere texto na coordenada (x, y0) — y0 é o TOPO da caixa do texto."""
    if not texto:
        return 0
    f = _font_medida(bold)
    baseline = y0 + f.ascender * tamanho
    pag.insert_text(
        (x, baseline),
        texto,
        fontsize=tamanho,
        fontname="trebbold" if bold else "trebreg",
        color=COR_TEXTO,
    )
    return f.text_length(texto, fontsize=tamanho)


def _texto_central(pag, cx, y0, texto, tamanho, bold=True):
    f = _font_medida(bold)
    largura = f.text_length(texto, fontsize=tamanho)
    _texto(pag, cx - largura / 2, y0, texto, tamanho, bold=bold)
    return largura


def _texto_dir(pag, x_fim, y0, texto, tamanho, bold=True):
    f = _font_medida(bold)
    largura = f.text_length(texto, fontsize=tamanho)
    _texto(pag, x_fim - largura, y0, texto, tamanho, bold=bold)
    return largura


# ---------------------------------------------------------------------------
# Desenho
# ---------------------------------------------------------------------------


def _linha(pag, p1, p2, cor=COR_CAIXA, largura=0.3):
    pag.draw_line(p1, p2, color=cor, width=largura)


def _caixa(pag, rect, cor=COR_CAIXA, largura=0.3):
    pag.draw_rect(pymupdf.Rect(*rect), color=cor, width=largura)


def _check(pag, rect, marcado):
    r = pymupdf.Rect(*rect)
    pag.draw_rect(r, color=COR_CHECK, width=1.4, fill=FILL_BRANCO)
    if marcado:
        _texto(pag, rect[0] + 1.5, rect[1] + 0.6, "X", 9, bold=True)


def _texto_box(pag, rect, texto, tamanho=9):
    if not texto:
        return
    reg, _ = _fonts()
    r = pymupdf.Rect(*rect)
    pag.insert_textbox(r, texto, fontsize=tamanho, fontname="trebreg", fontfile=reg, color=COR_TEXTO)


# ---------------------------------------------------------------------------
# Página 1
# ---------------------------------------------------------------------------

_CAIXAS_P1 = [
    (62.4, 60.7, 161.0, 81.0),  # Ord.Serv.
    (238.6, 60.7, 303.6, 77.6),  # Equipe
    (400.6, 60.7, 482.1, 77.6),  # ID Obra
    (540.1, 60.7, 572.0, 77.6),  # Agência / CDA
    (62.4, 86.2, 129.6, 103.2),  # Data
    (238.6, 86.3, 456.6, 103.2),  # Encarregado
    (62.4, 109.3, 349.4, 126.3),  # Obra
    (417.1, 109.3, 572.0, 126.3),  # Atividade
    (62.4, 130.3, 347.9, 147.3),  # Local
    (417.1, 130.3, 572.0, 147.3),  # Município
    (102.1, 152.6, 572.0, 199.5),  # Serviço a Executar
    (214.2, 203.8, 260.5, 220.7),  # H.Desligar
    (214.2, 223.8, 260.5, 240.8),  # H.Religar
    (327.1, 204.3, 572.1, 221.3),  # Alimentador
    (327.1, 223.8, 572.1, 240.8),  # Chave
    (65.3, 247.8, 572.0, 290.0),  # Obs.
]

_LABELS_P1 = [
    (22.1, 63.8, "Ord.Serv."),
    (205.4, 63.8, "Equipe"),
    (363.9, 63.8, "ID Obra"),
    (505.8, 63.8, "Agência"),
    (36.4, 89.5, "Data"),
    (182.9, 89.5, "Encarregado"),
    (35.7, 112.5, "Obra"),
    (370.9, 112.5, "Atividade"),
    (33.8, 133.5, "Local"),
    (370.9, 133.5, "Município"),
    (17.8, 171.1, "Serviço a Executar"),
    (17.8, 207.0, "BT Energ."),
    (17.8, 227.0, "AT Energ."),
    (94.0, 227.0, "Bloqueio"),
    (168.2, 207.6, "H.Desligar"),
    (172.4, 227.0, "H.Religar"),
    (271.8, 207.6, "Alimentador"),
    (296.8, 227.0, "Chave"),
    (17.0, 260.2, "Obs."),
]


def _pagina_1(pdf, ctx):
    pag = pdf.new_page(width=PAGINA[0], height=PAGINA[1])
    _registrar_fontes(pag)
    artes = ctx["artes"]

    # logo + título
    pag.insert_image(pymupdf.Rect(14.2, 14.2, 112.7, 43.4), filename=artes["logo"], keep_proportion=False)
    _texto_central(pag, 297.3, 17.8, "Ordem de Serviço", 18, bold=True)

    # linha superior
    _linha(pag, (14.2, 54.4), (581.1, 54.4), COR_LINHA_TOP, 0.3)

    # caixas da grade
    for r in _CAIXAS_P1:
        _caixa(pag, r)

    # rótulos
    for x, y0, t in _LABELS_P1:
        _texto(pag, x, y0, t, 9)

    # valores
    _texto(pag, 65.1, 63.9, ctx["codigo"], 12, bold=True)
    _texto(pag, 241.2, 63.8, ctx["equipe"], 9)
    _texto(pag, 431.9, 63.8, ctx["id_obra"], 9)
    _texto(pag, 542.0, 63.8, ctx["agencia"], 9)
    _texto(pag, 65.1, 89.5, ctx["data_placeholder"], 9)
    _texto(pag, 241.2, 89.5, ctx["encarregado"], 9)
    _texto(pag, 66.0, 112.5, ctx["obra"], 9)
    _texto(pag, 419.9, 112.5, ctx["atividade"], 9)
    _texto(pag, 66.0, 133.5, ctx["local"], 9)
    _texto(pag, 419.9, 133.5, ctx["municipio"], 9)
    _texto_box(pag, (104.0, 156.0, 568.0, 198.0), ctx["servico"])
    _texto(pag, 226.3, 207.0, ctx["h_desligar"], 9)
    _texto(pag, 226.3, 227.0, ctx["h_religar"], 9)
    _texto(pag, 328.0, 207.0, ctx["alimentador"], 9)
    _texto(pag, 328.0, 227.0, ctx["chave"], 9)
    _texto_box(pag, (67.0, 252.0, 568.0, 288.0), ctx["obs"])

    # checkboxes
    _check(pag, (69.2, 207.3, 79.0, 217.1), ctx["bt"])
    _check(pag, (69.2, 227.4, 79.0, 237.2), ctx["at"])
    _check(pag, (145.3, 227.4, 155.1, 237.2), ctx["bloqueio"])

    # arte inferior
    pag.insert_image(pymupdf.Rect(24.7, 293.9, 570.6, 792.2), filename=artes["arte_p1"], keep_proportion=False)


# ---------------------------------------------------------------------------
# Página 2
# ---------------------------------------------------------------------------

_COLS_P2 = (33.6, 222.0, 386.4, 586.8)


def _bordas_brancas(pag, x0, y0, x1, y1):
    """Bordas brancas finas ao redor da célula (linhas de separação do modelo)."""
    cor = (1.0, 1.0, 1.0)
    _linha(pag, (x0, y0), (x1, y0), cor, 0.3)
    _linha(pag, (x0, y1), (x1, y1), cor, 0.3)
    _linha(pag, (x0, y0), (x0, y1), cor, 0.3)
    _linha(pag, (x1, y0), (x1, y1), cor, 0.3)


def _pagina_2(pdf, ctx):
    pag = pdf.new_page(width=PAGINA[0], height=PAGINA[1])
    _registrar_fontes(pag)
    artes = ctx["artes"]

    # faixa do título
    pag.insert_image(pymupdf.Rect(76.0, 14.2, 118.1, 41.9), filename=artes["logo"], keep_proportion=False)
    _texto_central(pag, 331.6, 21.7, "AVALIAÇÃO PRÉVIA DE ESTUDO E PLANEJAMENTO DAS ATIVIDADES", 11)
    _texto_dir(pag, 575.2, 23.6, ctx["data_placeholder"], 10)
    _linha(pag, (28.3, 41.8), (581.1, 41.8), COR_LINHA_TOP, 0.3)

    # arte central (inclui a área da tabela)
    pag.insert_image(pymupdf.Rect(47.4, 45.4, 561.5, 619.4), filename=artes["arte_p2"], keep_proportion=False)

    # O.S. Nr. + Membros da Equipe (mesma linha)
    _texto(pag, 183.6, 622.6, "O.S. Nr. :", 9, bold=True)
    _texto(pag, 241.3, 622.6, ctx["codigo"], 9, bold=True)
    _texto(pag, 36.4, 622.9, "Membros da Equipe", 11, bold=True)

    cols = _COLS_P2
    # linhas de contorno da tabela (acima do cabeçalho e entre cabeçalho/linhas)
    _linha(pag, (33.6, 619.6), (586.3, 619.6), COR_LINHA_SUAVE, 0.3)
    _linha(pag, (33.6, 655.3), (586.3, 655.3), COR_LINHA_SUAVE, 0.3)

    # cabeçalho
    y_cab = 638.2
    altura_cab = 17.2
    for i in range(3):
        x0, x1 = cols[i], cols[i + 1]
        pag.draw_rect(
            pymupdf.Rect(x0, y_cab, x1, y_cab + altura_cab),
            color=None,
            fill=FILL_CABECALHO,
        )
        _bordas_brancas(pag, x0, y_cab, x1, y_cab + altura_cab)
    _texto(pag, cols[0] + 2.8, 642.2, "Nome", 8)
    _texto(pag, cols[1] + 2.8, 642.2, "Cargo", 8)
    _texto(pag, cols[2] + 2.8, 642.2, "Assinatura", 8)

    # linhas de membros
    y = 655.4
    for i, m in enumerate(ctx["membros"]):
        altura = 19.4 if i % 2 == 0 else 19.5
        fill = FILL_CRIACAO if i % 2 == 1 else FILL_BRANCO
        for j in range(3):
            x0, x1 = cols[j], cols[j + 1]
            if fill == FILL_CRIACAO:
                pag.draw_rect(
                    pymupdf.Rect(x0, y, x1, y + altura),
                    color=None,
                    fill=fill,
                )
            _bordas_brancas(pag, x0, y, x1, y + altura)
        _texto(pag, cols[0] + 2.8, y + 5.1, m.get("nome") or "", 8)
        _texto(pag, cols[1] + 2.8, y + 5.1, m.get("cargo") or "", 8)
        # linha de assinatura (traço escuro fino)
        pag.draw_rect(
            pymupdf.Rect(389.2, y + 14.6, 545.2, y + 15.0),
            color=None,
            fill=COR_ASSINATURA,
        )
        y += altura

    # linhas inferiores da página (como no original)
    _linha(pag, (28.3, 821.9), (581.1, 821.9), COR_LINHA_SUAVE, 0.3)
    _linha(pag, (28.3, 827.6), (581.1, 827.6), COR_LINHA_SUAVE, 0.3)


# ---------------------------------------------------------------------------
# API pública
# ---------------------------------------------------------------------------


def gerar_pdf_construcao(
    codigo: str,
    data: str,
    equipe: str,
    id_obra: str,
    agencia: str,
    encarregado: str,
    obra: str,
    atividade: str,
    local: str,
    municipio: str,
    servico: str,
    obs: str,
    h_desligar: str,
    h_religar: str,
    alimentador: str,
    chave: str,
    bt: bool = False,
    at: bool = False,
    bloqueio: bool = False,
    membros: list | None = None,
) -> str:
    """Gera o PDF do modelo Construção e retorna o caminho temporário."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    artes_dir = os.path.join(base_dir, "templates", "artes_construcao")
    artes = {nome: os.path.join(artes_dir, f"{nome}.png") for nome in ("logo", "arte_p1", "arte_p2")}
    for caminho in artes.values():
        if not os.path.exists(caminho):
            raise RuntimeError(f"Arte do modelo Construção não encontrada: {caminho}")

    ctx = {
        "artes": artes,
        "codigo": codigo or "",
        "data": data or "",
        "data_placeholder": data or "__/__/____",
        "equipe": equipe or "",
        "id_obra": id_obra or "",
        "agencia": agencia or "",
        "encarregado": encarregado or "",
        "obra": obra or "",
        "atividade": atividade or "",
        "local": local or "",
        "municipio": municipio or "",
        "servico": servico or "",
        "obs": obs or "",
        "h_desligar": h_desligar or "__:__",
        "h_religar": h_religar or "__:__",
        "alimentador": alimentador or "",
        "chave": chave or "",
        "bt": bt,
        "at": at,
        "bloqueio": bloqueio,
        "membros": membros or [],
    }

    pdf = pymupdf.open()
    _pagina_1(pdf, ctx)
    _pagina_2(pdf, ctx)

    caminho = os.path.join(tempfile.gettempdir(), f"OS_CONSTRUCAO_{codigo or 'os'}.pdf")
    pdf.save(caminho)
    pdf.close()
    logger.info("Modelo Construção gerado em %s", caminho)
    return caminho
