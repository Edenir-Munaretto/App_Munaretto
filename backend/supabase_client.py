import os
from dotenv import load_dotenv
from supabase import create_client, Client

# Carrega arquivo .env se existir
load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("⚠️ AVISO: SUPABASE_URL ou SUPABASE_KEY não configurados no arquivo .env!")

# Cliente Supabase singleton
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None

def get_supabase() -> Client:
    if not supabase:
        raise ValueError("Cliente Supabase não inicializado. Verifique as credenciais no arquivo .env")
    return supabase
