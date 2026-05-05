import os
import database
import documents
import backup_local  # Novo módulo local

def limpar_tela():
    os.system("cls" if os.name == "nt" else "clear")

def entrada_nao_vazia(mensagem):
    while True:
        valor = input(mensagem).strip()
        if valor: return valor
        print("❌ Por favor, insira um valor válido.")

def menu_cadastro_clientes():
    limpar_tela()
    print("=" * 60 + "\n           CADASTRO DE CLIENTES\n" + "=" * 60)
    
    dados = {
        "nome": entrada_nao_vazia("Nome do cliente: "),
        "cpf_cnpj": entrada_nao_vazia("CPF/CNPJ: "),
        "endereco": entrada_nao_vazia("Endereço: "),
        "telefone": entrada_nao_vazia("Telefone: "),
        "email": entrada_nao_vazia("E-mail: ")
    }

    cliente_id = database.adicionar_cliente(**dados)
    if cliente_id:
        print(f"\n✅ Cliente '{dados['nome']}' cadastrado com sucesso!")
        # Backup automático ao cadastrar
        backup_local.realizar_backup_local()
    else:
        print(f"\n❌ Erro: CPF/CNPJ já cadastrado.")
    input("\nPressione ENTER para continuar...")

def gerar_documento_menu():
    limpar_tela()
    print("=" * 60 + "\n           GERAR DOCUMENTO\n" + "=" * 60)
    
    clientes = database.listar_clientes()
    if not clientes:
        print("❌ Nenhum cliente cadastrado."); input(); return

    # Seleção de Cliente
    for c in clientes: print(f"{c[0]} - {c[1]}")
    c_id = int(entrada_nao_vazia("\nID do cliente: "))
    cliente = database.buscar_cliente_por_id(c_id)

    # Seleção de Formato
    print("\n1. HTML (Navegador)\n2. Word (.docx)\n3. Excel (.xlsx)\n4. PDF (.pdf)\n5. TXT (.txt)")
    formato_opc = entrada_nao_vazia("Escolha o formato: ")
    formatos = {"1": "html", "2": "word", "3": "excel", "4": "pdf", "5": "txt"}
    formato = formatos.get(formato_opc, "html")

    print("⏳ Gerando e salvando em 'Meus Documentos'...")
    
        # ... (dentro de gerar_documento_menu, após definir o formato)
    print("⏳ Gerando e salvando em 'Meus Documentos'...")
    
    try:
        caminho = None
        # Chamando a função correta baseada no formato escolhido
        if formato == "html":
            caminho = documents.gerar_documento_html(cliente, "contrato") # ou tipo_doc
        elif formato == "word":
            caminho = documents.gerar_documento_word(cliente, "contrato")
        elif formato == "pdf":
            caminho = documents.gerar_documento_pdf(cliente, "contrato")
        elif formato == "txt":
            caminho = documents.gerar_documento_txt(cliente, "contrato")

        if caminho:
            print(f"✅ Sucesso! Arquivo em: {caminho}")
            if formato == "html":
                documents.abrir_no_navegador(caminho)
            database.registrar_documento_gerado(c_id, "Contrato", formato, caminho)
        else:
            print("❌ Falha ao gerar o arquivo.")
            
    except Exception as e:
        print(f"❌ Erro: {e}")


def menu_backup():
    limpar_tela()
    print("=" * 60 + "\n           BACKUP LOCAL (DOCUMENTOS)\n" + "=" * 60)
    sucesso, resultado = backup_local.realizar_backup_local()
    if sucesso:
        print(f"✅ Backup realizado com sucesso!\n📍 Local: {resultado}")
    else:
        print(f"❌ Erro no backup: {resultado}")
    input("\nPressione ENTER para continuar...")

def menu_principal():
    database.inicializar_banco()
    backup_local.garantir_pastas() # Cria a estrutura em Documentos no início

    opcoes = {
        "1": menu_cadastro_clientes,
        "2": lambda: (print(database.listar_clientes()), input()), # Simplificado para exemplo
        "5": gerar_documento_menu,
        "7": menu_backup,
        "9": exit
    }

    while True:
        limpar_tela()
        print("=" * 60 + "\n     APP MUNARETTO - GESTÃO LOCAL\n" + "=" * 60)
        print("1. Cadastrar Cliente\n2. Listar Clientes\n5. Gerar Documento\n7. Sincronizar Backup Local\n9. Sair")
        
        escolha = input("\nEscolha uma opção: ")
        if escolha in opcoes:
            if escolha == "9": break
            opcoes[escolha]()
        else:
            print("Opção inválida!"); input()

if __name__ == "__main__":
    menu_principal()
