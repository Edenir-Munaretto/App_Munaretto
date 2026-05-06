"""
Script de teste para demonstrar as funcionalidades do gerenciador de contratos.
Cria alguns clientes de teste e gera documentos automaticamente.
"""

import database
import documents
import os

def criar_dados_teste():
    """Cria dados de teste no banco de dados."""
    database.inicializar_banco()
    
    # Limpar clientes anteriores se existirem
    clientes_teste = [
        ("João Silva", "12345678901", "Rua A, 123", "São Paulo", "01234567"),
        ("Maria Santos", "98765432109", "Rua B, 456", "Rio de Janeiro", "20001000"),
        ("Tech Solutions", "12345678901234", "Av. Principal, 789", "Belo Horizonte", "30001000"),
    ]
    
    for nome, cpf_cnpj, endereco, cidade, cep in clientes_teste:
        cliente_id = database.adicionar_cliente(nome, cpf_cnpj, endereco, cidade, cep)
        if cliente_id:
            print(f"✅ Cliente criado: {nome} (ID: {cliente_id})")

def gerar_documentos_teste():
    """Gera documentos de teste em diferentes formatos."""
    clientes = database.listar_clientes()
    
    if not clientes:
        print("❌ Nenhum cliente disponível.")
        return
    
    cliente = clientes[0]
    tipos_doc = ["contrato", "declaracao", "recibo", "proposta"]
    
    print("\n📄 Gerando documentos de teste...\n")
    
    for tipo in tipos_doc:
        # HTML
        caminho_html = documents.gerar_documento_html(cliente, tipo)
        if caminho_html:
            print(f"✅ HTML gerado: {caminho_html}")
            database.registrar_documento_gerado(cliente[0], tipo, "html", caminho_html)
        
        # Word
        caminho_word = documents.gerar_documento_word(cliente, tipo)
        if caminho_word:
            print(f"✅ Word gerado: {caminho_word}")
            database.registrar_documento_gerado(cliente[0], tipo, "word", caminho_word)
        else:
            print(f"⚠️  Word não disponível para {tipo}")
        
        # PDF
        caminho_pdf = documents.gerar_documento_pdf(cliente, tipo)
        if caminho_pdf:
            print(f"✅ PDF gerado: {caminho_pdf}")
            database.registrar_documento_gerado(cliente[0], tipo, "pdf", caminho_pdf)
        else:
            print(f"⚠️  PDF não disponível para {tipo}")
        
        # TXT
        caminho_txt = documents.gerar_documento_txt(cliente, tipo)
        if caminho_txt:
            print(f"✅ TXT gerado: {caminho_txt}")
            database.registrar_documento_gerado(cliente[0], tipo, "txt", caminho_txt)

def exibir_historico():
    """Exibe histórico de documentos gerados."""
    clientes = database.listar_clientes()
    
    if clientes:
        cliente = clientes[0]
        historico = database.obter_historico_cliente(cliente[0])
        
        print(f"\n📋 Histórico de {cliente[1]}:")
        print("-" * 50)
        
        if historico:
            for tipo, formato, caminho, data in historico:
                print(f"  {tipo:<15} {formato:<10} {data}")
        else:
            print("  (vazio)")

def testar_backup():
    """Testa criação de backup JSON."""
    print("\n💾 Criando backup JSON...")
    backup = database.salvar_backup_json()
    if backup:
        print(f"✅ Backup criado: {backup}")
        
        # Exibir conteúdo do backup
        import json
        with open(backup, 'r', encoding='utf-8') as f:
            dados = json.load(f)
            print(f"✅ Total de clientes no backup: {len(dados)}")

if __name__ == "__main__":
    print("=" * 60)
    print("  TESTE DO GERENCIADOR DE CONTRATOS")
    print("=" * 60)
    
    # Criar dados de teste
    print("\n1️⃣  Criando dados de teste...")
    criar_dados_teste()
    
    # Gerar documentos
    print("\n2️⃣  Gerando documentos...")
    gerar_documentos_teste()
    
    # Exibir histórico
    print("\n3️⃣  Histórico de documentos:")
    exibir_historico()
    
    # Backup JSON
    print("\n4️⃣  Backup de dados:")
    testar_backup()
    
    print("\n" + "=" * 60)
    print("✅ Teste concluído com sucesso!")
    print("=" * 60)
    print("\n💡 Agora execute: python main.py")
