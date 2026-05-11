import sqlite3
import json
import os
from datetime import datetime, timedelta
from typing import List, Tuple, Dict, Optional, Any

DATABASE_FILE = r"G:\Meu Drive\BANCO_DE_DADOS\clientes.db"


def inicializar_banco():
    """Cria tabelas do banco se não existirem."""
    # Garante que a pasta no Google Drive exista
    os.makedirs(os.path.dirname(DATABASE_FILE), exist_ok=True)
    
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
            status TEXT DEFAULT 'Agendado',
            data_registro TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """
    )



    conn.commit()
    conn.close()


def adicionar_cliente(nome, cpf_cnpj, endereco, cidade=None, cep=None, nota_ps=None, valor_da_obra=None, valor_de_devolucao=None):
    """Adiciona um novo cliente ao banco de dados."""
    try:
        conn = sqlite3.connect(DATABASE_FILE)
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO clientes (nome, cpf_cnpj, endereco, cidade, cep, nota_ps, valor_da_obra, valor_de_devolucao)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (nome, cpf_cnpj, endereco, cidade, cep, nota_ps, valor_da_obra, valor_de_devolucao)
        )
        conn.commit()
        cliente_id = cursor.lastrowid
        conn.close()
        return cliente_id
    except sqlite3.IntegrityError:
        return None


def listar_clientes():
    """Retorna lista de todos os clientes."""
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, nome, cpf_cnpj, endereco, cidade, cep, nota_ps, valor_da_obra, valor_de_devolucao, data_cadastro, ativo "
        "FROM clientes WHERE ativo = 1 ORDER BY nome"
    )
    clientes = cursor.fetchall()
    conn.close()
    return clientes


def buscar_cliente_por_id(cliente_id):
    """Busca um cliente específico pelo ID."""
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, nome, cpf_cnpj, endereco, cidade, cep, nota_ps, valor_da_obra, valor_de_devolucao, data_cadastro, ativo "
        "FROM clientes WHERE id = ?",
        (cliente_id,),
    )
    cliente = cursor.fetchone()
    conn.close()
    return cliente


def atualizar_cliente(cliente_id, nome, cpf_cnpj, endereco, cidade=None, cep=None, nota_ps=None, valor_da_obra=None, valor_de_devolucao=None):
    """Atualiza dados de um cliente."""
    try:
        conn = sqlite3.connect(DATABASE_FILE)
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE clientes
            SET nome = ?, cpf_cnpj = ?, endereco = ?, cidade = ?, cep = ?, nota_ps = ?, valor_da_obra = ?, valor_de_devolucao = ?
            WHERE id = ?
        """,
            (nome, cpf_cnpj, endereco, cidade, cep, nota_ps, valor_da_obra, valor_de_devolucao, cliente_id)
        )
        conn.commit()
        conn.close()
        return True
    except sqlite3.IntegrityError:
        return False


def deletar_cliente(cliente_id):
    """Marca um cliente como inativo (soft delete)."""
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()
    cursor.execute("UPDATE clientes SET ativo = 0 WHERE id = ?", (cliente_id,))
    conn.commit()
    conn.close()


def registrar_documento_gerado(cliente_id, tipo_documento, formato, caminho_arquivo):
    """Registra um documento gerado no histórico."""
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO documentos_gerados (cliente_id, tipo_documento, formato, caminho_arquivo)
        VALUES (?, ?, ?, ?)
    """,
        (cliente_id, tipo_documento, formato, caminho_arquivo),
    )
    conn.commit()
    conn.close()


def salvar_fluxo_caixa(dados):
    """Salva o fechamento do fluxo de caixa mensal."""
    try:
        conn = sqlite3.connect(DATABASE_FILE)
        cursor = conn.cursor()
        query = f"INSERT INTO fluxo_caixa ({', '.join(dados.keys())}) VALUES ({', '.join(['?' for _ in dados])})"
        cursor.execute(query, list(dados.values()))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"Erro ao salvar fluxo: {e}")
        return False


def obter_historico_cliente(cliente_id):
    """Retorna histórico de documentos gerados de um cliente."""
    conn = sqlite3.connect(DATABASE_FILE)
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
    conn.close()
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
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT id, mes_referencia, total_liquido FROM fluxo_caixa ORDER BY data_registro DESC")
    fluxos = cursor.fetchall()
    conn.close()
    return fluxos

def buscar_fluxo_por_id(fluxo_id):
    """Busca os dados brutos de um fluxo pelo ID para edição."""
    conn = sqlite3.connect(DATABASE_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM fluxo_caixa WHERE id = ?", (fluxo_id,))
    row = cursor.fetchone()
    conn.close()
    return row

def atualizar_fluxo_caixa(fluxo_id, dados):
    """Atualiza um registro de fluxo de caixa existente."""
    try:
        conn = sqlite3.connect(DATABASE_FILE)
        cursor = conn.cursor()
        sets = ", ".join([f"{k} = ?" for k in dados.keys()])
        query = f"UPDATE fluxo_caixa SET {sets} WHERE id = ?"
        cursor.execute(query, list(dados.values()) + [fluxo_id])
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"Erro ao atualizar fluxo: {e}")
        return False

def deletar_fluxo_caixa(fluxo_id):
    """Remove um registro de fluxo de caixa."""
    try:
        conn = sqlite3.connect(DATABASE_FILE)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM fluxo_caixa WHERE id = ?", (fluxo_id,))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"Erro ao deletar fluxo: {e}")
        return False

def buscar_dados_fluxo_por_mes(mes_referencia):
    conn = sqlite3.connect(DATABASE_FILE) # Use o caminho que configuramos antes
    conn.row_factory = sqlite3.Row # Permite acessar colunas pelo nome
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM fluxo_caixa WHERE mes_referencia = ?", (mes_referencia,))
    row = cursor.fetchone()
    conn.close()

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
            "Taxas Bancárias": fmt(row['despesa_taxa']),
            "Diversas": fmt(row['despesa_diversas'])
        }
        
        total_liquido = fmt(row['total_liquido'])
        
        return dados_usinas, dados_despesas, total_liquido
    return None

def adicionar_ferias(nome: str, data_inicio_str: str, dias_abono: int, data_limite_str: str) -> Tuple[bool, str]:
    """Calcula e salva as férias de um colaborador."""
    try:
        if dias_abono > 10:
            return False, "O abono pecuniário não pode ser superior a 10 dias."

        dt_inicio = datetime.strptime(data_inicio_str, "%Y-%m-%d")
        dias_gozo = 30 - dias_abono
        dt_retorno = dt_inicio + timedelta(days=dias_gozo)
        data_retorno_str = dt_retorno.strftime("%Y-%m-%d")
        
        # Se a data limite não for informada, calcula 1 ano após o início por padrão
        if not data_limite_str:
            dt_limite = dt_inicio + timedelta(days=365)
            data_limite_str = dt_limite.strftime("%Y-%m-%d")

        conn = sqlite3.connect(DATABASE_FILE)
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO gestao_ferias (nome, data_inicio, dias_abono, dias_gozo, data_retorno, data_limite, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (nome, data_inicio_str, dias_abono, dias_gozo, data_retorno_str, data_limite_str, "Agendado")
        )
        conn.commit()
        conn.close()
        return True, "Férias agendadas com sucesso."
    except Exception as e:
        return False, f"Erro ao salvar férias: {e}"

def deletar_ferias(ferias_id: int) -> bool:
    """Remove um registro de férias do banco de dados."""
    try:
        conn = sqlite3.connect(DATABASE_FILE)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM gestao_ferias WHERE id = ?", (ferias_id,))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"Erro ao deletar férias: {e}")
        return False

def listar_ferias_proximo_mes() -> List[sqlite3.Row]:
    """Retorna colaboradores com férias no mês seguinte."""
    conn = sqlite3.connect(DATABASE_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    hoje = datetime.now()
    primeiro_dia_prox_mes = (hoje.replace(day=1) + timedelta(days=32)).replace(day=1)
    ultimo_dia_prox_mes = (primeiro_dia_prox_mes + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    
    cursor.execute(
        "SELECT * FROM gestao_ferias WHERE data_inicio BETWEEN ? AND ?",
        (primeiro_dia_prox_mes.strftime("%Y-%m-%d"), ultimo_dia_prox_mes.strftime("%Y-%m-%d"))
    )
    rows = cursor.fetchall()
    conn.close()
    return rows

def obter_alertas_ferias() -> List[Dict[str, Any]]:
    """Retorna dados de colaboradores próximos à data limite."""
    conn = sqlite3.connect(DATABASE_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT nome, data_limite FROM gestao_ferias")
    dados = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return dados

def buscar_ferias_por_colaborador(nome: str) -> List[sqlite3.Row]:
    """Busca o histórico de férias de um colaborador específico."""
    conn = sqlite3.connect(DATABASE_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM gestao_ferias WHERE nome LIKE ? ORDER BY data_inicio DESC",
        (f"%{nome}%",)
    )
    rows = cursor.fetchall()
    conn.close()
    return rows

def atualizar_status_ferias(ferias_id: int, novo_status: str) -> bool:
    """Atualiza o status de um registro de férias (ex: 'Gozadas', 'Cancelado')."""
    try:
        conn = sqlite3.connect(DATABASE_FILE)
        cursor = conn.cursor()
        cursor.execute("UPDATE gestao_ferias SET status = ? WHERE id = ?", (novo_status, ferias_id))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"Erro ao atualizar status: {e}")
        return False
