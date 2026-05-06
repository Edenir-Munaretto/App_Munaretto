import os
import shutil
import webbrowser
from datetime import datetime
from docxtpl import DocxTemplate
from fpdf import FPDF  # Certifique-se de que é a fpdf2
from docx2pdf import convert

# 1. CONFIGURAÇÕES INICIAIS
TEMPLATES_DIR = "templates"
OUTPUT_DIR = "documentos_gerados"

def garantir_pastas():
    """Cria as pastas se não existirem."""
    os.makedirs(TEMPLATES_DIR, exist_ok=True)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

# 2. FUNÇÃO QUE A GUI (TKINTER) PRECISA (LINHA 600 DO SEU ERRO)
def get_templates():
    """Retorna os modelos disponíveis para a lista de seleção da interface."""
    garantir_pastas()
    templates = {}
    for arquivo in sorted(os.listdir(TEMPLATES_DIR)):
        if arquivo.lower().endswith(".docx"):
            nome_limpo = os.path.splitext(arquivo)[0]
            templates[nome_limpo] = {
                "nome": nome_limpo.replace("_", " ").title(),
                "docx_path": os.path.join(TEMPLATES_DIR, arquivo),
                "template": nome_limpo # Mantém compatibilidade com versões antigas
            }
    return templates

# 3. FUNÇÕES DE APOIO
def criar_contexto_cliente(cliente_info):
    """Mapeia os dados do banco de dados para o documento."""
    # Se o cliente_info vier do banco como uma tupla/lista
    return {
        "id": cliente_info[0] if len(cliente_info) > 0 else "",
        "nome": cliente_info[1] if len(cliente_info) > 1 else "",
        "cpf_cnpj": cliente_info[2] if len(cliente_info) > 2 else "",
        "endereco": cliente_info[3] if len(cliente_info) > 3 else "",
        "cidade": cliente_info[4] if len(cliente_info) > 4 else "",
        "valor_da_obra": cliente_info[7] if len(cliente_info) > 7 else "0,00",
        "data": datetime.now().strftime("%d/%m/%Y")
    }

def abrir_no_navegador(caminho_arquivo):
    """Abre o arquivo automaticamente."""
    if caminho_arquivo and os.path.exists(caminho_arquivo):
        abs_path = os.path.abspath(caminho_arquivo)
        webbrowser.open(f"file://{abs_path}")

# 4. GERAÇÃO DE WORD
def gerar_documento_word(cliente_info, tipo_documento):
    try:
        garantir_pastas()
        contexto = criar_contexto_cliente(cliente_info)
        template_path = os.path.join(TEMPLATES_DIR, f"{tipo_documento}.docx")
        
        if not os.path.exists(template_path):
            return None

        doc = DocxTemplate(template_path)
        doc.render(contexto)

        nome_arq = f"{str(contexto['nome']).replace(' ', '_')}_{datetime.now().strftime('%H%M%S')}.docx"
        caminho = os.path.join(OUTPUT_DIR, nome_arq)
        doc.save(caminho)
        return caminho
    except Exception as e:
        print(f"Erro Word: {e}")
        return None

# 5. GERAÇÃO DE PDF
def gerar_documento_pdf(cliente_info, tipo_documento):
    """Gera um PDF que é a cópia exata do Word preenchido."""
    try:
        # 1. Primeiro geramos o Word normalmente
        caminho_word = gerar_documento_word(cliente_info, tipo_documento)
        
        if not caminho_word:
            return None

        # 2. Definimos o nome do PDF (mudando apenas a extensão)
        caminho_pdf = caminho_word.replace(".docx", ".pdf")

        # 3. Convertemos o Word para PDF (requer Word instalado no PC)
        # Se você estiver no Windows com Word, isso será perfeito
        convert(caminho_word, caminho_pdf)

        # 4. Abre no navegador
        abrir_no_navegador(caminho_pdf)
        return caminho_pdf
    except Exception as e:
        print(f"Erro na conversão para PDF: {e}")
        return None
        
        # Abre no navegador após gerar
        abrir_no_navegador(caminho)
        return caminho
    except Exception as e:
        print(f"Erro PDF: {e}")
        return None
