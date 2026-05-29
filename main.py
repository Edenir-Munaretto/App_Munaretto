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

if __name__ == "__main__":
    try:
        gui_main()
    except KeyboardInterrupt:
        print("\n\nPrograma interrompido pelo usuário.")
        sys.exit(0)
    except Exception as e:
        print(f"Erro inesperado: {e}")
        sys.exit(1)
