import os

# Caminho do banco de dados (padrão local, tenta usar Google Drive quando disponível)
GD_PATH = r"G:\Meu Drive\BANCO_DE_DADOS\clientes.db"
DEFAULT_LOCAL_PATH = os.path.join(os.path.expanduser("~"), "Documents", "App_Munaretto", "clientes.db")

DATABASE_FILE = GD_PATH if os.path.exists(os.path.dirname(GD_PATH)) else DEFAULT_LOCAL_PATH

# Diretórios
TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")
BACKUPS_DIR = os.path.join(os.path.dirname(__file__), "backups")

# Logging
LOG_FILE = os.path.join(os.path.dirname(__file__), "logs", "app.log")

# Parceiros / sócios (exemplo centralizado)
SOCIOS = [
    {"nome": "Sócio A", "percentual": 0.25},
    {"nome": "Sócio B", "percentual": 0.25},
    {"nome": "Sócio C", "percentual": 0.25},
    {"nome": "Sócio D", "percentual": 0.25},
]
