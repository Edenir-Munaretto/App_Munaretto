import sqlite3
import os
import sys

# Tenta obter o caminho do banco de dados de config.py
try:
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    import config
    DATABASE_FILE = config.DATABASE_FILE
except ImportError:
    # Fallback caso execute fora da pasta raiz
    DEFAULT_LOCAL_PATH = os.path.join(os.path.expanduser("~"), "Documents", "App_Munaretto", "clientes.db")
    GD_PATH = r"G:\Meu Drive\BANCO_DE_DADOS\clientes.db"
    DATABASE_FILE = GD_PATH if os.path.exists(os.path.dirname(GD_PATH)) else DEFAULT_LOCAL_PATH

SQL_DUMP_FILE = "dump_para_supabase.sql"

def escape_sql_str(val):
    if val is None:
        return "NULL"
    val_str = str(val).replace("'", "''")
    return f"'{val_str}'"

def escape_sql_num(val):
    if val is None:
        return "NULL"
    return str(val)

def escape_sql_bool(val):
    if val is None:
        return "NULL"
    return "TRUE" if val == 1 else "FALSE"

def migrar():
    if not os.path.exists(DATABASE_FILE):
        print(f"[ERRO] Banco de dados SQLite nao encontrado em: {DATABASE_FILE}")
        return

    print(f"[INFO] Lendo banco de dados SQLite de: {DATABASE_FILE}")
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()

    sql_statements = []
    sql_statements.append("-- Script de inserção de dados gerado para migração no Supabase\n")
    sql_statements.append("BEGIN;\n")

    # 1. Clientes
    try:
        cursor.execute("SELECT id, nome, cpf_cnpj, endereco, cidade, cep, nota_ps, valor_da_obra, valor_de_devolucao, data_cadastro, ativo FROM clientes")
        clientes = cursor.fetchall()
        if clientes:
            sql_statements.append("-- Migrando tabela: clientes")
            for c in clientes:
                sql_statements.append(
                    f"INSERT INTO clientes (id, nome, cpf_cnpj, endereco, cidade, cep, nota_ps, valor_da_obra, valor_de_devolucao, data_cadastro, ativo) "
                    f"VALUES ({c[0]}, {escape_sql_str(c[1])}, {escape_sql_str(c[2])}, {escape_sql_str(c[3])}, "
                    f"{escape_sql_str(c[4])}, {escape_sql_str(c[5])}, {escape_sql_str(c[6])}, {escape_sql_str(c[7])}, "
                    f"{escape_sql_str(c[8])}, {escape_sql_str(c[9])}, {escape_sql_bool(c[10])}) "
                    f"ON CONFLICT (cpf_cnpj) DO UPDATE SET "
                    f"nome = EXCLUDED.nome, endereco = EXCLUDED.endereco, cidade = EXCLUDED.cidade, "
                    f"cep = EXCLUDED.cep, nota_ps = EXCLUDED.nota_ps, valor_da_obra = EXCLUDED.valor_da_obra, "
                    f"valor_de_devolucao = EXCLUDED.valor_de_devolucao, ativo = EXCLUDED.ativo;"
                )
            sql_statements.append(f"SELECT setval(pg_get_serial_sequence('clientes', 'id'), coalesce(max(id), 1)) FROM clientes;\n")
            print(f"[OK] Processados {len(clientes)} clientes.")
    except Exception as e:
        print(f"[AVISO] Erro ao processar clientes: {e}")

    # 2. Documentos Gerados
    try:
        cursor.execute("SELECT id, cliente_id, tipo_documento, formato, caminho_arquivo, data_geracao FROM documentos_gerados")
        documentos = cursor.fetchall()
        if documentos:
            sql_statements.append("-- Migrando tabela: documentos_gerados")
            for d in documentos:
                sql_statements.append(
                    f"INSERT INTO documentos_gerados (id, cliente_id, tipo_documento, formato, caminho_arquivo, data_geracao) "
                    f"VALUES ({d[0]}, {d[1]}, {escape_sql_str(d[2])}, {escape_sql_str(d[3])}, {escape_sql_str(d[4])}, {escape_sql_str(d[5])}) "
                    f"ON CONFLICT (id) DO NOTHING;"
                )
            sql_statements.append(f"SELECT setval(pg_get_serial_sequence('documentos_gerados', 'id'), coalesce(max(id), 1)) FROM documentos_gerados;\n")
            print(f"[OK] Processados {len(documentos)} registros de documentos.")
    except Exception as e:
        print(f"[AVISO] Erro ao processar documentos gerados: {e}")

    # 3. Fluxo de Caixa
    try:
        cursor.execute(
            "SELECT id, mes_referencia, rendimento_usina1, rendimento_usina2, rendimento_usina3, "
            "despesa_contabilidade, despesa_internet, despesa_lavagem, despesa_manutencao, "
            "despesa_imposto, despesa_taxa, despesa_diversas, total_liquido, data_registro FROM fluxo_caixa"
        )
        fluxos = cursor.fetchall()
        if fluxos:
            sql_statements.append("-- Migrando tabela: fluxo_caixa")
            for f in fluxos:
                sql_statements.append(
                    f"INSERT INTO fluxo_caixa (id, mes_referencia, rendimento_usina1, rendimento_usina2, rendimento_usina3, "
                    f"despesa_contabilidade, despesa_internet, despesa_lavagem, despesa_manutencao, despesa_imposto, "
                    f"despesa_taxa, despesa_diversas, total_liquido, data_registro) "
                    f"VALUES ({f[0]}, {escape_sql_str(f[1])}, {escape_sql_num(f[2])}, {escape_sql_num(f[3])}, {escape_sql_num(f[4])}, "
                    f"{escape_sql_num(f[5])}, {escape_sql_num(f[6])}, {escape_sql_num(f[7])}, {escape_sql_num(f[8])}, {escape_sql_num(f[9])}, "
                    f"{escape_sql_num(f[10])}, {escape_sql_num(f[11])}, {escape_sql_num(f[12])}, {escape_sql_str(f[13])}) "
                    f"ON CONFLICT (id) DO NOTHING;"
                )
            sql_statements.append(f"SELECT setval(pg_get_serial_sequence('fluxo_caixa', 'id'), coalesce(max(id), 1)) FROM fluxo_caixa;\n")
            print(f"[OK] Processados {len(fluxos)} registros de fluxo de caixa.")
    except Exception as e:
        print(f"[AVISO] Erro ao processar fluxo de caixa: {e}")

    # 4. Gestão de Férias
    try:
        cursor.execute(
            "SELECT id, nome, data_inicio, dias_abono, dias_gozo, data_retorno, data_limite, "
            "departamento, saldo_anterior, dias_utilizados, motivo_cancelamento, status, created_at, updated_at, data_registro FROM gestao_ferias"
        )
        ferias = cursor.fetchall()
        if ferias:
            sql_statements.append("-- Migrando tabela: gestao_ferias")
            for f in ferias:
                sql_statements.append(
                    f"INSERT INTO gestao_ferias (id, nome, data_inicio, dias_abono, dias_gozo, data_retorno, data_limite, "
                    f"departamento, saldo_anterior, dias_utilizados, motivo_cancelamento, status, created_at, updated_at, data_registro) "
                    f"VALUES ({f[0]}, {escape_sql_str(f[1])}, {escape_sql_str(f[2])}, {escape_sql_num(f[3])}, {escape_sql_num(f[4])}, "
                    f"{escape_sql_str(f[5])}, {escape_sql_str(f[6])}, {escape_sql_str(f[7])}, {escape_sql_num(f[8])}, {escape_sql_num(f[9])}, "
                    f"{escape_sql_str(f[10])}, {escape_sql_str(f[11])}, {escape_sql_str(f[12])}, {escape_sql_str(f[13])}, {escape_sql_str(f[14])}) "
                    f"ON CONFLICT (id) DO NOTHING;"
                )
            sql_statements.append(f"SELECT setval(pg_get_serial_sequence('gestao_ferias', 'id'), coalesce(max(id), 1)) FROM gestao_ferias;\n")
            print(f"[OK] Processados {len(ferias)} registros de férias.")
    except Exception as e:
        print(f"[AVISO] Erro ao processar férias: {e}")

    sql_statements.append("COMMIT;\n")

    conn.close()

    # Salva o arquivo de dump SQL
    with open(SQL_DUMP_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(sql_statements))

    print(f"[SUCESSO] O arquivo SQL de migração foi gerado.")
    print(f"Caminho criado: {os.path.abspath(SQL_DUMP_FILE)}")
    print(f"Copie o conteudo desse arquivo e execute no 'SQL Editor' do seu painel do Supabase.")

if __name__ == "__main__":
    migrar()
