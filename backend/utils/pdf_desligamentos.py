"""Agenda de Desligamentos (Celesc) em PDF.

Lista consolidada dos desligamentos registrados (um por O.S), no mesmo layout
da planilha de acompanhamento: DATA, LOCAL, NOTA PS, MUNICÍPIO, EQUIPE e
HORÁRIO. A equipe concatena a principal (da O.S) com as equipes de apoio.
"""

import logging
import os
import tempfile

from utils.pdf_base import RelatorioBase

logger = logging.getLogger(__name__)


def _fmt_data(valor) -> str:
    """'YYYY-MM-DD' -> 'DD/MM/YYYY' (vazio quando nulo)."""
    if not valor:
        return "-"
    texto = str(valor)[:10]
    if len(texto) == 10:
        return f"{texto[8:10]}/{texto[5:7]}/{texto[0:4]}"
    return texto


def _fmt_hora(valor) -> str:
    """'HH:MM:SS' -> 'HH:MM' (vazio quando nulo)."""
    if not valor:
        return ""
    return str(valor)[:5]


def _horario(registro: dict) -> str:
    desligar = _fmt_hora(registro.get("hora_desligar"))
    religar = _fmt_hora(registro.get("hora_religar"))
    if not desligar and not religar:
        return "-"
    return f"{desligar or '__:__'} - {religar or '__:__'}"


def _equipe(registro: dict) -> str:
    """Equipe principal + equipes de apoio, sem repetição (ex.: 'A + B')."""
    nomes: list[str] = []
    if registro.get("equipe_nome"):
        nomes.append(str(registro["equipe_nome"]))
    for apoio in registro.get("equipes_apoio") or []:
        nome = apoio.get("equipe_nome")
        if nome and str(nome) not in nomes:
            nomes.append(str(nome))
    return " + ".join(nomes) or "-"


class _AgendaDesligamentos(RelatorioBase):
    titulo_documento = "AGENDA DE DESLIGAMENTOS"


def gerar_pdf_agenda_desligamentos(registros: list[dict], periodo: str = "") -> str:
    """Gera o PDF da agenda e devolve o caminho temporário do arquivo."""
    pdf = _AgendaDesligamentos()
    pdf.subtitulo_documento = f"Munaretto Eletrificações - {periodo}" if periodo else "Munaretto Eletrificações"
    pdf.add_page()

    pdf._titulo_secao(f"Desligamentos agendados ({len(registros)})")

    colunas = {
        "DATA": 12,
        "LOCAL": 30,
        "NOTA PS": 15,
        "MUNICÍPIO": 18,
        "EQUIPE": 30,
        "HORÁRIO": 15,
    }
    linhas = [
        [
            _fmt_data(r.get("data")),
            r.get("local") or "-",
            r.get("projeto_sap") or "-",
            r.get("municipio") or "-",
            _equipe(r),
            _horario(r),
        ]
        for r in registros
    ]
    pdf._tabela(colunas, linhas)

    fd, caminho = tempfile.mkstemp(prefix="agenda_desligamentos_", suffix=".pdf")
    os.close(fd)
    pdf.output(caminho)
    logger.info("Agenda de Desligamentos gerada em %s (%d registros)", caminho, len(registros))
    return caminho
