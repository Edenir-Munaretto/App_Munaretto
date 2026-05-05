import os
import pickle
from google.auth.transport.requests import Request
from google.oauth2.service_account import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.cloud import storage
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
import json

SCOPES = ["https://www.googleapis.com/auth/drive"]
TOKEN_FILE = "token.pickle"
CREDENTIALS_FILE = "credentials.json"


def autenticar_google_drive():
    """Autentica com Google Drive e retorna o serviço."""
    creds = None

    # Carregar token existente
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, "rb") as token:
            creds = pickle.load(token)

    # Se não há credenciais válidas, fazer login
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(CREDENTIALS_FILE):
                print("❌ Arquivo 'credentials.json' não encontrado.")
                print("Baixe suas credenciais do Google Cloud Console e coloque em credentials.json")
                return None

            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)

        # Salvar token para próximas execuções
        with open(TOKEN_FILE, "wb") as token:
            pickle.dump(creds, token)

    return build("drive", "v3", credentials=creds)


def criar_pasta_drive(service, nome_pasta, pasta_pai_id=None):
    """Cria uma pasta no Google Drive."""
    file_metadata = {
        "name": nome_pasta,
        "mimeType": "application/vnd.google-apps.folder",
    }

    if pasta_pai_id:
        file_metadata["parents"] = [pasta_pai_id]

    try:
        file = service.files().create(body=file_metadata, fields="id").execute()
        return file.get("id")
    except Exception as e:
        print(f"Erro ao criar pasta: {e}")
        return None


def buscar_pasta_por_nome(service, nome_pasta):
    """Busca pasta no Google Drive pelo nome."""
    try:
        query = f"name='{nome_pasta}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
        results = service.files().list(q=query, fields="files(id, name)").execute()
        items = results.get("files", [])
        return items[0]["id"] if items else None
    except Exception as e:
        print(f"Erro ao buscar pasta: {e}")
        return None


def enviar_arquivo_drive(service, caminho_arquivo, pasta_id=None):
    """Envia um arquivo para o Google Drive."""
    try:
        file_metadata = {"name": os.path.basename(caminho_arquivo)}

        if pasta_id:
            file_metadata["parents"] = [pasta_id]

        media = MediaFileUpload(caminho_arquivo, resumable=True)

        file = (
            service.files()
            .create(body=file_metadata, media_body=media, fields="id")
            .execute()
        )

        return file.get("id")
    except Exception as e:
        print(f"Erro ao enviar arquivo: {e}")
        return None


def sincronizar_backup_drive():
    """Sincroniza backup JSON com Google Drive."""
    try:
        service = autenticar_google_drive()
        if not service:
            print("❌ Não foi possível autenticar com Google Drive")
            return False

        # Buscar ou criar pasta
        pasta_id = buscar_pasta_por_nome(service, "App_Munaretto_Backups")
        if not pasta_id:
            pasta_id = criar_pasta_drive(service, "App_Munaretto_Backups")

        # Enviar backup mais recente
        if os.path.exists("backups"):
            arquivos = sorted(
                os.listdir("backups"),
                key=lambda x: os.path.getctime(os.path.join("backups", x)),
                reverse=True,
            )

            if arquivos:
                caminho_backup = os.path.join("backups", arquivos[0])
                arquivo_id = enviar_arquivo_drive(service, caminho_backup, pasta_id)

                if arquivo_id:
                    print(f"✅ Backup sincronizado com Google Drive!")
                    return True
        else:
            print("❌ Nenhum backup encontrado")
            return False

    except Exception as e:
        print(f"❌ Erro ao sincronizar: {e}")
        return False


def listar_arquivos_drive(service, pasta_id=None):
    """Lista arquivos no Google Drive."""
    try:
        query = "trashed=false"
        if pasta_id:
            query += f" and '{pasta_id}' in parents"

        results = service.files().list(q=query, fields="files(id, name)").execute()
        return results.get("files", [])
    except Exception as e:
        print(f"Erro ao listar arquivos: {e}")
        return []


def baixar_arquivo_drive(service, arquivo_id, caminho_destino):
    """Baixa um arquivo do Google Drive."""
    try:
        from googleapiclient.http import MediaIoBaseDownload
        import io

        request = service.files().get_media(fileId=arquivo_id)
        fh = io.FileIO(caminho_destino, "wb")
        downloader = MediaIoBaseDownload(fh, request)

        done = False
        while not done:
            status, done = downloader.next_chunk()

        return True
    except Exception as e:
        print(f"Erro ao baixar arquivo: {e}")
        return False
