import os
import sys
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
