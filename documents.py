import os
import shutil
import webbrowser
from datetime import datetime
from docxtpl import DocxTemplate
from fpdf import FPDF  # Certifique-se de que é a fpdf2
from docx2pdf import convert
import tempfile
from num2words import num2words
import os
from pathlib import Path 

# 1. CONFIGURAÇÕES INICIAIS
TEMPLATES_DIR = "templates"
OUTPUT_DIR = str(os.path.join(os.path.expanduser("~"), "Downloads"))

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
def valor_por_extenso(valor_str):
    try:
        
        limpo = valor_str.replace("R$", "").replace(" ", "").replace(".", "").replace(",", ".")
        valor_float = float(limpo)
        
        # 2. Converte para extenso em português e no formato de moeda
        extenso = num2words(valor_float, lang='pt_BR', to='currency')
        return f"({extenso.capitalize()})"
    except Exception as e:
        print(f"Erro ao converter extenso: {e}")
        return ""

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
        "cep": cliente_info[5] if len(cliente_info) > 5 else "",
        "nota_ps": cliente_info[6] if len(cliente_info) > 6 else "",
        "valor_de_devolucao": cliente_info[8] if len(cliente_info) > 8 else "0,00",
        "valor_da_obra": cliente_info[7] if len(cliente_info) > 7 else "0,00",
        "valor_extenso": valor_por_extenso(cliente_info[7]) if len(cliente_info) > 7 else "",
        "data": datetime.now().strftime("%d/%m/%Y")
    }

def abrir_no_navegador(caminho_arquivo):
    """Abre o arquivo automaticamente."""
    if caminho_arquivo and os.path.exists(caminho_arquivo):
        abs_path = os.path.abspath(caminho_arquivo)
        webbrowser.open(f"file://{abs_path}")

# 4. GERAÇÃO DE WORD
def gerar_documento_word(cliente_info, tipo_documento, saida_dir=OUTPUT_DIR):
    try:
        garantir_pastas()
        contexto = criar_contexto_cliente(cliente_info)
        template_path = os.path.join(TEMPLATES_DIR, f"{tipo_documento}.docx")
        
        if not os.path.exists(template_path):
            return None

        doc = DocxTemplate(template_path)
        doc.render(contexto)

        nome_arq = f"{str(contexto['nome']).replace(' ', '_')}_{datetime.now().strftime('%H%M%S')}.docx"
        caminho = os.path.join(saida_dir, nome_arq)
        doc.save(caminho)
        return caminho
    except Exception as e:
        print(f"Erro Word: {e}")
        return None

# 5. GERAÇÃO DE PDF
def gerar_documento_pdf(cliente_info, tipo_documento):
    """Gera um PDF que é a cópia exata do Word preenchido."""
    try:
        temp_dir = tempfile.gettempdir()
        # 1. Primeiro geramos o Word normalmente
        caminho_word = gerar_documento_word(cliente_info, tipo_documento, saida_dir=temp_dir)
        
        if not caminho_word:
            return None

        # 2. Definimos o nome do PDF (mudando apenas a extensão)
        caminho_pdf = caminho_word.replace(".docx", ".pdf")

        # 3. Convertemos o Word para PDF (requer Word instalado no PC)
        # Se você estiver no Windows com Word, isso será perfeito
        convert(caminho_word, caminho_pdf)
        
        if os.path.exists(caminho_word):
            os.remove(caminho_word)

        # 4. Abre no navegador
        abrir_no_navegador(caminho_pdf)
        return caminho_pdf
    except Exception as e:
        print(f"Erro na conversão para PDF: {e}")
        return None

def importar_template_arquivo(caminho_origem):
    """Copia um arquivo docx para a pasta de templates."""
    try:
        garantir_pastas()
        nome_arquivo = os.path.basename(caminho_origem)
        if not nome_arquivo.lower().endswith(".docx"):
            return False, "O arquivo deve ser .docx"
        
        destino = os.path.join(TEMPLATES_DIR, nome_arquivo)
        shutil.copy2(caminho_origem, destino)
        return True, f"Template '{nome_arquivo}' importado com sucesso."
    except Exception as e:
        return False, str(e)
