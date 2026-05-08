import os
import tempfile
from fpdf import FPDF
from datetime import datetime

class RelatorioSocio(FPDF):
    def header(self):
        self.set_fill_color(26, 54, 104)
        self.rect(0, 0, 210, 40, 'F')
        self.set_font("Arial", 'B', 18)
        self.set_text_color(255, 255, 255)
        self.cell(0, 15, "RELATÓRIO DE FECHAMENTO MENSAL", ln=True, align='C')
        self.set_font("Arial", 'B', 12)
        self.cell(0, 5, f"Usinas Solar - Ouro Energia", ln=True, align='C')
        self.ln(20)

    def footer(self):
        self.set_y(-15)
        self.set_font("Arial", 'I', 8)
        self.set_text_color(128, 128, 128)
        self.cell(0, 10, f"Gerado em {datetime.now().strftime('%d/%m/%Y')} - Página {self.page_no()}", align='C')

    def criar_tabela_financeira(self, titulo, dados, cor_header):
        self.set_font("Arial", 'B', 12)
        self.set_text_color(0, 0, 0)
        self.cell(0, 10, titulo, ln=True)
        self.set_fill_color(*cor_header)
        self.set_text_color(255, 255, 255)
        self.set_font("Arial", 'B', 10)
        self.cell(140, 8, " Descrição", border=1, fill=True)
        self.cell(50, 8, " Valor (R$)", border=1, fill=True, align='C')
        self.ln()
        self.set_text_color(0, 0, 0)
        self.set_font("Arial", '', 10)
        for desc, valor in dados.items():
            self.cell(140, 8, f" {desc}", border=1)
            self.cell(50, 8, f" {valor:>10}", border=1, align='R')
            self.ln()
        self.ln(5)

def gerar_pdf_mensal(mes_ref, dados_usinas, dados_despesas, total_liquido, nome_arquivo="relatorio_mensal.pdf"):
    pdf = RelatorioSocio()
    pdf.add_page()

    # Funções Auxiliares
    parse_valor = lambda v: float(str(v).replace('.', '').replace(',', '.'))
    formatar = lambda v: f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

    pdf.set_font("Arial", 'B', 12)
    pdf.cell(0, 10, f"PERÍODO DE REFERÊNCIA: {mes_ref}", ln=True)
    pdf.ln(5)

    # 1. Rendimentos
    pdf.criar_tabela_financeira("RENDIMENTOS DE PRODUÇÃO", dados_usinas, (46, 139, 87))
    total_rend = sum(parse_valor(v) for v in dados_usinas.values())
    pdf.set_font("Arial", 'B', 10)
    pdf.set_fill_color(230, 245, 230)
    pdf.cell(140, 8, " TOTAL RENDIMENTOS", border=1, fill=True)
    pdf.cell(50, 8, f" R$ {formatar(total_rend)}", border=1, fill=True, align='C')
    pdf.ln(15)

    # 2. Despesas
    pdf.criar_tabela_financeira("DESPESAS OPERACIONAIS", dados_despesas, (178, 34, 34))
    total_desp = sum(parse_valor(v) for v in dados_despesas.values())
    pdf.set_font("Arial", 'B', 10)
    pdf.set_fill_color(255, 240, 240)
    pdf.cell(140, 8, " TOTAL DESPESAS", border=1, fill=True)
    pdf.cell(50, 8, f" R$ {formatar(total_desp)}", border=1, fill=True, align='C')

    # 3. Saldo Líquido (Com espaçamento de 20 solicitado)
    pdf.ln(20)
    pdf.set_fill_color(240, 240, 240)
    pdf.set_font("Arial", 'B', 14)
    pdf.cell(140, 15, " SALDO LÍQUIDO DISPONÍVEL", border=1, fill=True)
    pdf.set_text_color(0, 100, 0)
    pdf.cell(50, 15, f" R$ {total_liquido}", border=1, fill=True, align='C')
    pdf.set_text_color(0, 0, 0)

    # 4. Tabela de Sócios
    pdf.ln(20)
    valor_num = parse_valor(total_liquido)
    socios = {
        "Demarco (25%)": formatar(valor_num * 0.25),
        "Marlene (30%)": formatar(valor_num * 0.30),
        "João B. (30%)": formatar(valor_num * 0.30),
        "Nei Rigo (10%)": formatar(valor_num * 0.10),
        "Gilmar T. (5%)": formatar(valor_num * 0.05)
    }
    pdf.criar_tabela_financeira("DISTRIBUIÇÃO DE LUCROS (TODOS OS SÓCIOS)", socios, (26, 54, 104))

    caminho_temp = os.path.join(tempfile.gettempdir(), nome_arquivo)
    pdf.output(caminho_temp)
    return caminho_temp

def gerar_pdf_socio_especifico(socio_alvo, mes_ref, dados_usinas, dados_despesas, total_liquido):
    pdf = RelatorioSocio()
    pdf.add_page()

    # Funções Auxiliares de Formatação
    parse_valor = lambda v: float(str(v).replace('.', '').replace(',', '.'))
    formatar = lambda v: f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

    # 1. Informações de Cabeçalho Local
    pdf.set_font("Arial", 'B', 12)
    pdf.cell(0, 10, f"PERÍODO: {mes_ref}", ln=True)
    pdf.cell(0, 10, f"SÓCIO: {socio_alvo}", ln=True)
    pdf.ln(5)

    # 2. Tabelas de Produção e Despesas
    # Rendimentos + Totalizadores
    pdf.criar_tabela_financeira("RENDIMENTOS DE PRODUÇÃO", dados_usinas, (46, 139, 87))
    total_rend = sum(parse_valor(v) for v in dados_usinas.values())
    pdf.set_font("Arial", 'B', 10)
    pdf.set_fill_color(230, 245, 230)
    pdf.cell(140, 8, " TOTAL RENDIMENTOS", border=1, fill=True)
    pdf.cell(50, 8, f" R$ {formatar(total_rend)}", border=1, fill=True, align='C')
    pdf.ln(15)

    # Despesas + Totalizadores
    pdf.criar_tabela_financeira("DESPESAS OPERACIONAIS", dados_despesas, (178, 34, 34))
    total_desp = sum(parse_valor(v) for v in dados_despesas.values())
    pdf.set_font("Arial", 'B', 10)
    pdf.set_fill_color(255, 240, 240)
    pdf.cell(140, 8, " TOTAL DESPESAS", border=1, fill=True)
    pdf.cell(50, 8, f" R$ {formatar(total_desp)}", border=1, fill=True, align='C')
    
    # 3. Cálculo da Divisão Fixa
    valor_num = parse_valor(total_liquido)
    SOCIOS_REGRAS = {
        "Demarco": 0.25,
        "Marlene": 0.30,
        "João B.": 0.30,
        "Nei Rigo": 0.10,
        "Gilmar T.": 0.05
    }

    # 4. Destaque do Sócio Escolhido
    porcentagem = SOCIOS_REGRAS.get(socio_alvo, 0)
    valor_socio = valor_num * porcentagem

    # 4. Saldo Líquido e Cota-parte (Igual ao geral com 20 de espaço)
    pdf.ln(20)
    pdf.set_fill_color(240, 240, 240)
    pdf.set_font("Arial", 'B', 14)
    pdf.cell(140, 15, " TOTAL LÍQUIDO DA USINA", border=1, fill=True)
    pdf.set_text_color(0, 100, 0)
    pdf.cell(50, 15, f" R$ {total_liquido}", border=1, fill=True, align='C')
    pdf.ln()
    
    pdf.set_text_color(255, 255, 255)
    pdf.set_fill_color(26, 54, 104)
    pdf.cell(140, 15, f" COTA-PARTE: {socio_alvo} ({int(porcentagem*100)}%)", border=1, fill=True)
    pdf.cell(50, 15, f" R$ {formatar(valor_socio)}", border=1, fill=True, align='C')

    nome_arquivo = f"Relatorio_{socio_alvo}_{mes_ref.replace('/', '-')}.pdf"
    caminho_temp = os.path.join(tempfile.gettempdir(), nome_arquivo)
    pdf.output(caminho_temp)
    return caminho_temp

# --- EXEMPLO DE ACIONAMENTO ---
if __name__ == "__main__":
    u = {"Usina 01": "3.500,00", "Usina 02": "4.200,00", "Usina 03": "1.850,00"}
    d = {"Contabilidade": "250,00", "Internet": "120,00", "Impostos": "680,00"}
    
    # Simulação de escolha no programa
    gerar_pdf_socio_especifico("Demarco", "Maio/2024", u, d, "8.500,00")
