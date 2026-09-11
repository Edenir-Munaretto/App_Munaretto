"""Base reutilizável dos relatórios PDF do Controle de O.S (fpdf2).

Extraída da antiga `_RelatorioOS` (pdf_os.py) para que os novos relatórios
(obra e serviços por obra) usem o mesmo padrão visual — header/rodapé
slate-900, títulos de seção, quebra de texto e tabelas com zebra — sem
duplicação. A `_RelatorioOS` passa a herdar desta base SEM mudança visual.

O cabeçalho (faixa branca com a logo + dados da empresa e faixa escura com o
título) é compartilhado com o checklist e a Carta de Término via
`desenhar_cabecalho`/`desenhar_logo`.
"""

import os
import tempfile

from fpdf import FPDF

from utils.date_helpers import agora_fuso_brasil

# ---------------------------------------------------------------------------
# Dados fixos da empresa (mesmos usados na Carta de Término e no modelo de O.S)
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


def _novo_caminho_temp(prefixo: str, sufixo: str = ".pdf") -> str:
    """Caminho temporário ÚNICO (evita colisão entre requisições concorrentes
    que antes gravavam arquivos com nome fixo)."""
    fd, caminho = tempfile.mkstemp(prefix=prefixo, suffix=sufixo)
    os.close(fd)
    return caminho


def desenhar_logo(pdf: FPDF, x: float, y: float, altura: float) -> float:
    """Desenha a logo da empresa mantendo a proporção do PNG.

    Retorna a largura usada (0 quando o arquivo não existe).
    """
    largura = round(altura * 159 / 105, 1)  # proporção original do ativo
    if not os.path.exists(CAMINHO_LOGO):
        return 0
    try:
        import pymupdf

        pix = pymupdf.Pixmap(CAMINHO_LOGO)
        if pix.width > 0 and pix.height > 0:
            largura = round(altura * pix.width / pix.height, 1)
    except Exception:
        pass  # sem PyMuPDF: usa a proporção padrão do ativo
    pdf.image(CAMINHO_LOGO, x=x, y=y, w=largura, h=altura)
    return largura


def desenhar_cabecalho(pdf: FPDF, titulo: str, subtitulo: str = "") -> float:
    """Faixa branca (logo + dados da empresa) + faixa escura (título).

    Desenha em coordenadas absolutas a partir do topo da página e posiciona o
    cursor abaixo do cabeçalho. Retorna o Y final.
    """
    largura_pagina = pdf.w
    margem = pdf.l_margin
    altura_logo = 14.0
    largura_logo = desenhar_logo(pdf, margem, 3.5, altura_logo)

    # Dados da empresa à direita da logo.
    x_dados = margem + largura_logo + 6
    largura_dados = largura_pagina - margem - x_dados
    pdf.set_text_color(15, 23, 42)
    pdf.set_font("Arial", "B", 8)
    pdf.set_xy(x_dados, 4.5)
    pdf.cell(largura_dados, 4.2, RAZAO_SOCIAL, align="R")
    pdf.set_font("Arial", "", 7.5)
    pdf.set_text_color(60, 60, 60)
    pdf.set_xy(x_dados, 8.7)
    pdf.cell(largura_dados, 4.2, f"CNPJ: {CNPJ}   |   IE: {IE}", align="R")
    pdf.set_xy(x_dados, 12.9)
    pdf.cell(largura_dados, 4.2, ENDERECO, align="R")
    pdf.set_xy(x_dados, 17.1)
    pdf.cell(largura_dados, 4.2, f"{CIDADE_UF} - CEP: {CEP}", align="R")

    # Faixa escura com o título do documento.
    altura_faixa = 22.0
    y_faixa = 22.0
    pdf.set_fill_color(15, 23, 42)
    pdf.rect(0, y_faixa, largura_pagina, altura_faixa, "F")
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Arial", "B", 14)
    pdf.set_xy(0, y_faixa + 1.5)
    pdf.cell(largura_pagina, 9, titulo, align="C")
    if subtitulo:
        pdf.set_font("Arial", "", 9)
        pdf.set_xy(0, y_faixa + 11)
        pdf.cell(largura_pagina, 6, subtitulo, align="C")

    y_final = y_faixa + altura_faixa + 4
    pdf.set_y(y_final)
    pdf.set_text_color(15, 23, 42)
    return y_final


class RelatorioBase(FPDF):
    """Página A4 com o padrão visual dos relatórios do módulo.

    Título/subtítulo do cabeçalho são atributos — cada relatório declara o
    seu (ex.: "RELATÓRIO DE ORDEM DE SERVIÇO", "RELATÓRIO DA OBRA").
    """

    titulo_documento: str = "RELATÓRIO"
    subtitulo_documento: str = "Munaretto & Co. - Controle de O.S"

    def header(self):
        desenhar_cabecalho(self, self.titulo_documento, self.subtitulo_documento)

    def footer(self):
        self.set_y(-15)
        self.set_font("Arial", "I", 8)
        self.set_text_color(128, 128, 128)
        texto_rodape = f"Gerado em {agora_fuso_brasil().strftime('%d/%m/%Y %H:%M')} - Página {self.page_no()}"
        self.cell(0, 10, texto_rodape, align="C")

    def _titulo_secao(self, titulo: str):
        self.ln(4)
        self.set_font("Arial", "B", 11)
        self.set_text_color(15, 23, 42)
        self.set_fill_color(226, 232, 240)
        self.cell(0, 8, f" {titulo}", ln=True, fill=True)
        self.ln(1)

    def _linha_dado(self, rotulo: str, valor: str):
        self.set_font("Arial", "B", 9)
        self.set_text_color(71, 85, 105)
        self.write(6, f"{rotulo}: ")
        self.set_font("Arial", "", 9)
        self.set_text_color(15, 23, 42)
        self.multi_cell(0, 6, valor or "-")
        self.ln(1)

    def _aviso_sem_dados(self, texto: str):
        """Aviso em itálico quando uma seção não tem registros."""
        self.set_font("Arial", "I", 9)
        self.set_text_color(100, 116, 139)
        self.multi_cell(0, 6, texto)
        self.ln(2)

    def _quebrar_texto(self, texto: str, largura: float) -> list[str]:
        """Divide o texto em linhas por PALAVRA COMPLETA para caber na célula.

        Usado com a fonte já selecionada (get_string_width mede a atual).
        Palavras maiores que a célula são fatiadas caractere a caractere.
        """
        if not texto:
            return [""]
        linhas: list[str] = []
        atual = ""
        for palavra in texto.split(" "):
            if not palavra:
                continue
            candidata = f"{atual} {palavra}" if atual else palavra
            if self.get_string_width(candidata) <= largura:
                atual = candidata
                continue
            if atual:
                linhas.append(atual)
                atual = ""
            # Palavra isolada maior que a célula: fatia até caber.
            while palavra and self.get_string_width(palavra) > largura:
                corte = max(1, len(palavra) - 1)
                while corte > 1 and self.get_string_width(palavra[:corte]) > largura:
                    corte -= 1
                linhas.append(palavra[:corte])
                palavra = palavra[corte:]
            atual = palavra
        if atual:
            linhas.append(atual)
        return linhas or [""]

    def _desenhar_cabecalho(self, nomes: list[str], larguras: list[float]):
        """Cabeçalho da tabela em linha única (branco sobre slate escuro)."""
        self.set_font("Arial", "B", 8.5)
        self.set_fill_color(15, 23, 42)
        self.set_text_color(255, 255, 255)
        for nome, w in zip(nomes, larguras, strict=True):
            self.cell(w, 7, f" {nome}", border=1, fill=True)
        self.ln()
        self.set_text_color(15, 23, 42)

    def _tabela(self, colunas: dict, linhas: list):
        """Tabela com quebra automática de texto por coluna.

        Cada linha cresce conforme a coluna mais alta (descrições longas não
        são truncadas nem vazam para fora da célula).
        """
        disponivel = self.w - self.l_margin - self.r_margin
        nomes = list(colunas.keys())
        escala = disponivel / sum(colunas.values())
        larguras = [w * escala for w in colunas.values()]

        self._desenhar_cabecalho(nomes, larguras)
        if not linhas:
            self.set_font("Arial", "I", 8.5)
            self.cell(sum(larguras), 7, " Nenhum registro.", border=1)
            self.ln()
            return

        self.set_font("Arial", "", 8.5)
        altura_linha = 4.8
        for i, linha in enumerate(linhas):
            celulas = []
            for valor, w in zip(linha, larguras, strict=True):
                texto = str(valor if valor is not None else "-")
                # FPDF core fonts são latin-1: evita erro com caracteres fora.
                texto = texto.encode("latin-1", "replace").decode("latin-1")
                celulas.append((self._quebrar_texto(texto, w - 2.2), w))
            altura = max(len(partes) for partes, _ in celulas) * altura_linha

            # Quebra de página: repete o cabeçalho quando a linha não couber.
            if self.get_y() + altura > self.page_break_trigger - 2:
                self.add_page()
                self._desenhar_cabecalho(nomes, larguras)
                self.set_font("Arial", "", 8.5)

            y_topo = self.get_y()
            x_inicio = self.l_margin
            largura_total = sum(larguras)
            preencher = i % 2 == 0

            # Fundo zebra da linha inteira.
            if preencher:
                self.set_fill_color(241, 245, 249)
                self.rect(x_inicio, y_topo, largura_total, altura, "F")

            # Grade em altura total: contorno da linha + separadores verticais.
            # Assim a descrição longa quebra dentro da célula sem criar um
            # contorno isolado e todas as colunas alinham na mesma altura.
            self.rect(x_inicio, y_topo, largura_total, altura, "D")
            x_sep = x_inicio
            for w in larguras[:-1]:
                x_sep += w
                self.line(x_sep, y_topo, x_sep, y_topo + altura)

            # Textos sem borda (a grade já foi desenhada), centralizados
            # verticalmente quando a célula ocupa menos linhas que a mais alta.
            x_col = x_inicio
            for partes, w in celulas:
                partes = partes or [""]
                deslocamento = (altura - len(partes) * altura_linha) / 2
                for j, parte in enumerate(partes):
                    self.set_xy(x_col, y_topo + deslocamento + j * altura_linha)
                    self.cell(w, altura_linha, f" {parte}")
                x_col += w

            self.set_y(y_topo + altura)
