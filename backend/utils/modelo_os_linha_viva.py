"""Renderização direta do modelo de O.S "Linha Viva" em PDF (pymupdf).

Replica a geometria exata do modelo oficial (lv.pdf / MODELO LINHA VIVA.pdf),
medida via extração das posições de textos, caixas e imagens:

  - Página 1: logo, título, grade de campos com caixas cinza, checkboxes
    BT/AT/Bloqueio, horários, alimentador/chave, observações e arte inferior.
  - Página 2: faixa de título com data, O.S. Nr., arte central, tabela de
    membros (Nome/Cargo/Assinatura) com cabeçalho cinza e linhas alternadas
    branca/#FFFEE8, linha de validação e faixa final.

Fonte: Trebuchet MS (regular/negrito) com fallback para Liberation/DejaVu
Sans em ambientes sem a fonte (Linux/Docker). A fonte Helvetica (base-14)
é usada para sublinhados e texto de validação, como no original.
"""

import logging
import os
import tempfile

import pymupdf

logger = logging.getLogger(__name__)


def _novo_caminho_temp(prefixo: str, sufixo: str = ".pdf") -> str:
    """Caminho temporário ÚNICO (evita colisão entre requisições concorrentes
    que antes gravavam `OS_LINHA_VIVA_<codigo>.pdf` fixo no mesmo arquivo)."""
    fd, caminho = tempfile.mkstemp(prefix=prefixo, suffix=sufixo)
    os.close(fd)
    return caminho

# ---------------------------------------------------------------------------
# Constantes de layout (medidas em pontos, A4 = 595.2756 x 841.8898)
# ---------------------------------------------------------------------------

PAGINA = (595.2756, 841.8898)
COR_TEXTO = (0.188, 0.188, 0.188)  # #303030
COR_LINHA_TOP = (0.0, 0.0, 0.0)
COR_CAIXA = (0.753, 0.753, 0.753)
COR_LINHA_SUAVE = (0.8, 0.8, 0.8)
COR_CHECK = (0.58, 0.58, 0.58)
FILL_CABECALHO = (0.933, 0.933, 0.933)  # #EEEEEE
FILL_CRIACAO = (1.0, 1.0, 0.91)  # #FFFEE8
FILL_BRANCO = (1.0, 1.0, 1.0)

# Ascender da Helvetica base-14 (usado para baselines de sublinhados/validação)
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


def _fonte(bold):
    caminho = _achar_fonte(_CANDIDATAS_BOLD if bold else _CANDIDATAS_REG)
    if not caminho:
        raise RuntimeError("Nenhuma fonte Trebuchet/Liberation/DejaVu encontrada no sistema.")
    return caminho


def _fonts():
    global TREBUC_REG, TREBUC_BOLD
    if TREBUC_REG is None:
        TREBUC_REG = _fonte(False)
        TREBUC_BOLD = _fonte(True)
    return TREBUC_REG, TREBUC_BOLD


def _registrar_fontes(pag):
    """Registra as fontes TTF na página (obrigatório para insert_text)."""
    reg, bold = _fonts()
    for nome, caminho in (("trebreg", reg), ("trebbold", bold)):
        pag.insert_font(fontname=nome, fontfile=caminho)


def _font_medida(bold=False):
    """Objeto fitz.Font para medir textos (mesmo arquivo da fonte usada)."""
    caminho = _fonts()[1 if bold else 0]
    return pymupdf.Font(fontname="trebbold" if bold else "trebreg", fontfile=caminho)


def _texto(pag, x, y0, texto, tamanho, bold=False):
    """Insere texto na coordenada (x, y0) — y0 é o TOPO da caixa do texto
    (mesma convenção das bboxes extraídas do lv.pdf). Retorna a largura."""
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
    """Texto multilinha dentro de um retângulo (quebra automática)."""
    if not texto:
        return
    reg, _ = _fonts()
    r = pymupdf.Rect(*rect)
    pag.insert_textbox(r, texto, fontsize=tamanho, fontname="trebreg", fontfile=reg, color=COR_TEXTO)


# ---------------------------------------------------------------------------
# Páginas
# ---------------------------------------------------------------------------


def _pagina_1(pdf, ctx):
    pag = pdf.new_page(width=PAGINA[0], height=PAGINA[1])
    _registrar_fontes(pag)
    artes = ctx["artes"]

    # logo + título
    pag.insert_image(pymupdf.Rect(14.2, 14.2, 112.7, 43.4), filename=artes["logo"], keep_proportion=False)
    _texto_central(pag, 308.0, 18, "Ordem de Serviço - Linha Viva", 18, bold=True)

    # linha superior
    _linha(pag, (14, 54.1), (581, 54.1), COR_LINHA_TOP, 0.28)

    # caixas da grade
    for r in [
        (62.4, 60.4, 161.0, 80.8),  # Ord.Serv.
        (238.6, 60.4, 303.6, 77.4),  # Equipe
        (395.3, 60.4, 476.9, 77.4),  # ID Obra
        (540.1, 60.4, 572.0, 77.4),  # Agência / CDA
        (62.4, 86.0, 129.6, 103.0),  # Data
        (238.6, 86.0, 456.6, 103.0),  # Encarregado
        (62.4, 109.1, 349.4, 126.1),  # Obra
        (417.1, 109.1, 572.0, 126.1),  # Atividade
        (62.4, 130.1, 347.9, 147.0),  # Local
        (417.1, 130.1, 572.0, 147.0),  # Município
        (99.1, 152.3, 572.0, 201.6),  # Serviço a Executar
        (214.2, 206.4, 260.5, 223.3),  # H.Desligar
        (214.2, 226.4, 260.5, 243.4),  # H.Religar
        (324.1, 206.8, 572.1, 223.7),  # Alimentador
        (324.1, 227.0, 572.1, 244.0),  # Chave
        (65.3, 247.6, 572.0, 298.8),  # Obs.
    ]:
        _caixa(pag, r)

    # rótulos
    labels = [
        (22, 64, "Ord.Serv."),
        (205, 64, "Equipe"),
        (359, 64, "ID Obra"),
        (506, 64, "Agência"),
        (36, 89, "Data"),
        (183, 89, "Encarregado"),
        (36, 112, "Obra"),
        (371, 112, "Atividade"),
        (34, 133, "Local"),
        (371, 133, "Município"),
        (17, 172, "Serviço a Executar"),
        (18, 209, "BT Energ."),
        (18, 230, "AT Energ."),
        (99, 230, "Bloqueio"),
        (168, 210, "H.Desligar"),
        (172, 230, "H.Religar"),
        (269, 210, "Alimentador"),
        (294, 230, "Chave"),
        (17, 265, "Obs."),
    ]
    for x, y0, t in labels:
        _texto(pag, x, y0, t, 9)

    # valores
    _texto(pag, 65, 64, ctx["codigo"], 12, bold=True)
    _texto(pag, 241, 64, ctx["equipe"], 9)
    _texto(pag, 427, 64, ctx["id_obra"], 9)
    _texto(pag, 543, 64, ctx["agencia"], 9)
    _texto(pag, 65, 89, ctx["data_placeholder"], 9)
    _texto(pag, 241, 89, ctx["encarregado"], 9)
    _texto(pag, 66, 112, ctx["obra"], 9)
    _texto(pag, 420, 112, ctx["atividade"], 9)
    _texto(pag, 66, 133, ctx["local"], 9)
    _texto(pag, 420, 133, ctx["municipio"], 9)
    _texto_box(pag, (100, 156, 568, 200), ctx["servico"])
    _texto(pag, 226, 210, ctx["h_desligar"], 9)
    _texto(pag, 226, 230, ctx["h_religar"], 9)
    _texto(pag, 328, 210, ctx["alimentador"], 9)
    _texto(pag, 328, 230, ctx["chave"], 9)
    _texto_box(pag, (67, 252, 568, 297), ctx["obs"])

    # checkboxes
    _check(pag, (69.2, 209.9, 79.0, 219.7), ctx["bt"])
    _check(pag, (69.2, 230.0, 79.0, 239.8), ctx["at"])
    _check(pag, (145.3, 230.0, 155.1, 239.8), ctx["bloqueio"])

    # arte inferior
    pag.insert_image(pymupdf.Rect(31.1, 301.9, 564.2, 787.5), filename=artes["arte_p1"], keep_proportion=False)


def _pagina_2(pdf, ctx):
    pag = pdf.new_page(width=PAGINA[0], height=PAGINA[1])
    _registrar_fontes(pag)
    artes = ctx["artes"]

    # faixa do título
    pag.insert_image(pymupdf.Rect(76.0, 14.2, 118.1, 41.9), filename=artes["logo"], keep_proportion=False)
    _texto_central(pag, 320.0, 22, "AVALIAÇÃO PRÉVIA DE ESTUDO E PLANEJAMENTO DAS ATIVIDADES", 11)
    _texto_dir(pag, 575, 24, ctx["data_placeholder"], 10)
    _linha(pag, (28, 41.8), (581, 41.8), COR_LINHA_TOP, 0.28)
    _linha(pag, (28, 42.1), (581, 42.1), COR_LINHA_SUAVE, 0.28)

    # O.S. Nr.
    _texto(pag, 31, 45, "O.S. Nr. :", 10, bold=True)
    _texto(pag, 90, 45, ctx["codigo"], 10, bold=True)

    # arte central
    pag.insert_image(pymupdf.Rect(28.3, 63.7, 580.3, 558.7), filename=artes["arte_p2"], keep_proportion=False)

    # Membros da Equipe + linha de validação
    _texto(pag, 31, 562, "Membros da Equipe", 11, bold=True)
    pag.insert_text(
        (163, 564 + HELV_ASCENDER * 8),
        "Data : ______/______/__________     Hora : _____/_____     Todos entenderam os requisitos de segurança? ____",
        fontsize=8,
        fontname="helv",
        color=COR_TEXTO,
    )

    # tabela de membros
    cols = (28.0, 217.0, 381.0, 581.0)
    y_cab = 577.4
    altura_cab = 17.3
    pag.draw_rect(
        pymupdf.Rect(cols[0], y_cab, cols[3], y_cab + altura_cab),
        color=None,
        fill=FILL_CABECALHO,
    )
    _texto(pag, cols[0] + 3, y_cab + 3.6, "Nome", 8)
    _texto(pag, cols[1] + 3, y_cab + 3.6, "Cargo", 8)
    _texto(pag, cols[2] + 3, y_cab + 3.6, "Assinatura", 8)

    y = y_cab + altura_cab
    for i, m in enumerate(ctx["membros"]):
        altura = 19.3 if i % 2 == 0 else 19.7
        fill = FILL_CRIACAO if i % 2 == 1 else FILL_BRANCO
        pag.draw_rect(
            pymupdf.Rect(cols[0], y, cols[3], y + altura),
            color=None,
            fill=fill,
        )
        _texto(pag, cols[0] + 3, y + 5.3, m.get("nome") or "", 8)
        _texto(pag, cols[1] + 3, y + 5.3, m.get("cargo") or "", 8)
        pag.insert_text(
            (cols[2] + 3, y + 3.3 + HELV_ASCENDER * 8),
            "_" * 43,
            fontsize=8,
            fontname="helv",
            color=COR_TEXTO,
        )
        y += altura

    y_fim_tabela = y

    # faixa final
    pag.insert_image(
        pymupdf.Rect(28.3, y_fim_tabela + 0.2, 580.3, y_fim_tabela + 58.0),
        filename=artes["banner"],
        keep_proportion=False,
    )

    # linhas inferiores da página (como no original)
    _linha(pag, (28, 821.9), (581, 821.9), COR_LINHA_SUAVE, 0.28)
    _linha(pag, (28, 827.6), (581, 827.6), COR_LINHA_SUAVE, 0.28)


# ---------------------------------------------------------------------------
# API pública
# ---------------------------------------------------------------------------


def gerar_pdf_linha_viva(
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
    """Gera o PDF do modelo Linha Viva e retorna o caminho temporário."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    artes_dir = os.path.join(base_dir, "templates", "artes_linha_viva")
    artes = {nome: os.path.join(artes_dir, f"{nome}.png") for nome in ("logo", "arte_p1", "arte_p2", "banner")}
    for caminho in artes.values():
        if not os.path.exists(caminho):
            raise RuntimeError(f"Arte do modelo Linha Viva não encontrada: {caminho}")

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

    caminho = _novo_caminho_temp("os_modelo_linha_viva_")
    pdf.save(caminho)
    pdf.close()
    logger.info("Modelo Linha Viva gerado em %s", caminho)
    return caminho
