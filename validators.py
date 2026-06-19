import re
from datetime import datetime
from typing import Optional

_cpf_re = re.compile(r"^\d{11}$")
_cnpj_re = re.compile(r"^\d{14}$")
_email_re = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

def is_valid_cpf(cpf: str) -> bool:
    """Validação simples de CPF (apenas formato)."""
    if not cpf:
        return False
    digits = re.sub(r"\D", "", cpf)
    return bool(_cpf_re.match(digits))

def is_valid_cnpj(cnpj: str) -> bool:
    """Validação simples de CNPJ (apenas formato)."""
    if not cnpj:
        return False
    digits = re.sub(r"\D", "", cnpj)
    return bool(_cnpj_re.match(digits))

def is_valid_email(email: str) -> bool:
    if not email:
        return False
    return bool(_email_re.match(email))

def parse_date_iso(date_str: str) -> Optional[datetime]:
    """Converte 'YYYY-MM-DD' para datetime, retorna None se inválido."""
    try:
        return datetime.strptime(date_str, "%Y-%m-%d")
    except Exception:
        return None
