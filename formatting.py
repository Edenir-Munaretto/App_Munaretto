from datetime import datetime, date, timedelta
import locale

try:
    locale.setlocale(locale.LC_ALL, "pt_BR.UTF-8")
except Exception:
    # Ambiente Windows pode não ter locale; funções abaixo lidam com formatação básica
    pass

def date_to_br(d: datetime) -> str:
    return d.strftime("%d/%m/%Y")

def parse_iso(date_str: str) -> datetime:
    return datetime.strptime(date_str, "%Y-%m-%d")

def format_money_br(value: float) -> str:
    try:
        return f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except Exception:
        return str(value)

def add_business_days(start_date: date, business_days: int) -> date:
    current = start_date
    days_added = 0
    step = 1 if business_days >= 0 else -1
    business_days = abs(business_days)
    while days_added < business_days:
        current = current + timedelta(days=step)
        if current.weekday() < 5:  # 0-4 == Mon-Fri
            days_added += 1
    return current
