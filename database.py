import sqlite3
import json
import os
from datetime import datetime, timedelta
from typing import List, Tuple, Dict, Optional, Any
from contextlib import contextmanager
import logging

import formatting
import validators

logger = logging.getLogger(__name__)

# Tenta usar o Google Drive se disponível, caso contrário usa uma pasta local nos Documentos
GD_PATH = r"G:\Meu Drive\BANCO_DE_DADOS\clientes.db"
DEFAULT_LOCAL_PATH = os.path.join(os.path.expanduser("~"), "Documents", "App_Munaretto", "clientes.db")

DATABASE_FILE = GD_PATH if os.path.exists(os.path.dirname(GD_PATH)) else DEFAULT_LOCAL_PATH

def inicializar_banco():
    """Cria tabelas do banco se não existirem."""
    try:
        # Garante que a pasta do banco de dados exista
        os.makedirs(os.path.dirname(DATABASE_FILE), exist_ok=True)
    except Exception as e:
        print(f"Aviso: Não foi possível criar a pasta do banco: {e}")
    
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS clientes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            cpf_cnpj TEXT NOT NULL UNIQUE,
            endereco TEXT NOT NULL,
            cidade TEXT,
            cep TEXT,
            nota_ps TEXT,
            valor_da_obra TEXT,
            valor_de_devolucao TEXT,
            data_cadastro TEXT DEFAULT CURRENT_TIMESTAMP,
            ativo INTEGER DEFAULT 1
        )
    """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS documentos_gerados (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cliente_id INTEGER NOT NULL,
            tipo_documento TEXT NOT NULL,
            formato TEXT NOT NULL,
            caminho_arquivo TEXT NOT NULL,
            data_geracao TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (cliente_id) REFERENCES clientes(id)
        )
    """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS fluxo_caixa (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mes_referencia TEXT NOT NULL,
            rendimento_usina1 REAL,
            rendimento_usina2 REAL,
            rendimento_usina3 REAL,
            despesa_contabilidade REAL,
            despesa_internet REAL,
            despesa_lavagem REAL,
            despesa_manutencao REAL,
            despesa_imposto REAL,
            despesa_taxa REAL,
            despesa_diversas REAL,
            total_liquido REAL,
            data_registro TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """
    )
    
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS gestao_ferias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            data_inicio TEXT NOT NULL,
            dias_abono INTEGER NOT NULL,
            dias_gozo INTEGER NOT NULL,
            data_retorno TEXT NOT NULL,
            data_limite TEXT NOT NULL,
            departamento TEXT,
            saldo_anterior INTEGER DEFAULT 0,
            dias_utilizados INTEGER DEFAULT 0,
            motivo_cancelamento TEXT,
            status TEXT DEFAULT 'Agendado',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            data_registro TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """
    )
    
    # Migração: Garante que a coluna 'status' exista para bancos de dados criados em versões anteriores
    cursor.execute("PRAGMA table_info(gestao_ferias)")
    colunas = [info[1] for info in cursor.fetchall()]
    # Adiciona colunas que possam faltar em versões anteriores
    extras = [
        ("departamento", "TEXT"),
        ("saldo_anterior", "INTEGER DEFAULT 0"),
        ("dias_utilizados", "INTEGER DEFAULT 0"),
        ("motivo_cancelamento", "TEXT"),
        ("created_at", "TEXT"),
        ("updated_at", "TEXT"),
    ]
    for col, coldef in extras:
        if col not in colunas:
            cursor.execute(f"ALTER TABLE gestao_ferias ADD COLUMN {col} {coldef}")

    # Garante a coluna 'status' (compatibilidade retroativa)
    if colunas and "status" not in colunas:
        cursor.execute("ALTER TABLE gestao_ferias ADD COLUMN status TEXT DEFAULT 'Agendado'")

    # Cria trigger para atualizar 'updated_at' sempre que houver UPDATE
    # Atualiza valores existentes para created_at/updated_at se necessário
    try:
        cursor.execute("UPDATE gestao_ferias SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL OR created_at = ''")
        cursor.execute("UPDATE gestao_ferias SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL OR updated_at = ''")
    except Exception:
        pass

    # Cria triggers para popular created_at na inserção e updated_at na atualização
    try:
        cursor.execute("DROP TRIGGER IF EXISTS trg_update_ferias_updated_at")
        cursor.execute("DROP TRIGGER IF EXISTS trg_insert_ferias_created_at")
    except Exception:
        pass

    try:
        cursor.execute(
            "CREATE TRIGGER trg_insert_ferias_created_at AFTER INSERT ON gestao_ferias BEGIN UPDATE gestao_ferias SET created_at = COALESCE(NEW.created_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;"
        )
        cursor.execute(
            "CREATE TRIGGER trg_update_ferias_updated_at AFTER UPDATE ON gestao_ferias BEGIN UPDATE gestao_ferias SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;"
        )
    except Exception:
        # Se criação de triggers falhar, continuamos sem interromper
        pass
    


    conn.commit()
    conn.close()


@contextmanager
def get_db():
    conn = sqlite3.connect(DATABASE_FILE)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def adicionar_cliente(nome, cpf_cnpj, endereco, cidade=None, cep=None, nota_ps=None, valor_da_obra=None, valor_de_devolucao=None):
    """Adiciona um novo cliente ao banco de dados."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO clientes (nome, cpf_cnpj, endereco, cidade, cep, nota_ps, valor_da_obra, valor_de_devolucao)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (nome, cpf_cnpj, endereco, cidade, cep, nota_ps, valor_da_obra, valor_de_devolucao)
            )
            cliente_id = cursor.lastrowid
            return cliente_id
    except sqlite3.IntegrityError:
        return None


def listar_clientes():
    """Retorna lista de todos os clientes."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, nome, cpf_cnpj, endereco, cidade, cep, nota_ps, valor_da_obra, valor_de_devolucao, data_cadastro, ativo "
            "FROM clientes WHERE ativo = 1 ORDER BY nome"
        )
        clientes = cursor.fetchall()
        return clientes


def buscar_cliente_por_id(cliente_id):
    """Busca um cliente específico pelo ID."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, nome, cpf_cnpj, endereco, cidade, cep, nota_ps, valor_da_obra, valor_de_devolucao, data_cadastro, ativo "
            "FROM clientes WHERE id = ?",
            (cliente_id,),
        )
        cliente = cursor.fetchone()
        return cliente


def atualizar_cliente(cliente_id, nome, cpf_cnpj, endereco, cidade=None, cep=None, nota_ps=None, valor_da_obra=None, valor_de_devolucao=None):
    """Atualiza dados de um cliente."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE clientes
                SET nome = ?, cpf_cnpj = ?, endereco = ?, cidade = ?, cep = ?, nota_ps = ?, valor_da_obra = ?, valor_de_devolucao = ?
                WHERE id = ?
            """,
                (nome, cpf_cnpj, endereco, cidade, cep, nota_ps, valor_da_obra, valor_de_devolucao, cliente_id)
            )
            return True
    except sqlite3.IntegrityError:
        return False


def deletar_cliente(cliente_id):
    """Marca um cliente como inativo (soft delete)."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE clientes SET ativo = 0 WHERE id = ?", (cliente_id,))


def registrar_documento_gerado(cliente_id, tipo_documento, formato, caminho_arquivo):
    """Registra um documento gerado no histórico."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO documentos_gerados (cliente_id, tipo_documento, formato, caminho_arquivo)
            VALUES (?, ?, ?, ?)
        """,
            (cliente_id, tipo_documento, formato, caminho_arquivo),
        )


def salvar_fluxo_caixa(dados):
    """Salva o fechamento do fluxo de caixa mensal."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            query = f"INSERT INTO fluxo_caixa ({', '.join(dados.keys())}) VALUES ({', '.join(['?' for _ in dados])})"
            cursor.execute(query, list(dados.values()))
            return True
    except Exception as e:
        logger.exception("Erro ao salvar fluxo")
        return False


def obter_historico_cliente(cliente_id):
    """Retorna histórico de documentos gerados de um cliente."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT tipo_documento, formato, caminho_arquivo, data_geracao
            FROM documentos_gerados
            WHERE cliente_id = ?
            ORDER BY data_geracao DESC
        """,
            (cliente_id,),
        )
        historico = cursor.fetchall()
        return historico


def exportar_banco_json():
    """Exporta todos os clientes para JSON."""
    clientes = listar_clientes()
    dados = []
    for cliente in clientes:
        dados.append(
            {
                "id": cliente[0],
                "nome": cliente[1],
                "cpf_cnpj": cliente[2],
                "endereco": cliente[3],
                "cidade": cliente[4],
                "cep": cliente[5],
                "nota_ps": cliente[6],
                "valor_da_obra": cliente[7],
                "valor_de_devolucao": cliente[8],
                "data_cadastro": cliente[9],
                "ativo": cliente[10],
            }
        )
    return dados


def salvar_backup_json():
    """Cria backup em JSON dos dados."""
    os.makedirs("backups", exist_ok=True)
    dados = exportar_banco_json()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    arquivo = f"backups/backup_clientes_{timestamp}.json"
    with open(arquivo, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=2)
    return arquivo

def listar_fluxos_caixa():
    """Retorna a lista resumida de todos os fluxos de caixa."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, mes_referencia, total_liquido FROM fluxo_caixa ORDER BY data_registro DESC")
        fluxos = cursor.fetchall()
        return fluxos

def buscar_fluxo_por_id(fluxo_id):
    """Busca os dados brutos de um fluxo pelo ID para edição."""
    with get_db() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM fluxo_caixa WHERE id = ?", (fluxo_id,))
        row = cursor.fetchone()
        return row

def atualizar_fluxo_caixa(fluxo_id, dados):
    """Atualiza um registro de fluxo de caixa existente."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            sets = ", ".join([f"{k} = ?" for k in dados.keys()])
            query = f"UPDATE fluxo_caixa SET {sets} WHERE id = ?"
            cursor.execute(query, list(dados.values()) + [fluxo_id])
            return True
    except Exception as e:
        logger.exception("Erro ao atualizar fluxo")
        return False

def deletar_fluxo_caixa(fluxo_id):
    """Remove um registro de fluxo de caixa."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM fluxo_caixa WHERE id = ?", (fluxo_id,))
            return True
    except Exception as e:
        logger.exception("Erro ao deletar fluxo")
        return False

def buscar_dados_fluxo_por_mes(mes_referencia):
    with get_db() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM fluxo_caixa WHERE mes_referencia = ?", (mes_referencia,))
        row = cursor.fetchone()

    if row:
        # Formatação auxiliar para padrão brasileiro (1.234,56)
        fmt = lambda v: f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

        # Organiza os dados exatamente como as labels da interface esperam
        dados_usinas = {
            "Rendimento Usina 01": fmt(row['rendimento_usina1']),
            "Rendimento Usina 02": fmt(row['rendimento_usina2']),
            "Rendimento Usina 03": fmt(row['rendimento_usina3'])
        }
        
        dados_despesas = {
            "Contabilidade": fmt(row['despesa_contabilidade']),
            "Internet": fmt(row['despesa_internet']),
            "Lavagem Usinas": fmt(row['despesa_lavagem']),
            "Manutenção": fmt(row['despesa_manutencao']),
            "Impostos": fmt(row['despesa_imposto']),
            "Seguro": fmt(row['despesa_taxa']),
            "Diversas": fmt(row['despesa_diversas'])
        }
        
        total_liquido = fmt(row['total_liquido'])
        
        return dados_usinas, dados_despesas, total_liquido
    return None

def adicionar_ferias(
    nome: str,
    data_inicio_str: str,
    dias_abono: int,
    data_limite_str: str,
    departamento: str = None,
    saldo_anterior: int = 0,
    dias_utilizados: int = 0,
    motivo_cancelamento: str = None,
) -> Tuple[bool, str]:
    """Calcula e salva as férias de um colaborador com campos adicionais."""
    try:
        if dias_abono > 10:
            return False, "O abono pecuniário não pode ser superior a 10 dias."

        # Valida e parseia datas
        dt_inicio = validators.parse_date_iso(data_inicio_str)
        if not dt_inicio:
            return False, "Data de início inválida. Use YYYY-MM-DD."

        # Calcula dias de gozo considerando dias úteis
        total_padrao = 30
        dias_gozo = total_padrao - int(dias_abono)
        dt_retorno_date = formatting.add_business_days(dt_inicio.date(), dias_gozo)
        data_retorno_str = dt_retorno_date.strftime("%Y-%m-%d")

        # Se a data limite não for informada, calcula 1 ano após o início por padrão
        if not data_limite_str:
            dt_limite_date = dt_inicio.date() + timedelta(days=365)
            data_limite_str = dt_limite_date.strftime("%Y-%m-%d")

        # Verifica conflitos com outras férias do mesmo colaborador
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT data_inicio, data_retorno, status FROM gestao_ferias WHERE nome = ? AND status != 'Cancelado'",
                (nome,)
            )
            rows = cursor.fetchall()
            for r in rows:
                try:
                    existing_start = datetime.strptime(r[0], "%Y-%m-%d").date()
                    existing_return = datetime.strptime(r[1], "%Y-%m-%d").date()
                except Exception:
                    continue
                if dt_inicio.date() <= existing_return and dt_retorno_date >= existing_start:
                    return False, f"Conflito com período existente: {existing_start} - {existing_return}"

            cursor.execute(
                "INSERT INTO gestao_ferias (nome, data_inicio, dias_abono, dias_gozo, data_retorno, data_limite, departamento, saldo_anterior, dias_utilizados, motivo_cancelamento, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (nome, data_inicio_str, dias_abono, dias_gozo, data_retorno_str, data_limite_str, departamento, saldo_anterior, dias_utilizados, motivo_cancelamento, "Agendado"),
            )
        return True, "Férias agendadas com sucesso."
    except Exception as e:
        logger.exception("Erro ao salvar férias")
        return False, f"Erro ao salvar férias: {e}"

def deletar_ferias(ferias_id: int) -> bool:
    """Remove um registro de férias do banco de dados."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM gestao_ferias WHERE id = ?", (ferias_id,))
            return True
    except Exception as e:
        logger.exception("Erro ao deletar férias")
        return False

def listar_ferias_proximo_mes() -> List[sqlite3.Row]:
    """Retorna colaboradores com férias no mês seguinte."""
    hoje = datetime.now()
    primeiro_dia_prox_mes = (hoje.replace(day=1) + timedelta(days=32)).replace(day=1)
    ultimo_dia_prox_mes = (primeiro_dia_prox_mes + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    with get_db() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM gestao_ferias WHERE data_inicio BETWEEN ? AND ?",
            (primeiro_dia_prox_mes.strftime("%Y-%m-%d"), ultimo_dia_prox_mes.strftime("%Y-%m-%d"))
        )
        rows = cursor.fetchall()
        return rows

def obter_alertas_ferias() -> List[Dict[str, Any]]:
    """Retorna dados de colaboradores próximos à data limite."""
    with get_db() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT nome, data_limite FROM gestao_ferias")
        dados = [dict(row) for row in cursor.fetchall()]
        return dados

def buscar_ferias_por_colaborador(nome: str) -> List[sqlite3.Row]:
    """Busca o histórico de férias de um colaborador específico."""
    with get_db() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM gestao_ferias WHERE nome LIKE ? ORDER BY data_inicio DESC",
            (f"%{nome}%",)
        )
        rows = cursor.fetchall()
        return rows

def atualizar_status_ferias(ferias_id: int, novo_status: str) -> bool:
    """Atualiza o status de um registro de férias (ex: 'Gozadas', 'Cancelado')."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE gestao_ferias SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (novo_status, ferias_id))
            return True
    except Exception as e:
        logger.exception("Erro ao atualizar status")
        return False
