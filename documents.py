import os
import shutil
import webbrowser
from datetime import datetime

TEMPLATES_DIR = "templates"

# Templates de documentos
TEMPLATES = {
    "contrato": {
        "nome": "Contrato de Prestação de Serviços",
        "template": """CONTRATO DE PRESTAÇÃO DE SERVIÇOS

CONTRATANTE: {nome}
CPF/CNPJ: {cpf_cnpj}
Endereço: {endereco}
Telefone: {telefone}
E-mail: {email}

CONTRATADO: [Inserir dados do contratado]

OBJETO:
A CONTRATANTE contrata a CONTRATADA para prestação de serviços de consultoria, conforme descrito a seguir:
[Descrever detalhes do serviço]

VALOR:
O valor total dos serviços será de R$ [inserir valor], a ser pago conforme condições acertadas.

PRAZO:
O prazo para realização dos serviços é de [inserir prazo].

VALIDADE:
Este contrato vigorará a partir de {data} até a conclusão dos serviços.

CONFIDENCIALIDADE:
As partes comprometem-se em manter sigilo sobre informações confidenciais compartilhadas.

RESCISÃO:
Qualquer das partes poderá rescindir este contrato com [inserir prazo] de antecedência.

LOCAL:
Os serviços serão prestados em: [inserir local]

FORO:
Fica eleito o foro da comarca de [inserir cidade] para dirimir qualquer dúvida que possa surgir.

Assinado em {data}

_______________________________          _______________________________
Assinatura Contratante                 Assinatura Contratado
""",
    },
    "declaracao": {
        "nome": "Declaração",
        "template": """DECLARAÇÃO

Eu, {nome}, portador(a) do CPF/CNPJ {cpf_cnpj}, residente e domiciliado(a) à {endereco}, 
telefone {telefone}, e-mail {email}, por este meio declaro que:

[Inserir motivo da declaração]

Declaro, ainda, que as informações aqui prestadas são verdadeiras e completas, sob as 
penas da lei.

Assinado em {data}

_______________________________
{nome}
""",
    },
    "recibo": {
        "nome": "Recibo",
        "template": """RECIBO

Recebemos de {nome}, portador(a) do CPF/CNPJ {cpf_cnpj}, a quantia de R$ [inserir valor]
referente a [inserir motivo do pagamento].

Endereço: {endereco}
Telefone: {telefone}
E-mail: {email}

Data: {data}

_______________________________
Recebedor
""",
    },
    "proposta": {
        "nome": "Proposta Comercial",
        "template": """PROPOSTA COMERCIAL

PROPONENTE: [Sua Empresa]

CLIENTE:
Nome: {nome}
CPF/CNPJ: {cpf_cnpj}
Endereço: {endereco}
Telefone: {telefone}
E-mail: {email}

PROPOSTA:
Segue a proposta de serviços/produtos conforme solicitação:

[Descrever itens e valores]

VALIDADE DA PROPOSTA:
Esta proposta é válida por 30 dias a contar de {data}.

CONDIÇÕES DE PAGAMENTO:
[Inserir condições]

PRAZOS DE ENTREGA:
[Inserir prazos]

Atenciosamente,

_______________________________
Responsável pela Proposta
""",
    },
}


def ensure_templates_dir():
    """Cria a pasta de templates de documento se não existir."""
    os.makedirs(TEMPLATES_DIR, exist_ok=True)


def carregar_templates_externos():
    """Carrega templates salvos em arquivos na pasta de templates."""
    ensure_templates_dir()
    templates = {}
    for nome_arquivo in sorted(os.listdir(TEMPLATES_DIR)):
        if nome_arquivo.lower().endswith(".txt"):
            chave = os.path.splitext(nome_arquivo)[0]
            caminho = os.path.join(TEMPLATES_DIR, nome_arquivo)
            with open(caminho, "r", encoding="utf-8") as f:
                conteudo = f.read()
            templates[chave] = {
                "nome": f"Modelo: {chave}",
                "template": conteudo,
            }
    return templates


def get_templates():
    """Retorna todos os templates disponíveis, incluindo modelos carregados."""
    templates = dict(TEMPLATES)
    templates.update(carregar_templates_externos())
    return templates


def get_template(tipo_documento):
    """Retorna o template solicitado, incluindo modelos externos."""
    return get_templates().get(tipo_documento)


def importar_template_arquivo(caminho_origem):
    """Importa um arquivo TXT para a pasta de templates."""
    ensure_templates_dir()
    if not os.path.exists(caminho_origem):
        return False, "Arquivo não encontrado."
    if not caminho_origem.lower().endswith(".txt"):
        return False, "Apenas arquivos .txt são suportados como modelo."

    nome_arquivo = os.path.basename(caminho_origem)
    destino = os.path.join(TEMPLATES_DIR, nome_arquivo)
    shutil.copyfile(caminho_origem, destino)
    return True, destino


def criar_pasta_documentos():
    """Cria pasta para armazenar documentos gerados."""
    os.makedirs("documentos_gerados", exist_ok=True)


def gerar_documento_txt(cliente_info, tipo_documento):
    """Gera documento em formato TXT."""
    criar_pasta_documentos()

    template_info = get_template(tipo_documento)
    if not template_info:
        return None

    data_atual = datetime.now().strftime("%d/%m/%Y")
    template = template_info["template"]

    conteudo = template.format(
        nome=cliente_info[1],
        cpf_cnpj=cliente_info[2],
        endereco=cliente_info[3],
        telefone=cliente_info[4],
        email=cliente_info[5],
        data=data_atual,
    )

    nome_arquivo = f"{cliente_info[1].replace(' ', '_')}_{tipo_documento}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
    caminho = os.path.join("documentos_gerados", nome_arquivo)

    with open(caminho, "w", encoding="utf-8") as f:
        f.write(conteudo)

    return caminho


def gerar_documento_html(cliente_info, tipo_documento):
    """Gera documento em formato HTML para visualização no navegador."""
    criar_pasta_documentos()

    template_info = get_template(tipo_documento)
    if not template_info:
        return None

    data_atual = datetime.now().strftime("%d/%m/%Y")
    template = template_info["template"]

    conteudo = template.format(
        nome=cliente_info[1],
        cpf_cnpj=cliente_info[2],
        endereco=cliente_info[3],
        telefone=cliente_info[4],
        email=cliente_info[5],
        data=data_atual,
    )

    html_content = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{template_info['nome']}</title>
    <style>
        body {{
            font-family: 'Arial', sans-serif;
            max-width: 900px;
            margin: 20px auto;
            padding: 20px;
            background-color: #f5f5f5;
        }}
        .container {{
            background-color: white;
            padding: 40px;
            border-radius: 5px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }}
        h1 {{
            text-align: center;
            color: #333;
            margin-bottom: 30px;
        }}
        .content {{
            line-height: 1.8;
            color: #555;
            white-space: pre-wrap;
            word-wrap: break-word;
        }}
        .print-button {{
            text-align: center;
            margin-top: 30px;
        }}
        button {{
            background-color: #4CAF50;
            color: white;
            padding: 10px 30px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
        }}
        button:hover {{
            background-color: #45a049;
        }}
        @media print {{
            body {{ background-color: white; }}
            .print-button {{ display: none; }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>{template_info['nome']}</h1>
        <div class="content">
{conteudo}
        </div>
        <div class="print-button">
            <button onclick="window.print()">🖨️ Imprimir</button>
        </div>
    </div>
</body>
</html>
"""

    nome_arquivo = f"{cliente_info[1].replace(' ', '_')}_{tipo_documento}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.html"
    caminho = os.path.join("documentos_gerados", nome_arquivo)

    with open(caminho, "w", encoding="utf-8") as f:
        f.write(html_content)

    return caminho


def gerar_documento_word(cliente_info, tipo_documento):
    """Gera documento em formato Word (.docx)."""
    try:
        from docx import Document
        from docx.shared import Pt, Inches
        from docx.enum.text import WD_ALIGN_PARAGRAPH

        criar_pasta_documentos()

        template_info = get_template(tipo_documento)
        if not template_info:
            return None

        data_atual = datetime.now().strftime("%d/%m/%Y")
        template = template_info["template"]

        conteudo = template.format(
            nome=cliente_info[1],
            cpf_cnpj=cliente_info[2],
            endereco=cliente_info[3],
            telefone=cliente_info[4],
            email=cliente_info[5],
            data=data_atual,
        )

        doc = Document()

        # Título
        titulo = doc.add_heading(template_info["nome"], level=1)
        titulo.alignment = WD_ALIGN_PARAGRAPH.CENTER

        # Conteúdo
        for paragrafo_texto in conteudo.split("\n"):
            p = doc.add_paragraph(paragrafo_texto)
            p.paragraph_format.line_spacing = 1.5

        nome_arquivo = f"{cliente_info[1].replace(' ', '_')}_{tipo_documento}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.docx"
        caminho = os.path.join("documentos_gerados", nome_arquivo)
        doc.save(caminho)

        return caminho
    except ImportError:
        return None


def gerar_documento_pdf(cliente_info, tipo_documento):
    """Gera documento em formato PDF (.pdf)."""
    try:
        from fpdf import FPDF

        criar_pasta_documentos()

        template_info = get_template(tipo_documento)
        if not template_info:
            return None

        data_atual = datetime.now().strftime("%d/%m/%Y")
        template = template_info["template"]

        conteudo = template.format(
            nome=cliente_info[1],
            cpf_cnpj=cliente_info[2],
            endereco=cliente_info[3],
            telefone=cliente_info[4],
            email=cliente_info[5],
            data=data_atual,
        )

        pdf = FPDF()
        pdf.add_page()
        pdf.set_font("Arial", "B", 16)
        pdf.cell(0, 10, template_info["nome"], ln=True, align="C")
        pdf.ln(5)
        
        pdf.set_font("Arial", "", 11)
        pdf.multi_cell(0, 5, conteudo)

        nome_arquivo = f"{cliente_info[1].replace(' ', '_')}_{tipo_documento}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
        caminho = os.path.join("documentos_gerados", nome_arquivo)

        pdf.output(caminho)

        return caminho
    except ImportError:
        return None


def abrir_no_navegador(caminho_arquivo):
    """Abre arquivo HTML no navegador padrão."""
    if caminho_arquivo.endswith(".html"):
        webbrowser.open("file://" + os.path.abspath(caminho_arquivo))
        return True
    return False
