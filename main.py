import os
import sys
try:
    import num2words # Força a detecção do módulo pelo PyInstaller
except ImportError:
    print("ERRO: A biblioteca 'num2words' não foi encontrada.")
    print("Por favor, instale-a executando: pip install num2words")
    input("Pressione Enter para sair...")
    sys.exit(1)

from gui import main as gui_main
from logging_config import setup_logging
import database

logger = setup_logging()

if __name__ == "__main__":
    try:
        database.inicializar_banco()
        gui_main()
    except KeyboardInterrupt:
        logger.info("Programa interrompido pelo usuário.")
        sys.exit(0)
    except Exception as e:
        logger.exception("Erro inesperado na aplicação")
        sys.exit(1)
