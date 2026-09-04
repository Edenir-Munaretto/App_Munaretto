"""Tipos de O.S/contratos — fonte única para os módulos do Controle de O.S.

Centraliza as listas fixas de tipos de O.S e seus rótulos (antes duplicadas
em `routers/os.py` e `routers/apoio_os.py`) e o catálogo padrão de checklist.
"""

TIPOS_OS = {"construcao", "linha_viva", "manutencao"}

ROTULOS_TIPO = {
    "construcao": "Construção",
    "manutencao": "Manutenção",
    "linha_viva": "Linha Viva",
}

# Unidade de valor por contrato: Construção usa USC; Manutenção e Linha Viva
# usam ULV. Vale para relatório, painel de execução e cadastro/importação.
UNIDADE_POR_TIPO = {
    "construcao": "USC",
    "manutencao": "ULV",
    "linha_viva": "ULV",
}


def unidade_contrato(tipo: str | None) -> str:
    """Unidade de valor exibida para o contrato/tipo da O.S (fallback USC)."""
    return UNIDADE_POR_TIPO.get(tipo or "construcao", "USC")
