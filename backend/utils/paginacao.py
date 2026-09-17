"""Leitura paginada do PostgREST/Supabase.

O Supabase devolve no máximo ~1000 linhas por requisição. Consultas que somam
ou contam registros precisam percorrer TODAS as páginas, senão os totais ficam
silenciosamente errados acima desse teto.
"""

# Teto de linhas por página do PostgREST.
TAMANHO_PAGINA = 1000
# Lotes de IDs em filtros `in_()` (evita URL longa demais).
TAMANHO_LOTE_IDS = 200


def em_lotes(itens: list, tamanho: int = TAMANHO_LOTE_IDS):
    """Fatia uma lista em lotes (usado nos filtros `in_` do PostgREST)."""
    for inicio in range(0, len(itens), tamanho):
        yield itens[inicio : inicio + tamanho]


def ler_paginado(base, tamanho: int = TAMANHO_PAGINA) -> list[dict]:
    """Lê TODAS as linhas de uma query, paginando pelo teto do PostgREST."""
    dados: list[dict] = []
    offset = 0
    while True:
        pagina = base.range(offset, offset + tamanho - 1).execute().data or []
        dados.extend(pagina)
        if len(pagina) < tamanho:
            break
        offset += tamanho
    return dados
