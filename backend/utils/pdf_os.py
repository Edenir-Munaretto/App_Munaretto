"""Relatório PDF de execução da Ordem de Serviço (módulo Controle de O.S.).

Gera um documento com: identificação da O.S/obra/equipe, escopo, linha do
tempo de status, materiais aplicados (USC normal/especial) e mão de obra
apontada (horas x valor/hora). Mantém o pdf_generator.py original intacto.
"""

import os
import tempfile

from fpdf import FPDF

from utils.date_helpers import agora_fuso_brasil, em_fuso_brasil


def _novo_caminho_temp(prefixo: str, sufixo: str = ".pdf") -> str:
    """Caminho temporário ÚNICO (evita colisão entre requisições concorrentes
    que antes gravavam `os_<codigo>.pdf` fixo no mesmo arquivo)."""
    fd, caminho = tempfile.mkstemp(prefix=prefixo, suffix=sufixo)
    os.close(fd)
    return caminho


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
    dt = em_fuso_brasil(iso)
    if dt is not None:
        return dt.strftime("%d/%m/%Y %H:%M")
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
    materiais = materiais or {"itens": [], "total_aplicado": 0}
    mao_de_obra = mao_de_obra or {}

    def brl(valor) -> str:
        return f"R$ {float(valor or 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

    pdf = _RelatorioOS()
    pdf.add_page()

    # --- Identificação -------------------------------------------------------
    pdf._titulo_secao("IDENTIFICAÇÃO")
    cliente = (
        (obra.get("clientes") or {}).get("nome") if isinstance(obra.get("clientes"), dict) else obra.get("clientes")
    ) or obra.get("cliente_celesc") or ""
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
    pdf._titulo_secao("MATERIAIS APLICADOS (USC)")

    rotulos_tipo = {"normal": "USC normal", "especial": "USC especial"}

    def _linha_material(item):
        """Uma linha por (produto, tipo, fator) registrado no lançamento."""
        linhas = []
        for d in item.get("detalhe") or []:
            nome = item.get("nome") or "Produto"
            if d.get("tipo") != "normal":
                nome = f"{nome} ({rotulos_tipo.get(d.get('tipo'), d.get('tipo'))})"
            pecas = float(d.get("pecas") or 0)
            fator = float(d.get("fator") or 0)
            linhas.append(
                [
                    (d.get("codigo_servico") or "").strip() or "—",
                    nome,
                    f"{pecas:g}" if pecas > 0 else "—",
                    f"{fator:g}" if fator > 0 else "—",
                    f"{float(d.get('total') or 0):g} USC",
                ]
            )
        # Legado: sem detalhe (dados antigos), mantém apenas o total real.
        if not linhas and float(item.get("aplicado") or 0) > 0:
            linhas.append(["—", item.get("nome") or "Produto", "—", "—", f"{float(item['aplicado']):g} USC"])
        return linhas

    linhas_mat = [linha for item in materiais.get("itens", []) for linha in _linha_material(item)]
    pdf._tabela(
        {"Cod.": 16, "Produto": 48, "Qtd serviços": 25, "USC unit.": 27, "Total USC": 34},
        linhas_mat,
    )
    pdf.set_font("Arial", "B", 9)
    pdf.cell(
        0,
        7,
        f"Total aplicado: {materiais.get('total_aplicado', 0):g} USC",
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

    caminho_temp = _novo_caminho_temp("os_relatorio_")
    pdf.output(caminho_temp)
    return caminho_temp
