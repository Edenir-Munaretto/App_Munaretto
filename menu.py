import os
import database
import documents
import google_drive


def limpar_tela():
    """Limpa a tela do console."""
    os.system("cls" if os.name == "nt" else "clear")


def entrada_nao_vazia(mensagem):
    """Garante que o usuário insira um valor não vazio."""
    while True:
        valor = input(mensagem).strip()
        if valor:
            return valor
        print("❌ Por favor, insira um valor válido.")


def menu_cadastro_clientes():
    """Menu para cadastro de clientes."""
    limpar_tela()
    print("=" * 60)
    print("           CADASTRO DE CLIENTES")
    print("=" * 60)

    nome = entrada_nao_vazia("Nome do cliente: ")
    cpf_cnpj = entrada_nao_vazia("CPF/CNPJ: ")
    endereco = entrada_nao_vazia("Endereço: ")
    telefone = entrada_nao_vazia("Telefone: ")
    email = entrada_nao_vazia("E-mail: ")

    cliente_id = database.adicionar_cliente(nome, cpf_cnpj, endereco, telefone, email)

    if cliente_id:
        print(f"\n✅ Cliente '{nome}' cadastrado com sucesso! (ID: {cliente_id})")
    else:
        print(f"\n❌ Erro: Já existe um cliente com o CPF/CNPJ '{cpf_cnpj}'")

    input("\nPressione ENTER para continuar...")


def listar_clientes_menu():
    """Menu para listar clientes."""
    limpar_tela()
    print("=" * 60)
    print("           LISTA DE CLIENTES")
    print("=" * 60)

    clientes = database.listar_clientes()

    if not clientes:
        print("❌ Nenhum cliente cadastrado ainda.")
    else:
        print(f"\n{'ID':<5} {'Nome':<25} {'CPF/CNPJ':<18} {'Telefone':<15}")
        print("-" * 65)
        for cliente in clientes:
            print(
                f"{cliente[0]:<5} {cliente[1]:<25} {cliente[2]:<18} {cliente[4]:<15}"
            )

    input("\nPressione ENTER para continuar...")


def editar_cliente_menu():
    """Menu para editar um cliente."""
    limpar_tela()
    print("=" * 60)
    print("           EDITAR CLIENTE")
    print("=" * 60)

    clientes = database.listar_clientes()

    if not clientes:
        print("❌ Nenhum cliente cadastrado.")
        input("Pressione ENTER para continuar...")
        return

    listar_clientes_menu()

    while True:
        try:
            cliente_id = int(entrada_nao_vazia("Digite o ID do cliente a editar (0 para cancelar): "))
            if cliente_id == 0:
                return
            cliente = database.buscar_cliente_por_id(cliente_id)
            if cliente:
                break
            print("❌ Cliente não encontrado.")
        except ValueError:
            print("❌ ID inválido.")

    limpar_tela()
    print(f"Editando: {cliente[1]}")
    print("-" * 60)

    nome = entrada_nao_vazia(f"Nome ({cliente[1]}): ")
    cpf_cnpj = entrada_nao_vazia(f"CPF/CNPJ ({cliente[2]}): ")
    endereco = entrada_nao_vazia(f"Endereço ({cliente[3]}): ")
    telefone = entrada_nao_vazia(f"Telefone ({cliente[4]}): ")
    email = entrada_nao_vazia(f"E-mail ({cliente[5]}): ")

    if database.atualizar_cliente(cliente_id, nome, cpf_cnpj, endereco, telefone, email):
        print(f"\n✅ Cliente atualizado com sucesso!")
    else:
        print(f"\n❌ Erro ao atualizar cliente.")

    input("\nPressione ENTER para continuar...")


def deletar_cliente_menu():
    """Menu para deletar um cliente."""
    limpar_tela()
    print("=" * 60)
    print("           DELETAR CLIENTE")
    print("=" * 60)

    clientes = database.listar_clientes()

    if not clientes:
        print("❌ Nenhum cliente cadastrado.")
        input("Pressione ENTER para continuar...")
        return

    listar_clientes_menu()

    while True:
        try:
            cliente_id = int(entrada_nao_vazia("Digite o ID do cliente a deletar (0 para cancelar): "))
            if cliente_id == 0:
                return
            cliente = database.buscar_cliente_por_id(cliente_id)
            if cliente:
                break
            print("❌ Cliente não encontrado.")
        except ValueError:
            print("❌ ID inválido.")

    print(f"\n⚠️  Confirma a exclusão de '{cliente[1]}'?")
    confirmacao = entrada_nao_vazia("Digite 'SIM' para confirmar: ")

    if confirmacao.upper() == "SIM":
        database.deletar_cliente(cliente_id)
        print(f"✅ Cliente deletado com sucesso!")
    else:
        print("❌ Operação cancelada.")

    input("\nPressione ENTER para continuar...")


def gerar_documento_menu():
    """Menu para gerar documentos."""
    limpar_tela()
    print("=" * 60)
    print("           GERAR DOCUMENTO")
    print("=" * 60)

    clientes = database.listar_clientes()

    if not clientes:
        print("❌ Nenhum cliente cadastrado.")
        input("Pressione ENTER para continuar...")
        return

    # Selecionar cliente
    listar_clientes_menu()

    while True:
        try:
            cliente_id = int(entrada_nao_vazia("Digite o ID do cliente: "))
            cliente = database.buscar_cliente_por_id(cliente_id)
            if cliente:
                break
            print("❌ Cliente não encontrado.")
        except ValueError:
            print("❌ ID inválido.")

    limpar_tela()
    print("=" * 60)
    print(f"Cliente: {cliente[1]}")
    print("=" * 60)
    print("\nTIPOS DE DOCUMENTOS:")
    templates = documents.get_templates()
    for i, (chave, info) in enumerate(templates.items(), 1):
        print(f"{i}. {info['nome']}")

    while True:
        try:
            opcao = int(entrada_nao_vazia("Escolha o tipo de documento (0 para cancelar): "))
            if opcao == 0:
                return
            tipos = list(templates.keys())
            if 0 < opcao <= len(tipos):
                tipo_doc = tipos[opcao - 1]
                break
            print("❌ Opção inválida.")
        except ValueError:
            print("❌ Entrada inválida.")

    limpar_tela()
    print("=" * 60)
    print("FORMATOS DE SAÍDA:")
    print("=" * 60)
    print("1. HTML (Visualizar no navegador)")
    print("2. Word (.docx)")
    print("3. PDF (.pdf)")
    print("4. Texto (.txt)")

    while True:
        try:
            opcao_formato = int(entrada_nao_vazia("Escolha o formato (0 para cancelar): "))
            if opcao_formato == 0:
                return
            if 1 <= opcao_formato <= 4:
                break
            print("❌ Opção inválida.")
        except ValueError:
            print("❌ Entrada inválida.")

    formatos = {1: "html", 2: "word", 3: "pdf", 4: "txt"}
    formato = formatos[opcao_formato]

    # Gerar documento
    limpar_tela()
    print("⏳ Gerando documento...")

    try:
        if formato == "html":
            caminho = documents.gerar_documento_html(cliente, tipo_doc)
            if caminho:
                print(f"✅ Documento gerado: {caminho}")
                abrir = entrada_nao_vazia("\nAbrir no navegador? (S/N): ")
                if abrir.upper() == "S":
                    documents.abrir_no_navegador(caminho)
        elif formato == "word":
            caminho = documents.gerar_documento_word(cliente, tipo_doc)
            if caminho:
                print(f"✅ Documento gerado: {caminho}")
            else:
                print("❌ Erro: python-docx não está instalado. Use: pip install python-docx")
        elif formato == "pdf":
            caminho = documents.gerar_documento_pdf(cliente, tipo_doc)
            if caminho:
                print(f"✅ Documento gerado: {caminho}")
            else:
                print("❌ Erro: fpdf2 não está instalado. Use: pip install fpdf2")
        elif formato == "txt":
            caminho = documents.gerar_documento_txt(cliente, tipo_doc)
            if caminho:
                print(f"✅ Documento gerado: {caminho}")

        if caminho:
            database.registrar_documento_gerado(cliente_id, tipo_doc, formato, caminho)

    except Exception as e:
        print(f"❌ Erro ao gerar documento: {e}")

    input("\nPressione ENTER para continuar...")


def historico_cliente_menu():
    """Menu para visualizar histórico de documentos."""
    limpar_tela()
    print("=" * 60)
    print("           HISTÓRICO DE DOCUMENTOS")
    print("=" * 60)

    clientes = database.listar_clientes()

    if not clientes:
        print("❌ Nenhum cliente cadastrado.")
        input("Pressione ENTER para continuar...")
        return

    listar_clientes_menu()

    while True:
        try:
            cliente_id = int(entrada_nao_vazia("Digite o ID do cliente (0 para cancelar): "))
            if cliente_id == 0:
                return
            cliente = database.buscar_cliente_por_id(cliente_id)
            if cliente:
                break
            print("❌ Cliente não encontrado.")
        except ValueError:
            print("❌ ID inválido.")

    limpar_tela()
    print(f"Histórico de: {cliente[1]}")
    print("=" * 60)

    historico = database.obter_historico_cliente(cliente_id)

    if not historico:
        print("❌ Nenhum documento gerado para este cliente.")
    else:
        print(
            f"\n{'Tipo':<15} {'Formato':<10} {'Data Geração':<20} {'Arquivo':<20}"
        )
        print("-" * 65)
        for doc in historico:
            tipo, formato, arquivo, data = doc
            nome_arquivo = os.path.basename(arquivo)
            print(f"{tipo:<15} {formato:<10} {data:<20} {nome_arquivo:<20}")

    input("\nPressione ENTER para continuar...")


def backup_google_drive_menu():
    """Menu para sincronizar com Google Drive."""
    limpar_tela()
    print("=" * 60)
    print("           SINCRONIZAR COM GOOGLE DRIVE")
    print("=" * 60)

    print("\n⏳ Criando backup...")

    backup_json = database.salvar_backup_json()
    if backup_json:
        print(f"✅ Backup criado: {backup_json}")

    print("\n⏳ Sincronizando com Google Drive...")
    if google_drive.sincronizar_backup_drive():
        print("✅ Sincronização concluída!")
    else:
        print("❌ Erro ao sincronizar. Verifique suas credenciais do Google.")

    input("\nPressione ENTER para continuar...")


def importar_modelo_menu():
    """Menu para importar um modelo de documento."""
    limpar_tela()
    print("=" * 60)
    print("           IMPORTAR MODELO DE DOCUMENTO")
    print("=" * 60)
    print("\nEste recurso permite enviar um arquivo .txt para usar como template de documento.")
    print("Use placeholders como {nome}, {cpf_cnpj}, {endereco}, {telefone}, {email} e {data}.")
    print("\nExemplo de nome de arquivo: meu_contrato.txt")

    caminho_origem = entrada_nao_vazia("Caminho do arquivo .txt para importar: ")
    sucesso, resultado = documents.importar_template_arquivo(caminho_origem)

    if sucesso:
        print(f"\n✅ Modelo importado com sucesso: {resultado}")
    else:
        print(f"\n❌ Falha ao importar modelo: {resultado}")

    input("\nPressione ENTER para continuar...")


def menu_principal():
    """Menu principal do programa."""
    database.inicializar_banco()

    while True:
        limpar_tela()
        print("=" * 60)
        print("     GERENCIADOR DE CONTRATOS - APP MUNARETTO")
        print("=" * 60)
        print("\n1. Cadastrar cliente")
        print("2. Listar clientes")
        print("3. Editar cliente")
        print("4. Deletar cliente")
        print("5. Gerar documento")
        print("6. Histórico de documentos")
        print("7. Backup no Google Drive")
        print("8. Importar modelo de documento")
        print("9. Sair")
        print("\n" + "=" * 60)

        opcao = entrada_nao_vazia("Escolha uma opção: ")

        if opcao == "1":
            menu_cadastro_clientes()
        elif opcao == "2":
            listar_clientes_menu()
        elif opcao == "3":
            editar_cliente_menu()
        elif opcao == "4":
            deletar_cliente_menu()
        elif opcao == "5":
            gerar_documento_menu()
        elif opcao == "6":
            historico_cliente_menu()
        elif opcao == "7":
            backup_google_drive_menu()
        elif opcao == "8":
            importar_modelo_menu()
        elif opcao == "9":
            print("\n👋 Até logo!")
            break
        else:
            print("❌ Opção inválida. Tente novamente.")
            input("Pressione ENTER para continuar...")
