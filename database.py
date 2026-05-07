import sqlite3
import json
import os
from datetime import datetime

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
