"""Relatórios PDF por Obra (gestão consolidada — Fase 1).

Dois documentos independentes:
- `gerar_pdf_obra`: relatório da obra — identificação, tabela das O.S do
  filtro selecionado e totais por contrato (unidade no título);
- `gerar_pdf_servicos_obra`: serviços consolidados por contrato (com nº de
  O.S usadas, quantidade de serviço, unidade unitária quando uniforme e
  total).

Ambos usam a base visual de `pdf_base.RelatorioBase` e os dados já
consolidados por `utils/resumo_obra.py` / endpoint de resumo da obra.
"""

from utils.date_helpers import em_fuso_brasil
from utils.pdf_base import RelatorioBase, _novo_caminho_temp
from utils.tipos_os import ROTULOS_TIPO, unidade_contrato

ROTULOS_FILTRO = {"todas": "Todas", "ativas": "Em execução", "encerradas": "Encerradas"}


class _RelatorioObra(RelatorioBase):
    titulo_documento = "RELATÓRIO DA OBRA"


class _RelatorioServicosObra(RelatorioBase):
    titulo_documento = "SERVIÇOS POR OBRA"


def _fmt_data(iso) -> str:
    """Data por extenso no padrão do app; mantém o valor cru se não parsear."""
    dt = em_fuso_brasil(iso) if iso else None
    if dt is not None:
        return dt.strftime("%d/%m/%Y")
    return str(iso or "-")


def _cliente_da_obra(obra: dict) -> str:
    cliente = (
        (obra.get("clientes") or {}).get("nome") if isinstance(obra.get("clientes"), dict) else obra.get("clientes")
    )
    return cliente or obra.get("cliente_celesc") or "-"


def _fmt_filtro(filtro: str | None) -> str:
    return ROTULOS_FILTRO.get(filtro or "todas", filtro or "todas")


def _fmt_periodo(resumo: dict | None) -> str:
    periodo = (resumo or {}).get("periodo") or {}
    inicio = _fmt_data(periodo.get("inicio")) if periodo.get("inicio") else None
    fim = _fmt_data(periodo.get("fim")) if periodo.get("fim") else None
    if inicio and fim and inicio != fim:
        return f"{inicio} a {fim}"
    if fim:
        return f"até {fim}"
    if inicio:
        return f"desde {inicio}"
    return "-"


def _identificacao(pdf: RelatorioBase, obra: dict, filtro: str | None, resumo: dict | None):
    """Bloco de abertura comum aos dois relatórios."""
    pdf._titulo_secao("IDENTIFICAÇÃO")
    pdf._linha_dado("Obra", obra.get("nome"))
    pdf._linha_dado("Cliente", _cliente_da_obra(obra))
    if obra.get("endereco"):
        pdf._linha_dado("Endereço", obra.get("endereco"))
    if obra.get("cidade"):
        pdf._linha_dado("Cidade", obra.get("cidade"))
    pdf._linha_dado("Filtro aplicado", _fmt_filtro(filtro))
    pdf._linha_dado("Período", _fmt_periodo(resumo))


def gerar_pdf_obra(obra: dict, os_linhas: list[dict], contratos: list[dict], filtro: str = "todas", resumo=None) -> str:
    """Relatório da obra: capa/identificação + O.S do filtro + totais por contrato."""
    pdf = _RelatorioObra()
    pdf.add_page()
    _identificacao(pdf, obra, filtro, resumo)

    pdf._titulo_secao(f"O.S DA OBRA ({len(os_linhas)})")
    if not os_linhas:
        pdf._aviso_sem_dados("Nenhuma O.S vinculada a esta obra com o filtro selecionado.")
    else:
        linhas = []
        for os_row in os_linhas:
            tipo = os_row.get("tipo") or "construcao"
            unidade = unidade_contrato(tipo)
            total = float(os_row.get("total_aplicado") or 0)
            linhas.append(
                [
                    (os_row.get("codigo") or "").strip() or "—",
                    ROTULOS_TIPO.get(tipo, tipo),
                    (os_row.get("status") or "").upper(),
                    _fmt_data(os_row.get("data_abertura")),
                    _fmt_data(os_row.get("data_fim")),
                    f"{total:g} {unidade}" if total else "—",
                ]
            )
        pdf._tabela(
            {"Cód.": 24, "Tipo": 24, "Status": 30, "Abertura": 24, "Encerramento": 24, "Total": 34},
            linhas,
        )

    pdf._titulo_secao("TOTAIS POR CONTRATO")
    if not contratos:
        pdf._aviso_sem_dados("Nenhum serviço aplicado nas O.S consideradas.")
    for contrato in contratos:
        rotulo = ROTULOS_TIPO.get(contrato["tipo"], contrato["tipo"])
        unidade = contrato.get("unidade") or unidade_contrato(contrato["tipo"])
        pdf._linha_dado(f"{rotulo} ({unidade})", f"{float(contrato.get('total') or 0):g}")

    caminho = _novo_caminho_temp("obra_relatorio_")
    pdf.output(caminho)
    return caminho


def gerar_pdf_servicos_obra(obra: dict, contratos: list[dict], filtro: str = "todas", resumo=None) -> str:
    """Serviços consolidados por contrato (O.S usadas, qtd, unidade e total)."""
    pdf = _RelatorioServicosObra()
    pdf.add_page()
    _identificacao(pdf, obra, filtro, resumo)

    pdf._titulo_secao("SERVIÇOS DA OBRA")
    if not contratos:
        pdf._aviso_sem_dados("Nenhuma O.S com serviços lançados para o filtro selecionado.")
    for contrato in contratos:
        rotulo = ROTULOS_TIPO.get(contrato["tipo"], contrato["tipo"])
        unidade = contrato.get("unidade") or unidade_contrato(contrato["tipo"])
        pdf._titulo_secao(f"SERVIÇOS - {rotulo.upper()} ({unidade})")

        linhas = []
        for item in contrato.get("itens", []):
            nome = item.get("nome") or "Serviço"
            if item.get("tipo") != "normal":
                nome = f"{nome} (especial)"
            pecas = float(item.get("pecas") or 0)
            fator = item.get("fator")
            linhas.append(
                [
                    (item.get("codigo_servico") or "").strip() or "—",
                    nome,
                    f"{int(item.get('os_usadas') or 0)}",
                    f"{pecas:g}" if pecas else "—",
                    f"{float(fator):g}" if fator else "—",
                    f"{float(item.get('total') or 0):g}",
                ]
            )
        pdf._tabela(
            {
                "Cód.": 18,
                "Serviço": 60,
                "O.S usadas": 20,
                "Qtd serv.": 16,
                f"{unidade} unit.": 22,
                "Total": 24,
            },
            linhas,
        )
        pdf.set_font("Arial", "B", 9)
        pdf.cell(0, 7, f"Total {rotulo}: {float(contrato.get('total') or 0):g} {unidade}", ln=True)

    caminho = _novo_caminho_temp("obra_servicos_")
    pdf.output(caminho)
    return caminho
