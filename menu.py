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
        "nota PS": entrada_nao_vazia("Nota PS: "),
        "valor da obra": entrada_nao_vazia("Valor da obra: "),
        "valor devolução": entrada_nao_vazia("Valor de devolução: "),
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

    # 1. Seleção de Cliente
    for c in clientes: 
        print(f"{c[0]} - {c[1]}")
    c_id = int(entrada_nao_vazia("\nID do cliente: "))
    cliente = database.buscar_cliente_por_id(c_id)

    # 2. Seleção do MODELO (Aqui você escolhe se é Contrato, Recibo, etc.)
    # Isso vai buscar o arquivo .docx com esse nome na pasta templates
    print("\n--- MODELOS DISPONÍVEIS ---")
    print("Ex: contrato, recibo, orcamento")
    tipo_doc = entrada_nao_vazia("Digite o nome do modelo (conforme arquivo na pasta): ").lower()

    # 3. Seleção de FORMATO DE SAÍDA (Aqui aparece a opção que você sentiu falta)
    print("\n--- FORMATO DE SAÍDA ---")
    print("1. Word (.docx)")
    print("2. PDF (.pdf)")
    
    formato_opc = entrada_nao_vazia("Escolha o formato (1 ou 2): ")
    
    # Mapeamento da escolha
    formatos = {"1": "word", "2": "pdf"}
    formato = formatos.get(formato_opc, "word") # Padrão word se errar

    print(f"\n⏳ Gerando {formato.upper()} para o modelo '{tipo_doc}'...")
    
    try:
        caminho = None
        # Chama a função baseada na escolha do usuário acima
        if formato == "word":
            caminho = documents.gerar_documento_word(cliente, tipo_doc)
        elif formato == "pdf":
            caminho = documents.gerar_documento_pdf(cliente, tipo_doc)

        if caminho:
            print(f"✅ Sucesso! Arquivo salvo em: {caminho}")
            # Abre automaticamente no navegador se for PDF ou HTML
            if formato in ["pdf", "html"]:
                documents.abrir_no_navegador(caminho)
            
            database.registrar_documento_gerado(c_id, tipo_doc.capitalize(), formato, caminho)
        else:
            print("❌ Falha ao gerar o arquivo. Verifique se o template existe.")
            
    except Exception as e:
        print(f"❌ Erro técnico: {e}")
    
    input("\nPressione ENTER para voltar ao menu...")


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
