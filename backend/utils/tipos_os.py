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
