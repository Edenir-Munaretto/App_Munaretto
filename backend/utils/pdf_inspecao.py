"""Relatório PDF de uma Inspeção (checklist + evidências + assinaturas).

Layout baseado no checklist de O.S (`utils/pdf_os_checklist.py`): capa com a
identificação da inspeção (incluindo os campos da tela inicial), tabela de
respostas agrupada, fotos com data/hora/GPS e bloco de assinaturas.
"""

import logging
import os
import tempfile

from fpdf import FPDF

from utils.date_helpers import agora_fuso_brasil, em_fuso_brasil
from utils.pdf_base import desenhar_cabecalho, desenhar_logo

logger = logging.getLogger(__name__)

LARGURA_PAGINA = 210  # A4
MARGEM = 10

ROTULOS_STATUS = {
    "rascunho": "Rascunho",
    "concluida": "Concluída",
    "cancelada": "Cancelada",
}


def _novo_caminho_temp(prefixo: str, sufixo: str = ".pdf") -> str:
    fd, caminho = tempfile.mkstemp(prefix=prefixo, suffix=sufixo)
    os.close(fd)
    return caminho


def _txt(valor) -> str:
    if valor is None:
        return ""
    return str(valor).encode("latin-1", "replace").decode("latin-1")


def _fmt_data(valor) -> str:
    if not valor:
        return "-"
    dt = em_fuso_brasil(valor)
    if dt is not None:
        return dt.strftime("%d/%m/%Y")
    return _txt(valor)


def _fmt_hora(valor) -> str:
    if not valor:
        return "-"
    dt = em_fuso_brasil(valor)
    if dt is not None:
        return dt.strftime("%H:%M")
    return _txt(valor)[:5]


def _fmt_data_hora(valor) -> str:
    if not valor:
        return "-"
    dt = em_fuso_brasil(valor)
    if dt is not None:
        return dt.strftime("%d/%m/%Y %H:%M")
    return _txt(valor)


class _PdfInspecao(FPDF):
    def header(self):
        if self.page_no() == 1:
            return
        desenhar_logo(self, self.l_margin, 4, 9.0)
        self.set_font("Arial", "B", 8)
        self.set_text_color(100, 116, 139)
        self.set_xy(0, 6.5)
        self.cell(0, 5, "RELATÓRIO DE INSPEÇÃO", align="C")
        self.set_draw_color(15, 23, 42)
        self.set_line_width(0.35)
        self.line(self.l_margin, 15, self.w - self.r_margin, 15)
        self.set_y(self.t_margin)

    def footer(self):
        self.set_y(-15)
        self.set_font("Arial", "I", 8)
        self.set_text_color(128, 128, 128)
        self.cell(
            0,
            10,
            f"Gerado em {agora_fuso_brasil().strftime('%d/%m/%Y %H:%M')} - Página {self.page_no()}",
            align="C",
        )


def _linha_campo(pdf: FPDF, rotulo: str, valor, largura_rotulo: float = 34):
    pdf.set_font("Arial", "B", 8.5)
    pdf.set_text_color(71, 85, 105)
    pdf.cell(largura_rotulo, 6, f"{_txt(rotulo)}:")
    pdf.set_font("Arial", "", 8.5)
    pdf.set_text_color(15, 23, 42)
    pdf.multi_cell(0, 6, _txt(valor) or "-", new_x="LMARGIN")


def _capa(pdf: _PdfInspecao, inspecao: dict):
    pdf.add_page()
    titulo = (inspecao.get("modelo_nome") or "INSPEÇÃO").upper()
    subtitulo = (
        "SESMT"
        if str(inspecao.get("atividade_nome") or "").strip().lower() == "segurança"
        else "RELATÓRIO DE INSPEÇÃO"
    )
    desenhar_cabecalho(pdf, _txt(titulo), subtitulo)
    pdf.ln(1)

    _linha_campo(pdf, "Código", inspecao.get("codigo"))
    _linha_campo(pdf, "Data / hora", _fmt_data_hora(inspecao.get("iniciada_em") or inspecao.get("data_inspecao")))
    _linha_campo(pdf, "Inspetor", inspecao.get("inspetor_nome"))
    _linha_campo(pdf, "Atividade", inspecao.get("atividade_nome"))
    _linha_campo(pdf, "Tipo de inspeção", inspecao.get("modelo_nome"))
    _linha_campo(pdf, "Tipo de serviço", inspecao.get("tipo_servico"))
    _linha_campo(pdf, "Situação", ROTULOS_STATUS.get(inspecao.get("status"), inspecao.get("status")))
    _linha_campo(pdf, "Obra", inspecao.get("obra_nome"))
    _linha_campo(pdf, "Cliente", inspecao.get("obra_cliente"))
    _linha_campo(pdf, "Local da inspeção", inspecao.get("local_inspecao"))
    _linha_campo(pdf, "Funcionário", inspecao.get("funcionario_nome"))
    _linha_campo(pdf, "Cargo do funcionário", inspecao.get("funcionario_cargo"))
    _linha_campo(
        pdf,
        "Equipe inspecionada",
        " - ".join(
            parte
            for parte in (
                (str(inspecao.get("equipe_numero")) if inspecao.get("equipe_numero") else ""),
                (inspecao.get("equipe_nome") or ""),
            )
            if parte
        ),
    )
    _linha_campo(pdf, "Encarregado", inspecao.get("encarregado"))
    _linha_campo(pdf, "Veículo", inspecao.get("veiculo"))
    _linha_campo(pdf, "Setor", inspecao.get("setor"))

    if inspecao.get("status") == "cancelada":
        pdf.ln(2)
        pdf.set_font("Arial", "B", 9)
        pdf.set_text_color(185, 28, 28)
        pdf.multi_cell(
            0,
            6,
            f"INSPEÇÃO CANCELADA em {_fmt_data_hora(inspecao.get('cancelada_em'))} "
            f"por {_txt(inspecao.get('cancelada_por') or '-')}.\n"
            f"Motivo: {_txt(inspecao.get('motivo_cancelamento') or '-')}",
            new_x="LMARGIN",
        )
        pdf.set_text_color(15, 23, 42)


def _config_tabela(tipo_resposta: str | None) -> dict:
    if tipo_resposta == "sim_nao_na":
        return {
            "larguras": {
                "numero": 14,
                "pergunta": 100,
                "r1": 16,
                "r2": 16,
                "na": 16,
                "hora": 28,
            },
            "rotulos": {
                "numero": "N.º",
                "pergunta": "Descrição",
                "r1": "Sim",
                "r2": "Não",
                "na": "N/A",
                "hora": "Hora",
            },
            "valores": ("sim", "nao"),
            "valor_nao": "nao",
            "mostrar_observacao": False,
            "usar_ordem": True,
        }
    return {
        "larguras": {
            "numero": 15,
            "pergunta": 67,
            "r1": 11,
            "r2": 11,
            "na": 11,
            "observacao": 53,
            "hora": 22,
        },
        "rotulos": {
            "numero": "Classif.",
            "pergunta": "Pergunta",
            "r1": "C",
            "r2": "NC",
            "na": "N/A",
            "observacao": "Observação",
            "hora": "Hora",
        },
        "valores": ("conforme", "nao_conforme"),
        "valor_nao": "nao_conforme",
        "mostrar_observacao": True,
        "usar_ordem": False,
    }


def _cabecalho_tabela(pdf: FPDF, config: dict):
    pdf.set_font("Arial", "B", 7.5)
    pdf.set_fill_color(15, 23, 42)
    pdf.set_text_color(255, 255, 255)
    colunas = [
        ("numero", "L"),
        ("pergunta", "L"),
        ("r1", "C"),
        ("r2", "C"),
        ("na", "C"),
    ]
    if config["mostrar_observacao"]:
        colunas.append(("observacao", "L"))
    colunas.append(("hora", "C"))
    for chave, alinhamento in colunas:
        pdf.cell(
            config["larguras"][chave],
            7,
            config["rotulos"][chave],
            border=1,
            fill=True,
            align=alinhamento,
        )
    pdf.ln()
    pdf.set_text_color(15, 23, 42)


def _secao_observacoes(pdf: _PdfInspecao, inspecao: dict):
    texto = str(inspecao.get("observacoes") or "").strip()
    pdf.ln(3)
    pdf.set_fill_color(241, 245, 249)
    pdf.set_text_color(71, 85, 105)
    pdf.set_font("Arial", "B", 9)
    pdf.cell(0, 7, " OBSERVAÇÕES", ln=True, fill=True)
    pdf.set_text_color(15, 23, 42)
    pdf.set_font("Arial", "", 8.5)
    pdf.multi_cell(0, 5, _txt(texto) or "-", new_x="LMARGIN")


def _tabela_checklist(pdf: _PdfInspecao, itens: list[dict], tipo_resposta: str | None = None):
    pdf.add_page()
    pdf.set_fill_color(15, 23, 42)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Arial", "B", 11)
    pdf.cell(0, 9, " CHECKLIST DA INSPEÇÃO", ln=True, fill=True)
    pdf.ln(1)

    config = _config_tabela(tipo_resposta)
    larguras = config["larguras"]

    def _grupo(item):
        nome = item.get("grupo_nome") or f"Grupo {item.get('grupo_ordem')}"
        pdf.set_font("Arial", "B", 8.5)
        pdf.set_fill_color(241, 245, 249)
        pdf.set_text_color(71, 85, 105)
        pdf.cell(0, 7, f" {int(item.get('grupo_ordem') or 1)} - {_txt(str(nome).upper())}", ln=True, fill=True)
        pdf.set_text_color(15, 23, 42)
        _cabecalho_tabela(pdf, config)

    grupo_atual = None
    for item in itens:
        grupo = (item.get("grupo_ordem"), item.get("grupo_nome"))
        if grupo != grupo_atual:
            grupo_atual = grupo
            _grupo(item)

        resposta = item.get("resposta") or {}
        valor = resposta.get("resposta")
        pergunta = _txt(item.get("pergunta", ""))
        observacao = _txt(resposta.get("observacao", "")) if config["mostrar_observacao"] else ""
        linhas_pergunta = pdf.multi_cell(
            larguras["pergunta"], 5, f" {pergunta}", border=0, dry_run=True, output="LINES"
        )
        linhas_obs = [""]
        if config["mostrar_observacao"]:
            pdf.set_font("Arial", "", 7.5)
            linhas_obs = pdf.multi_cell(
                larguras["observacao"], 5, f" {observacao}", border=0, dry_run=True, output="LINES"
            )
        altura = max(7, 5 * max(len(linhas_pergunta), len(linhas_obs)))
        if pdf.will_page_break(altura):
            pdf.add_page()
            _grupo(item)

        numero = item.get("ordem") if config["usar_ordem"] else item.get("classificacao")
        chaves = ["numero", "pergunta", "r1", "r2", "na"]
        if config["mostrar_observacao"]:
            chaves.append("observacao")
        chaves.append("hora")

        y0 = pdf.get_y()
        x_cursor = pdf.l_margin
        posicoes = []
        for chave in chaves:
            posicoes.append((chave, x_cursor, larguras[chave]))
            x_cursor += larguras[chave]

        # O texto é desenhado SEM borda e a moldura da linha é desenhada
        # depois com `rect`. `multi_cell(border=1)` desenharia uma linha
        # horizontal a cada quebra de texto (o "sublinhado" indesejado).
        pdf.set_font("Arial", "", 7.5)
        for chave, x_celula, largura in posicoes:
            pdf.set_xy(x_celula, y0)
            if chave == "pergunta":
                pdf.multi_cell(
                    largura,
                    5,
                    f" {pergunta}",
                    border=0,
                    new_x="RIGHT",
                    new_y="TOP",
                )
            elif chave == "observacao":
                pdf.multi_cell(
                    largura,
                    5,
                    f" {observacao}",
                    border=0,
                    new_x="RIGHT",
                    new_y="TOP",
                )
            elif chave == "numero":
                pdf.cell(largura, altura, f" {_txt(numero)}", border=0, align="L")
            elif chave in ("r1", "r2"):
                indice = 0 if chave == "r1" else 1
                pdf.cell(
                    largura,
                    altura,
                    "X" if valor == config["valores"][indice] else "",
                    border=0,
                    align="C",
                )
            elif chave == "na":
                pdf.cell(largura, altura, "X" if valor == "na" else "", border=0, align="C")
            else:  # hora
                pdf.cell(
                    largura,
                    altura,
                    _fmt_hora(resposta.get("criado_em")) if resposta else "",
                    border=0,
                    align="C",
                )

        pdf.set_draw_color(15, 23, 42)
        pdf.set_line_width(0.2)
        for _, x_celula, largura in posicoes:
            pdf.rect(x_celula, y0, largura, altura)
        pdf.set_xy(pdf.l_margin, y0 + altura)

    respondidos = sum(1 for i in itens if i.get("resposta"))
    naos = [i for i in itens if (i.get("resposta") or {}).get("resposta") == config["valor_nao"]]
    pdf.ln(2)
    pdf.set_font("Arial", "B", 8)
    rotulo_naos = "Não conformes" if config["mostrar_observacao"] else "Respostas Não"
    pdf.cell(
        0,
        6,
        f"Perguntas: {len(itens)} | Respondidas: {respondidos} | {rotulo_naos}: {len(naos)}",
        ln=True,
    )

    if config["mostrar_observacao"] and naos:
        pdf.ln(1)
        pdf.set_font("Arial", "B", 8)
        pdf.set_text_color(185, 28, 28)
        pdf.cell(0, 6, "NÃO CONFORMIDADES:", ln=True)
        pdf.set_font("Arial", "", 8)
        for item in naos:
            observacao = ((item.get("resposta") or {}).get("observacao") or "").strip()
            linha = f"{item.get('classificacao')} {_txt(item.get('pergunta'))}"
            if observacao:
                linha += f" - {_txt(observacao)}"
            pdf.multi_cell(0, 5, linha, new_x="LMARGIN")
        pdf.set_text_color(15, 23, 42)


def _ext_foto(mime_type) -> str:
    mime = str(mime_type or "").lower()
    if mime == "image/jpeg":
        return ".jpg"
    if mime == "image/png":
        return ".png"
    if mime == "image/webp":
        return ".webp"
    return ".jpg"


def _paginas_fotos(pdf: _PdfInspecao, itens: list[dict], baixar_foto, tipo_resposta: str | None = None):
    pares = [(item, foto) for item in itens for foto in (item.get("fotos") or [])]
    if not pares:
        return

    COLUNAS = 2
    ESPACO_COLUNAS = 4
    larg_celula = (LARGURA_PAGINA - 2 * MARGEM - ESPACO_COLUNAS * (COLUNAS - 1)) / COLUNAS
    alt_foto = 58
    alt_legenda = 14
    passo_linha = alt_foto + alt_legenda + 4
    altura_titulo = 11

    def _titulo_fotos(nova_pagina: bool):
        if nova_pagina:
            pdf.add_page()
        pdf.set_fill_color(15, 23, 42)
        pdf.set_text_color(255, 255, 255)
        pdf.set_font("Arial", "B", 11)
        pdf.cell(0, 9, " EVIDÊNCIAS FOTOGRÁFICAS", ln=True, fill=True)
        pdf.ln(2)
        pdf.set_text_color(15, 23, 42)

    # Começa logo após as observações quando houver espaço para ao menos uma
    # linha; caso contrário abre uma página nova.
    if pdf.will_page_break(altura_titulo + passo_linha):
        _titulo_fotos(True)
    else:
        _titulo_fotos(False)

    def _desenhar_foto(item: dict, foto: dict, x: float, y: float):
        bytes_foto = baixar_foto(foto.get("bucket_key"))
        if bytes_foto:
            try:
                caminho = _novo_caminho_temp("inspecao_foto_", _ext_foto(foto.get("mime_type")))
                with open(caminho, "wb") as arquivo:
                    arquivo.write(bytes_foto)
                pdf.image(
                    caminho,
                    x,
                    y,
                    w=larg_celula,
                    h=alt_foto,
                    keep_aspect_ratio=True,
                )
                os.remove(caminho)
            except Exception:
                logger.exception("Erro ao embutir foto da inspeção")
        else:
            pdf.rect(x, y, larg_celula, alt_foto)
            pdf.set_font("Arial", "I", 8)
            pdf.text(x + 10, y + 40, "Foto indisponível")

        numero = item.get("ordem") if tipo_resposta == "sim_nao_na" else item.get("classificacao")
        legenda = f"{numero or ''} {_txt(item.get('pergunta', ''))}"
        if len(legenda) > 130:
            legenda = legenda[:127].rstrip() + "..."
        pdf.set_font("Arial", "B", 7)
        pdf.set_text_color(15, 23, 42)
        pdf.set_xy(x, y + alt_foto + 1)
        pdf.multi_cell(larg_celula, 3.5, legenda, border=0)

        resposta = item.get("resposta") or {}
        pdf.set_font("Arial", "", 6.5)
        pdf.set_text_color(100, 116, 139)
        data_foto = foto.get("capturado_em") or foto.get("created_at")
        gps = foto.get("geolocalizacao") or resposta.get("geolocalizacao") or ""
        pdf.set_xy(x, y + alt_foto + 8.5)
        pdf.multi_cell(
            larg_celula,
            3.5,
            f"{_fmt_data_hora(data_foto)}{f'  ·  GPS {gps}' if gps else ''}",
            border=0,
        )
        pdf.set_text_color(15, 23, 42)

    for inicio in range(0, len(pares), COLUNAS):
        if pdf.will_page_break(passo_linha):
            _titulo_fotos(True)
        y = pdf.get_y()
        for coluna, (item, foto) in enumerate(pares[inicio:inicio + COLUNAS]):
            x = MARGEM + coluna * (larg_celula + ESPACO_COLUNAS)
            _desenhar_foto(item, foto, x, y)
        pdf.set_y(y + passo_linha)


def _assinaturas(pdf: _PdfInspecao, inspecao: dict, assinantes: list[dict]):
    # Espaço mínimo para título + assinaturas principais + início da tabela.
    ESPACO_MINIMO = 65
    if pdf.will_page_break(ESPACO_MINIMO):
        pdf.add_page()

    pdf.set_fill_color(15, 23, 42)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Arial", "B", 11)
    pdf.cell(0, 9, " ASSINATURAS", ln=True, fill=True)
    pdf.ln(4)
    pdf.set_text_color(15, 23, 42)

    primarios = [
        ("TÉCNICO DE SEGURANÇA DO TRABALHO", inspecao.get("inspetor_nome")),
        ("RESPONSÁVEL EMPRESA", inspecao.get("encarregado")),
    ]
    larg = (LARGURA_PAGINA - 2 * MARGEM) / 2 - 5
    y = pdf.get_y() + 2
    pdf.set_font("Arial", "B", 8)
    for indice, (rotulo, nome) in enumerate(primarios):
        x = MARGEM + indice * (larg + 10)
        pdf.set_xy(x, y)
        pdf.cell(larg, 5, rotulo, align="C")
        pdf.line(x, y + 16, x + larg, y + 16)
        pdf.set_xy(x, y + 17)
        pdf.set_font("Arial", "", 8)
        pdf.cell(larg, 5, _txt(nome) or "", align="C")
        pdf.set_font("Arial", "B", 8)
    pdf.set_y(y + 28)

    nomes_primarios = {
        str(nome).strip().lower()
        for _, nome in primarios
        if nome
    }
    extras = [
        assinante
        for assinante in assinantes
        if assinante.get("nome") and str(assinante.get("nome")).strip().lower() not in nomes_primarios
    ]

    def _cabecalho_pessoas():
        pdf.set_font("Arial", "B", 8.5)
        pdf.set_fill_color(241, 245, 249)
        pdf.set_text_color(71, 85, 105)
        pdf.cell(120, 7, " NOME DAS PESSOAS PRESENTES", border=1, fill=True)
        pdf.cell(70, 7, "ASSINATURA", border=1, fill=True, align="C")
        pdf.ln()
        pdf.set_text_color(15, 23, 42)

    _cabecalho_pessoas()

    linhas = extras or [{"nome": "", "cargo": None} for _ in range(4)]
    for assinante in linhas:
        if pdf.will_page_break(8):
            pdf.add_page()
            _cabecalho_pessoas()
        nome = _txt(assinante.get("nome") or "")
        cargo = assinante.get("cargo")
        texto = f" {nome}{f' - {_txt(cargo)}' if cargo else ''}" if nome else ""
        pdf.set_font("Arial", "", 8)
        pdf.cell(120, 8, texto, border=1)
        pdf.cell(70, 8, "", border=1)
        pdf.ln()

    pdf.ln(3)
    pdf.set_font("Arial", "I", 7.5)
    pdf.set_text_color(100, 116, 139)
    pdf.multi_cell(
        0,
        4,
        "As fotos da inspeção seguem anexas, identificadas e vistadas pelo Técnico de Segurança.",
        new_x="LMARGIN",
    )
    pdf.set_text_color(15, 23, 42)


def gerar_pdf_inspecao(
    inspecao: dict,
    itens: list[dict],
    assinantes: list[dict] | None = None,
    baixar_foto=None,
) -> str:
    """Monta o PDF da inspeção e retorna o caminho temporário."""
    pdf = _PdfInspecao(format="A4", unit="mm")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_margins(MARGEM, 18, MARGEM)

    _capa(pdf, inspecao)
    _tabela_checklist(pdf, itens, inspecao.get("tipo_resposta"))
    _secao_observacoes(pdf, inspecao)
    _paginas_fotos(
        pdf,
        itens,
        baixar_foto or (lambda chave: None),
        inspecao.get("tipo_resposta"),
    )
    _assinaturas(pdf, inspecao, assinantes or [])

    caminho = _novo_caminho_temp("inspecao_")
    pdf.output(caminho)
    return caminho

