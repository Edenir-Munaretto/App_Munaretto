import sqlite3
import json
import os
from datetime import datetime

DATABASE_FILE = "clientes.db"


def inicializar_banco():
    """Cria tabelas do banco se não existirem."""
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS clientes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            cpf_cnpj TEXT NOT NULL UNIQUE,
            endereco TEXT NOT NULL,
            telefone TEXT NOT NULL,
            email TEXT NOT NULL,
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


def adicionar_cliente(nome, cpf_cnpj, endereco, telefone, email):
    """Adiciona um novo cliente ao banco de dados."""
    try:
        conn = sqlite3.connect(DATABASE_FILE)
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO clientes (nome, cpf_cnpj, endereco, telefone, email)
            VALUES (?, ?, ?, ?, ?)
        """,
            (nome, cpf_cnpj, endereco, telefone, email),
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
    cursor.execute("SELECT * FROM clientes WHERE ativo = 1 ORDER BY nome")
    clientes = cursor.fetchall()
    conn.close()
    return clientes


def buscar_cliente_por_id(cliente_id):
    """Busca um cliente específico pelo ID."""
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM clientes WHERE id = ?", (cliente_id,))
    cliente = cursor.fetchone()
    conn.close()
    return cliente


def atualizar_cliente(cliente_id, nome, cpf_cnpj, endereco, telefone, email):
    """Atualiza dados de um cliente."""
    try:
        conn = sqlite3.connect(DATABASE_FILE)
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE clientes
            SET nome = ?, cpf_cnpj = ?, endereco = ?, telefone = ?, email = ?
            WHERE id = ?
        """,
            (nome, cpf_cnpj, endereco, telefone, email, cliente_id),
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
                "telefone": cliente[4],
                "email": cliente[5],
                "data_cadastro": cliente[6],
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
