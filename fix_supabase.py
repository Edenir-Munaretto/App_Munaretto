import os
import sys
from datetime import datetime, timedelta

# Add backend folder to path
sys.path.append(os.path.join(os.path.dirname(__file__), 'backend'))

from dotenv import load_dotenv
load_dotenv(dotenv_path='backend/.env')

from supabase_client import get_supabase

def fix_supabase_ferias():
    try:
        db = get_supabase()
    except Exception as e:
        print(f"Erro ao obter Supabase: {e}")
        return
        
    print("Buscando férias do Supabase...")
    try:
        response = db.table("gestao_ferias").select("id, nome, data_inicio, dias_abono, data_retorno").execute()
        records = response.data
    except Exception as e:
        print(f"Erro ao buscar dados: {e}")
        return

    print(f"Encontrados {len(records)} registros. Corrigindo datas...")
    updated_count = 0
    
    for r in records:
        ferias_id = r["id"]
        nome = r["nome"]
        data_inicio_str = r["data_inicio"]
        dias_abono = r["dias_abono"]
        data_retorno_atual = r["data_retorno"]
        
        try:
            dt_inicio = datetime.strptime(data_inicio_str, "%Y-%m-%d").date()
            total_padrao = 30
            dias_gozo = total_padrao - int(dias_abono)
            dt_retorno_correto = dt_inicio + timedelta(days=dias_gozo)
            data_retorno_correta_str = dt_retorno_correto.strftime("%Y-%m-%d")
            
            if data_retorno_atual != data_retorno_correta_str:
                print(f"Atualizando {nome}: {data_retorno_atual} -> {data_retorno_correta_str}")
                db.table("gestao_ferias").update({
                    "data_retorno": data_retorno_correta_str,
                    "dias_gozo": dias_gozo
                }).eq("id", ferias_id).execute()
                updated_count += 1
        except Exception as e:
            print(f"Erro ao processar ID {ferias_id} ({nome}): {e}")
            
    print(f"Sucesso! {updated_count} registros corrigidos no Supabase.")

if __name__ == '__main__':
    fix_supabase_ferias()
