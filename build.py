import PyInstaller.__main__
import os
import shutil

def gerar_executavel():
    """Gera o executável otimizado para o Windows."""
    icon_path = os.path.join("assets", "logo.ico")
    icon_param = ["--icon", icon_path] if os.path.exists(icon_path) else []

    # Limpeza prévia para evitar erros de permissão com arquivos residuais ou travados
    print("Limpando arquivos de builds anteriores...")
    for item in ["build", "dist", "AppMunaretto.spec"]:
        if os.path.exists(item):
            try:
                if os.path.isdir(item):
                    shutil.rmtree(item)
                else:
                    os.remove(item)
            except Exception as e:
                print(f"Aviso: Não foi possível remover '{item}': {e}. Isso pode causar erros se o arquivo estiver em uso.")

    # Garante que as pastas necessárias existam antes do build
    for folder in ["assets", "templates"]:
        if not os.path.exists(folder):
            os.makedirs(folder)
            print(f"Aviso: Pasta '{folder}' criada para evitar erros no PyInstaller.")

    params = [
        'main.py',
        '--noconfirm',
        '--onefile',
        '--windowed',
        '--add-data=assets;assets',
        '--add-data=templates;templates',
        '--hidden-import=win32com.client',
        '--hidden-import=pythoncom',
        '--hidden-import=num2words',
        '--collect-all=win32com',
        '--collect-all=num2words',
        '--collect-all=docxtpl',
        '--collect-all=fpdf',
        '--collect-all=docxcompose',
        '--name=AppMunaretto', 
        '--clean',
    ] + icon_param

    try:
        print("Iniciando a geração do executável com PyInstaller...")
        PyInstaller.__main__.run(params)
        print("\nExecutável gerado com sucesso na pasta 'dist'!")
    except PermissionError as e:
        print(f"\nERRO DE PERMISSÃO: {e}")
        print("Isso geralmente ocorre porque algum arquivo ou pasta do build está em uso.")
        print("Por favor, verifique e feche:")
        print("  - Qualquer instância do seu programa (AppMunaretto.exe) que possa estar aberta.")
        print("  - Seu editor de código (VS Code, etc.) se ele estiver com arquivos do projeto abertos.")
        print("  - Verifique se algum antivírus está bloqueando o acesso.")
        print("Tente também executar o terminal como Administrador.")
        print("\nVocê pode tentar limpar manualmente as pastas 'build' e '.spec' antes de tentar novamente.")
    except Exception as e:
        print(f"\nOcorreu um erro inesperado durante a geração do executável: {e}")
        print("Por favor, verifique as mensagens de erro acima para mais detalhes.")

if __name__ == "__main__":
    gerar_executavel()