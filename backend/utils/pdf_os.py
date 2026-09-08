"""Relatório PDF de execução da Ordem de Serviço (módulo Controle de O.S.).

Gera um documento com: identificação da O.S/obra/equipe, escopo, serviços
aplicados (USC/ULV) e contagem de evidências fotográficas. Mantém o
pdf_generator.py original intacto.

O layout (header/rodapé, seções e tabelas) vem de `pdf_base.RelatorioBase` —
esta classe declara apenas o título e o conteúdo específico da O.S.
"""

from utils.date_helpers import em_fuso_brasil
from utils.pdf_base import RelatorioBase, _novo_caminho_temp
from utils.tipos_os import unidade_contrato


class _RelatorioOS(RelatorioBase):
    titulo_documento = "RELATÓRIO DE ORDEM DE SERVIÇO"


def _fmt_data(iso: str) -> str:
    dt = em_fuso_brasil(iso)
    if dt is not None:
        return dt.strftime("%d/%m/%Y %H:%M")
    return str(iso or "-")


def _fmt_prazo(valor) -> str:
    """Prazo de entrega é DATE (sem hora): devolve dd/mm/aaaa."""
    texto = str(valor or "").strip()
    if len(texto) >= 10 and texto[4] == "-" and texto[7] == "-":
        return f"{texto[8:10]}/{texto[5:7]}/{texto[0:4]}"
    return texto or "-"


def gerar_pdf_os(
    os_data: dict,
    obra: dict,
    equipe: str | None = None,
    materiais: dict | None = None,
) -> str:
    """Monta o PDF da O.S e retorna o caminho temporário do arquivo.

    Layout atual: identificação, escopo e SERVIÇOS APLICADOS (USC/ULV).
    """
    materiais = materiais or {"itens": [], "total_aplicado": 0}

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
    pdf._linha_dado("Prazo de entrega", _fmt_prazo(os_data.get("prazo_entrega")))
    pdf._linha_dado("Encerramento", _fmt_data(os_data.get("data_fim")) if os_data.get("data_fim") else "-")

    pdf._titulo_secao("ESCOPO DO SERVIÇO")
    pdf.set_font("Arial", "", 9)
    pdf.multi_cell(
        0, 5.5, (os_data.get("descricao_escopo") or "Não informado.").encode("latin-1", "replace").decode("latin-1")
    )

    # --- Serviços aplicados ---------------------------------------------------
    # Unidade de valor por contrato: Construção = USC; Manutenção/Linha Viva = ULV.
    unidade = unidade_contrato(os_data.get("tipo"))
    pdf._titulo_secao(f"SERVIÇOS APLICADOS ({unidade})")

    rotulos_tipo = {"normal": f"{unidade} normal", "especial": f"{unidade} especial"}

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
                    f"{float(d.get('total') or 0):g}",
                ]
            )
        # Legado: sem detalhe (dados antigos), mantém apenas o total real.
        if not linhas and float(item.get("aplicado") or 0) > 0:
            linhas.append(["—", item.get("nome") or "Produto", "—", "—", f"{float(item['aplicado']):g}"])
        return linhas

    linhas_mat = [linha for item in materiais.get("itens", []) for linha in _linha_material(item)]
    # Larguras relativas (escaladas para caber nos 190 mm): Produto largo com
    # quebra automática; colunas curtas de quantidade/unidade estreitas.
    pdf._tabela(
        {"Cod.": 15, "Produto": 66, "Qtd serv.": 15, f"{unidade} unit.": 24, "Total": 25},
        linhas_mat,
    )
    pdf.set_font("Arial", "B", 9)
    pdf.cell(
        0,
        7,
        f"Total aplicado: {materiais.get('total_aplicado', 0):g}",
        ln=True,
    )

    caminho_temp = _novo_caminho_temp("os_relatorio_")
    pdf.output(caminho_temp)
    return caminho_temp
