"""Base reutilizável dos relatórios PDF do Controle de O.S (fpdf2).

Extraída da antiga `_RelatorioOS` (pdf_os.py) para que os novos relatórios
(obra e serviços por obra) usem o mesmo padrão visual — header/rodapé
slate-900, títulos de seção, quebra de texto e tabelas com zebra — sem
duplicação. A `_RelatorioOS` passa a herdar desta base SEM mudança visual.
"""

import os
import tempfile

from fpdf import FPDF

from utils.date_helpers import agora_fuso_brasil


def _novo_caminho_temp(prefixo: str, sufixo: str = ".pdf") -> str:
    """Caminho temporário ÚNICO (evita colisão entre requisições concorrentes
    que antes gravavam arquivos com nome fixo)."""
    fd, caminho = tempfile.mkstemp(prefix=prefixo, suffix=sufixo)
    os.close(fd)
    return caminho


class RelatorioBase(FPDF):
    """Página A4 com o padrão visual dos relatórios do módulo.

    Título/subtítulo do cabeçalho são atributos — cada relatório declara o
    seu (ex.: "RELATÓRIO DE ORDEM DE SERVIÇO", "RELATÓRIO DA OBRA").
    """

    titulo_documento: str = "RELATÓRIO"
    subtitulo_documento: str = "Munaretto & Co. - Controle de O.S"

    def header(self):
        self.set_fill_color(15, 23, 42)  # slate-900, padrão visual do app
        self.rect(0, 0, 210, 26, "F")
        self.set_font("Arial", "B", 15)
        self.set_text_color(255, 255, 255)
        self.cell(0, 12, self.titulo_documento, ln=True, align="C")
        self.set_font("Arial", "", 9)
        self.cell(0, 6, self.subtitulo_documento, ln=True, align="C")
        self.ln(6)

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

            preencher = i % 2 == 0
            if preencher:
                self.set_fill_color(241, 245, 249)
            y_topo = self.get_y()
            x_atual = self.l_margin
            for partes, w in celulas:
                x_col = x_atual
                x_atual += w
                if not partes:
                    partes = [""]
                total_partes = len(partes)
                for j, parte in enumerate(partes):
                    if total_partes == 1:
                        borda = "1"
                    elif j == total_partes - 1:
                        borda = "LRB"
                    else:
                        borda = "LR"
                    self.set_xy(x_col, y_topo + j * altura_linha)
                    self.cell(w, altura_linha, f" {parte}", border=borda, fill=preencher)
            self.set_y(y_topo + altura)
