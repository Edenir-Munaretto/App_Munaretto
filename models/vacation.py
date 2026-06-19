from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import List
import formatting


@dataclass
class Vacation:
    nome: str
    data_inicio: date
    dias_abono: int
    dias_gozo: int
    data_retorno: date
    data_limite: date
    status: str = "Agendado"


class VacationManager:
    @staticmethod
    def calculate_return_date(start_date: date, dias_gozo: int) -> date:
        return formatting.add_business_days(start_date, dias_gozo)

    @staticmethod
    def overlaps(start1: date, end1: date, start2: date, end2: date) -> bool:
        return start1 <= end2 and start2 <= end1

    @staticmethod
    def days_between_business(start_date: date, end_date: date) -> int:
        delta = 0
        current = start_date
        while current <= end_date:
            if current.weekday() < 5:
                delta += 1
            current = current + timedelta(days=1)
        return delta
