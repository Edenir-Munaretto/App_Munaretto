import logging
import os
import time
from collections.abc import Callable
from typing import Any

from dotenv import load_dotenv
from postgrest.exceptions import APIError
from supabase import Client, create_client

# Carrega arquivo .env se existir
load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("⚠️ AVISO: SUPABASE_URL ou SUPABASE_KEY não configurados no arquivo .env!")

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Retry com backoff exponencial (item 5.3 do plano)
# ---------------------------------------------------------------------------

MAX_TENTATIVAS = 3
BASE_ATRASO = 0.5  # segundos


def _erro_transitorio(err: Exception) -> bool:
    """Retorna True se o erro deve ser repetido (rede / 5xx).

    Erros de negócio retornados pela API (4xx, ex: conflito de chave única)
    não devem ser repetidos automaticamente.
    """
    if isinstance(err, APIError):
        return err.status_code is not None and err.status_code >= 500
    return not isinstance(err, (ValueError, TypeError))


def _com_retry(fn: Callable[..., Any], *args, **kwargs):
    """Executa fn com tentativas e backoff exponencial em erros transitórios."""
    ultimo_erro: Exception | None = None
    for tentativa in range(MAX_TENTATIVAS):
        try:
            return fn(*args, **kwargs)
        except Exception as err:
            ultimo_erro = err
            if not _erro_transitorio(err) or tentativa >= MAX_TENTATIVAS - 1:
                raise
            atraso = BASE_ATRASO * (2**tentativa)
            logger.warning(
                "Falha transitória no Supabase (tentativa %d/%d): %s. Nova tentativa em %.1fs",
                tentativa + 1,
                MAX_TENTATIVAS,
                err,
                atraso,
            )
            time.sleep(atraso)
    raise ultimo_erro  # pragma: no cover


class _RetryProxy:
    """Proxy do cliente Supabase que aplica retry na chamada final `.execute()`.

    Como a comunicação com o banco acontece no `.execute()` (encadeado após
    `table().insert().update()` etc.), o proxy intercepta apenas esse método e
    reaproveita a cadeia de builders normalmente.
    """

    def __init__(self, alvo: Any):
        object.__setattr__(self, "_alvo", alvo)

    def __getattr__(self, nome: str) -> Any:
        alvo = object.__getattribute__(self, "_alvo")
        atributo = getattr(alvo, nome)
        if nome == "execute" and callable(atributo):
            return lambda *a, **k: _com_retry(atributo, *a, **k)
        if callable(atributo):

            def _chamada(*args, **kwargs):
                resultado = atributo(*args, **kwargs)
                if hasattr(resultado, "execute") and callable(resultado.execute):
                    return _RetryProxy(resultado)
                return resultado

            return _chamada
        return atributo


# Cliente Supabase singleton (envolvido pelo proxy de retry)
_cliente: Client = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None
supabase = _RetryProxy(_cliente) if _cliente is not None else None


def get_supabase() -> Client:
    if supabase is None:
        raise ValueError("Cliente Supabase não inicializado. Verifique as credenciais no arquivo .env")
    return supabase
