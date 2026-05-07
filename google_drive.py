import os
import shutil
from datetime import datetime

# Define o caminho para a pasta Documentos do usuário atual
CAMINHO_DOCUMENTOS = os.path.join(os.path.expanduser("~"), "Documents", "App_Munaretto")
PASTA_BACKUPS = os.path.join(CAMINHO_DOCUMENTOS, "Backups")

def garantir_pastas():
    """Garante que a pasta do App e de Backups existam localmente."""
    if not os.path.exists(PASTA_BACKUPS):
        os.makedirs(PASTA_BACKUPS)
        print(f"✅ Pastas criadas em: {CAMINHO_DOCUMENTOS}")

def sincronizar_backup_local(arquivo_db=r"G:\Meu Drive\BANCO_DE_DADOS\clientes.db"):
    """Faz uma cópia de segurança do banco de dados para a pasta Documentos."""
    try:
        garantir_pastas()
        
        if os.path.exists(arquivo_db):
            # Cria um nome com data e hora para não sobrescrever o anterior
            data_hora = datetime.now().strftime("%Y%m%d_%H%M%S")
            nome_backup = f"backup_clientes_{data_hora}.db"
            caminho_destino = os.path.join(PASTA_BACKUPS, nome_backup)
            
            # Copia o arquivo (shutil.copy2 preserva os metadados)
            shutil.copy2(arquivo_db, caminho_destino)
            
            print(f"✅ Backup local realizado com sucesso!")
            print(f"📍 Local: {caminho_destino}")
            return True
        else:
            print("❌ Arquivo de banco de dados original não encontrado.")
            return False
            
    except Exception as e:
        print(f"❌ Erro ao realizar backup local: {e}")
        return False

def listar_backups_locais():
    """Lista todos os backups salvos na pasta Documentos."""
    if os.path.exists(PASTA_BACKUPS):
        return sorted(os.listdir(PASTA_BACKUPS), reverse=True)
    return []

# Exemplo de uso:
if __name__ == "__main__":
    sincronizar_backup_local()
