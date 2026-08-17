"""Funções utilitárias de data compartilhadas entre os módulos do backend.

Centraliza a lógica de parse e cálculo de status de vencimento que estava
duplicada em sst.py, dashboard.py e ferias.py.
"""
from datetime import date, datetime
from typing import Optional


DIAS_AVISO = 30

STATUS_VIGENTE = "Vigente"
STATUS_PROXIMO = "Próximo ao Vencimento"
STATUS_VENCIDO = "Vencido"
STATUS_SEM_VALIDADE = "Sem validade"


def hoje() -> date:
    """Retorna a data atual. Função isolada para facilitar testes unitários."""
    return date.today()


def parse_data(valor) -> Optional[date]:
    """Converte string 'YYYY-MM-DD' ou objeto date/datetime para date.
    
    Retorna None se o valor for inválido ou ausente.
    """
    if valor is None:
        return None
    if isinstance(valor, date) and not isinstance(valor, datetime):
        return valor
    if isinstance(valor, datetime):
        return valor.date()
    try:
        return datetime.strptime(str(valor), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def status_vencimento(data_validade, dias_aviso: int = DIAS_AVISO) -> str:
    """Classifica a situação de um documento/prazo a partir da data de validade.

    Returns:
        "Vigente"                — validade OK, faltam mais de `dias_aviso` dias
        "Próximo ao Vencimento"  — faltam até `dias_aviso` dias
        "Vencido"                — validade já passou
        "Sem validade"           — data ausente ou inválida
    """
    d = parse_data(data_validade)
    if d is None:
        return STATUS_SEM_VALIDADE
    dias = (d - hoje()).days
    if dias < 0:
        return STATUS_VENCIDO
    if dias <= dias_aviso:
        return STATUS_PROXIMO
    return STATUS_VIGENTE
