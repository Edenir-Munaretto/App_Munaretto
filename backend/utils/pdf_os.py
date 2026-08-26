"""Relatório PDF de execução da Ordem de Serviço (módulo Controle de O.S.).

Gera um documento com: identificação da O.S/obra/equipe, escopo, linha do
tempo de status, comparativo Materiais Aplicados vs. Orçados e mão de obra
apontada (horas x valor/hora). Mantém o pdf_generator.py original intacto.
"""

import os
import tempfile
from datetime import datetime

from fpdf import FPDF


class _RelatorioOS(FPDF):
    def header(self):
        self.set_fill_color(15, 23, 42)  # slate-900, padrão visual do app
        self.rect(0, 0, 210, 26, "F")
        self.set_font("Arial", "B", 15)
        self.set_text_color(255, 255, 255)
        self.cell(0, 12, "RELATÓRIO DE ORDEM DE SERVIÇO", ln=True, align="C")
        self.set_font("Arial", "", 9)
        self.cell(0, 6, "Munaretto & Co. - Controle de O.S", ln=True, align="C")
        self.ln(6)

    def footer(self):
        self.set_y(-15)
        self.set_font("Arial", "I", 8)
        self.set_text_color(128, 128, 128)
        self.cell(0, 10, f"Gerado em {datetime.now().strftime('%d/%m/%Y %H:%M')} - Página {self.page_no()}", align="C")

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

    def _tabela(self, colunas: dict, linhas: list):
        larguras = list(colunas.values())
        escala = 190 / sum(larguras)
        larguras = [w * escala for w in larguras]

        self.set_font("Arial", "B", 8.5)
        self.set_fill_color(15, 23, 42)
        self.set_text_color(255, 255, 255)
        for (nome, _), w in zip(colunas.items(), larguras, strict=True):
            self.cell(w, 7, f" {nome}", border=1, fill=True)
        self.ln()
        self.set_text_color(15, 23, 42)

        if not linhas:
            self.set_font("Arial", "I", 8.5)
            total = sum(larguras)
            self.cell(total, 7, " Nenhum registro.", border=1)
            self.ln()
            return

        self.set_font("Arial", "", 8.5)
        for i, linha in enumerate(linhas):
            fill = i % 2 == 0
            if fill:
                self.set_fill_color(241, 245, 249)
            for valor, w in zip(linha, larguras, strict=True):
                texto = str(valor if valor is not None else "-")
                # FPDF core fonts são latin-1: evita erro com caracteres fora.
                texto = texto.encode("latin-1", "replace").decode("latin-1")
                self.cell(w, 7, f" {texto[:60]}", border=1, fill=fill)
            self.ln()


def _fmt_data(iso: str) -> str:
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).strftime("%d/%m/%Y %H:%M")
    except Exception:
        return str(iso or "-")


def gerar_pdf_os(
    os_data: dict,
    obra: dict,
    equipe: str | None = None,
    historico: list | None = None,
    materiais: dict | None = None,
    mao_de_obra: dict | None = None,
    quantidade_fotos: int = 0,
) -> str:
    """Monta o PDF da O.S e retorna o caminho temporário do arquivo."""
    historico = historico or []
    materiais = materiais or {"itens": [], "total_orcado_rs": 0, "total_aplicado_rs": 0}
    mao_de_obra = mao_de_obra or {}

    def brl(valor) -> str:
        return f"R$ {float(valor or 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

    pdf = _RelatorioOS()
    pdf.add_page()

    # --- Identificação -------------------------------------------------------
    pdf._titulo_secao("IDENTIFICAÇÃO")
    cliente = (
        (obra.get("clientes") or {}).get("nome") if isinstance(obra.get("clientes"), dict) else obra.get("clientes")
    )
    pdf._linha_dado("Ordem de Serviço", os_data.get("codigo"))
    pdf._linha_dado("Obra", obra.get("nome"))
    pdf._linha_dado("Cliente", cliente)
    pdf._linha_dado("Equipe responsável", equipe)
    pdf._linha_dado("Status atual", (os_data.get("status") or "").upper())
    prioridades = {"baixa": "Baixa", "media": "Média", "alta": "Alta", "critica": "Crítica"}
    pdf._linha_dado("Prioridade", prioridades.get(os_data.get("prioridade"), os_data.get("prioridade")))
    pdf._linha_dado("Abertura", _fmt_data(os_data.get("data_abertura")))
    prazo = os_data.get("prazo_entrega")
    pdf._linha_dado("Prazo de entrega", prazo.strftime("%d/%m/%Y") if hasattr(prazo, "strftime") else (prazo or "-"))
    pdf._linha_dado("Encerramento", _fmt_data(os_data.get("data_fim")) if os_data.get("data_fim") else "-")

    pdf._titulo_secao("ESCOPO DO SERVIÇO")
    pdf.set_font("Arial", "", 9)
    pdf.multi_cell(
        0, 5.5, (os_data.get("descricao_escopo") or "Não informado.").encode("latin-1", "replace").decode("latin-1")
    )

    # --- Linha do tempo ------------------------------------------------------
    pdf._titulo_secao("LINHA DO TEMPO / HISTÓRICO DE STATUS")
    rotulos_status = {
        "rascunho": "Rascunho",
        "aberta": "Aberta",
        "em_andamento": "Em Andamento",
        "impedida": "Impedida",
        "concluida": "Concluída",
        "cancelada": "Cancelada",
    }
    linhas_hist = []
    for h in historico:
        de = rotulos_status.get(h.get("status_anterior"), "-") if h.get("status_anterior") else "-"
        para = rotulos_status.get(h.get("status_novo"), h.get("status_novo"))
        linhas_hist.append(
            [
                _fmt_data(h.get("criado_em")),
                f"{de} -> {para}",
                h.get("justificativa") or "",
                h.get("usuario_alteracao") or "",
            ]
        )
    pdf._tabela({"Data/Hora": 30, "Transição": 45, "Justificativa": 70, "Usuário": 40}, linhas_hist)

    # --- Materiais -----------------------------------------------------------
    pdf._titulo_secao("MATERIAIS APLICADOS vs. ORÇADOS")
    linhas_mat = [
        [
            item.get("nome"),
            f"{item.get('orcado', 0):g} {item.get('unidade', '')}",
            f"{item.get('aplicado', 0):g} {item.get('unidade', '')}",
            f"{item['perc_aplicado']}%" if item.get("perc_aplicado") is not None else "-",
            brl(item.get("custo_aplicado")),
        ]
        for item in materiais.get("itens", [])
    ]
    pdf._tabela({"Produto": 55, "Orçado": 25, "Aplicado": 25, "%": 15, "Custo aplicado": 35}, linhas_mat)
    pdf.set_font("Arial", "B", 9)
    pdf.cell(
        0,
        7,
        (
            f"Total orçado: {brl(materiais.get('total_orcado_rs'))}   |   "
            f"Total aplicado: {brl(materiais.get('total_aplicado_rs'))}"
        ),
        ln=True,
    )

    # --- Mão de obra ---------------------------------------------------------
    pdf._titulo_secao("MÃO DE OBRA (H.H.)")
    linhas_mo = [
        [f.get("nome"), f"{f.get('minutos', 0) / 60:.2f} h", brl(f.get("custo"))]
        for f in (mao_de_obra.get("por_funcionario") or [])
    ]
    pdf._tabela({"Colaborador": 80, "Horas trabalhadas": 50, "Custo real": 40}, linhas_mo)
    pdf.set_font("Arial", "B", 9)
    pdf.cell(
        0,
        7,
        (
            f"Total de horas: {mao_de_obra.get('total_horas', 0)} h   |   "
            f"Custo real de M.O.: {brl(mao_de_obra.get('custo_mo_real'))}   |   "
            f"M.O. orçada: {brl(mao_de_obra.get('custo_mo_orcado'))}"
        ),
        ln=True,
    )
    pdf.set_font("Arial", "", 8.5)
    pdf.cell(0, 6, f"Evidências fotográficas anexadas à O.S: {quantidade_fotos}", ln=True)

    nome_arquivo = f"os_{os_data.get('codigo', 'relatorio')}.pdf".replace("-", "_").replace("/", "_")
    caminho_temp = os.path.join(tempfile.gettempdir(), nome_arquivo)
    pdf.output(caminho_temp)
    return caminho_temp
