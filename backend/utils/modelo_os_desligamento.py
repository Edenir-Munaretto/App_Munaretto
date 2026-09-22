"""Renderização da Solicitação de Desligamento (Celesc) em PDF (pymupdf).

Replica a geometria do modelo oficial (Downloads/DESLIGAMENTO.pdf), medido via
extração das posições de textos, linhas e imagem:

  - Cabeçalho com a logo da Celesc e o título "Solicitação de Desligamento";
  - Identificação (agência, projeto Sap, obra, local, município, ObrasID);
  - Bloco de desligamento (data, desligar/religar, alimentador, FuChave);
  - Identificação (serviço, ordem de serviço, equipe, encarregado, substituto);
  - Declaração de levantamento em campo e linha de assinatura.

Fonte: Trebuchet MS (regular/negrito) com fallback para Liberation/DejaVu Sans
em ambientes sem a fonte; os textos institucionais usam a Helvetica embutida.
"""

import logging
import os
import tempfile

import pymupdf

logger = logging.getLogger(__name__)

PAGINA = (595.2756, 841.8898)

COR_TEXTO = (0.314, 0.314, 0.314)  # #505050
COR_ESCURA = (0.0, 0.0, 0.0)  # #000000
COR_CLARA = (0.580, 0.580, 0.580)  # #949494
COR_LINHA_SUAVE = (0.8, 0.8, 0.8)

TREBUC_REG = None
TREBUC_BOLD = None
_FONTES = {}

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
    for caminho in candidatas:
        if os.path.exists(caminho):
            return caminho
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


def _font_trebuchet(bold=False):
    chave = "trebbold" if bold else "trebreg"
    if chave not in _FONTES:
        _FONTES[chave] = pymupdf.Font(fontname=chave, fontfile=_fonts()[1 if bold else 0])
    return _FONTES[chave]


def _font_helv():
    if "helv" not in _FONTES:
        _FONTES["helv"] = pymupdf.Font(fontname="helv")
    return _FONTES["helv"]


def _texto(pag, x, y0, texto, tamanho, *, bold=False, cor=COR_TEXTO):
    """Insere texto Trebuchet na coordenada (x, y0) — y0 é o TOPO do texto."""
    if not texto:
        return
    fonte = _font_trebuchet(bold)
    pag.insert_text(
        (x, y0 + fonte.ascender * tamanho),
        str(texto),
        fontsize=tamanho,
        fontname="trebbold" if bold else "trebreg",
        color=cor,
    )


def _texto_helv(pag, x, y0, texto, tamanho, *, cor=COR_TEXTO):
    """Insere texto Helvetica (fonte embutida) com y0 no TOPO do texto."""
    if not texto:
        return
    fonte = _font_helv()
    pag.insert_text(
        (x, y0 + fonte.ascender * tamanho),
        str(texto),
        fontsize=tamanho,
        fontname="helv",
        color=cor,
    )


def _texto_central(pag, cx, y0, texto, tamanho, *, bold=True, cor=COR_TEXTO):
    fonte = _font_trebuchet(bold)
    largura = fonte.text_length(texto, fontsize=tamanho)
    _texto(pag, cx - largura / 2, y0, texto, tamanho, bold=bold, cor=cor)


def _linha(pag, p1, p2, cor=COR_TEXTO, largura=0.283):
    pag.draw_line(p1, p2, color=cor, width=largura)


def _novo_caminho_temp(prefixo: str, sufixo: str = ".pdf") -> str:
    fd, caminho = tempfile.mkstemp(prefix=prefixo, suffix=sufixo)
    os.close(fd)
    return caminho


def _pagina(pdf, ctx):
    pag = pdf.new_page(width=PAGINA[0], height=PAGINA[1])
    _registrar_fontes(pag)

    pag.insert_image(pymupdf.Rect(42.5, 28.3, 140.1, 59.1), filename=ctx["logo"], keep_proportion=False)

    _texto_helv(pag, 45.4, 85.9, "À CELESC - Centrais Elétricas de Santa Catarina S/A", 10, cor=COR_ESCURA)
    _texto_central(pag, 285.1, 129.8, "Solicitação de Desligamento", 13)

    _linha(pag, (42.5, 176.6), (566.9, 176.6), COR_ESCURA)
    _linha(pag, (42.5, 635.3), (566.9, 635.3), COR_LINHA_SUAVE)
    _linha(pag, (42.5, 813.5), (566.9, 813.5), COR_LINHA_SUAVE)

    _texto(pag, 51.0, 201.8, "Agência :", 9)
    _texto(pag, 141.8, 202.0, ctx["agencia"], 9)
    _texto(pag, 51.0, 219.1, "Projeto (Sap) :", 9)
    _texto(pag, 141.8, 219.3, ctx["projeto_sap"], 9)
    _texto(pag, 51.0, 236.4, "Obra :", 9)
    _texto(pag, 141.8, 236.5, ctx["obra"], 9)
    _texto(pag, 51.0, 253.6, "Local :", 9)
    _texto(pag, 141.8, 253.8, ctx["local"], 9)
    _texto(pag, 51.0, 270.8, "Município :", 9)
    _texto(pag, 141.8, 270.8, ctx["municipio"], 9)

    _texto(pag, 265.4, 219.0, "ObrasID :", 9, cor=COR_CLARA)
    _texto(pag, 317.1, 219.1, ctx["id_obra"], 9, bold=True, cor=COR_CLARA)

    _texto(pag, 141.8, 310.8, "Data :", 10, bold=True, cor=COR_ESCURA)
    _texto(pag, 232.5, 310.8, ctx["data"], 10, bold=True, cor=COR_ESCURA)
    _texto(pag, 141.8, 333.7, "Desligar :", 10, bold=True, cor=COR_ESCURA)
    _texto(pag, 232.5, 333.8, ctx["h_desligar"], 12, bold=True, cor=COR_ESCURA)
    _texto(pag, 141.8, 353.7, "Religar :", 10, bold=True, cor=COR_ESCURA)
    _texto(pag, 232.5, 353.8, ctx["h_religar"], 12, bold=True, cor=COR_ESCURA)
    _texto(pag, 141.8, 376.7, "Alimentador :", 10, bold=True, cor=COR_ESCURA)
    _texto(pag, 232.5, 376.8, ctx["alimentador"], 10, bold=True, cor=COR_ESCURA)
    _texto(pag, 141.8, 396.7, "FuChave :", 10, bold=True, cor=COR_ESCURA)
    _texto(pag, 232.1, 396.7, ctx["chave"], 10, bold=True, cor=COR_ESCURA)
    _texto(pag, 103.0, 418.0, "Local de Entrega do DTD :", 10, bold=True, cor=COR_ESCURA)

    _texto(pag, 51.0, 451.6, "Serviço a executar :", 9)
    _texto(pag, 141.4, 451.9, ctx["servico"], 9)
    _texto(pag, 51.0, 468.9, "Ordem de Serviço :", 9)
    _texto(pag, 141.8, 468.9, ctx["codigo"], 9)
    _texto(pag, 51.0, 496.8, "Equipe", 9)
    _texto(pag, 141.4, 497.5, ctx["equipe"], 9)
    _texto(pag, 51.0, 514.3, "Encarregado", 9)
    _texto(pag, 141.8, 514.4, ctx["encarregado"], 9)
    _texto(pag, 51.0, 531.7, "Substituto:", 9)
    _texto(pag, 141.4, 532.2, ctx["substituto"], 9)

    _texto_helv(
        pag,
        52.2,
        649.7,
        "Declaramos que, para realização dos serviços descritos nesta solicitação de desligamento, foram realizados",
        10,
    )
    _texto_helv(
        pag,
        52.2,
        660.8,
        "levantamentos em campo e constatados que os equipamentos solicitados desenergizam o trecho, possibilitando",
        10,
    )
    _texto_helv(pag, 52.2, 671.8, "a execução dos serviços com segurança", 10)
    _texto_helv(pag, 51.0, 711.9, "Sendo o que tínhamos para o momento.", 10)
    _texto_helv(pag, 51.0, 750.1, "Atenciosamente", 10)
    _texto_helv(pag, 51.0, 786.7, "______________________________________________", 8)


def gerar_pdf_desligamento(
    *,
    agencia: str = "",
    projeto_sap: str = "",
    obra: str = "",
    local: str = "",
    municipio: str = "",
    id_obra: str = "",
    data: str = "",
    h_desligar: str = "",
    h_religar: str = "",
    alimentador: str = "",
    chave: str = "",
    servico: str = "",
    codigo: str = "",
    equipe: str = "",
    encarregado: str = "",
    substituto: str = "",
) -> str:
    """Gera a Solicitação de Desligamento preenchida e devolve o caminho temporário."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    logo = os.path.join(base_dir, "templates", "artes_desligamento", "logo.png")
    if not os.path.exists(logo):
        raise RuntimeError(f"Arte do modelo Desligamento não encontrada: {logo}")

    ctx = {
        "logo": logo,
        "agencia": agencia or "",
        "projeto_sap": projeto_sap or "",
        "obra": obra or "",
        "local": local or "",
        "municipio": municipio or "",
        "id_obra": id_obra or "",
        "data": data or "__/__/____",
        "h_desligar": h_desligar or "__:__",
        "h_religar": h_religar or "__:__",
        "alimentador": alimentador or "",
        "chave": chave or "",
        "servico": servico or "",
        "codigo": codigo or "",
        "equipe": equipe or "",
        "encarregado": encarregado or "",
        "substituto": substituto or "",
    }

    pdf = pymupdf.open()
    _pagina(pdf, ctx)

    caminho = _novo_caminho_temp("os_desligamento_")
    pdf.save(caminho)
    pdf.close()
    logger.info("Solicitação de Desligamento gerada em %s", caminho)
    return caminho
