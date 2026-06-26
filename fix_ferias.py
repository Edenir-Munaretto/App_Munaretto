import sqlite3
from datetime import datetime, timedelta
from database import get_db

def fix_ferias():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, data_inicio, dias_abono FROM gestao_ferias")
        rows = cursor.fetchall()
        
        updated = 0
        for r in rows:
            ferias_id = r[0]
            data_inicio_str = r[1]
            dias_abono = r[2]
            
            try:
                dt_inicio = datetime.strptime(data_inicio_str, "%Y-%m-%d").date()
                total_padrao = 30
                dias_gozo = total_padrao - int(dias_abono)
                dt_retorno = dt_inicio + timedelta(days=dias_gozo)
                data_retorno_str = dt_retorno.strftime("%Y-%m-%d")
                
                cursor.execute("UPDATE gestao_ferias SET data_retorno = ?, dias_gozo = ? WHERE id = ?", (data_retorno_str, dias_gozo, ferias_id))
                updated += 1
            except Exception as e:
                print(f"Erro no registro ID {ferias_id}: {e}")
                
        conn.commit()
        print(f"Sucesso! Atualizados {updated} registros de férias com a data de retorno correta.")

if __name__ == '__main__':
    fix_ferias()
