import os
import shutil
from datetime import datetime

# Define o caminho padrão: Documentos/App_Munaretto
CAMINHO_APP = os.path.join(os.path.expanduser("~"), "Documents", "App_Munaretto")
PASTA_BACKUPS = os.path.join(CAMINHO_APP, "Backups")
PASTA_GERADOS = os.path.join(CAMINHO_APP, "Arquivos_Gerados")

def garantir_pastas():
    """Cria as pastas necessárias se não existirem."""
    for pasta in [CAMINHO_APP, PASTA_BACKUPS, PASTA_GERADOS]:
        if not os.path.exists(pasta):
            os.makedirs(pasta)

def realizar_backup_local(arquivo_db=r"G:\Meu Drive\BANCO_DE_DADOS\clientes.db"):
    """Copia o banco de dados para a pasta de Backups em Documentos."""
    try:
        garantir_pastas()
        if os.path.exists(arquivo_db):
            data_hora = datetime.now().strftime("%Y%m%d_%H%M%S")
            destino = os.path.join(PASTA_BACKUPS, f"backup_sistema_{data_hora}.db")
            shutil.copy2(arquivo_db, destino)
            return True, destino
        return False, "Banco de dados não encontrado."
    except Exception as e:
        return False, str(e)
