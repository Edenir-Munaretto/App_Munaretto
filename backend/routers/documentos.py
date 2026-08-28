import logging
import os
import tempfile

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from auth import require_permisao
from supabase_client import get_supabase
from utils.document_generator import (
    TEMPLATES_DIR,
    convert_docx_to_pdf,
    garantir_pastas,
    preencher_excel,
    preencher_word,
)

router = APIRouter(dependencies=[Depends(require_permisao("documentos"))])

logger = logging.getLogger(__name__)

# Limite máximo de 10 MB para upload de templates
MAX_TEMPLATE_SIZE = 10 * 1024 * 1024

# Modelos de O.S usados EXCLUSIVAMENTE pela impressão do módulo Controle de
# O.S (fallback DOCX do utils/modelo_os.py). NÃO são documentos de cliente:
# suas variáveis (obra, equipe, servico, ...) não existem no contexto do
# Gerador de Documentos, então ficam fora da listagem e da geração.
TEMPLATES_OS = {"OS_CONSTRUCAO", "OS_LINHA_VIVA"}


def _sanitizar_nome_arquivo(nome: str) -> str:
    """Remove componentes de caminho e caracteres inválidos, deixando só o nome base."""
    if not nome:
        return ""
    nome = nome.replace("\\", "/")
    nome = os.path.basename(nome)
    nome = "".join(c for c in nome if c.isalnum() or c in (" ", "-", "_", "."))
    return nome.strip()


@router.get("/templates")
def listar_modelos():
    """Retorna os nomes dos modelos disponíveis para Word (.docx) e Excel (.xlsx)."""
    garantir_pastas()
    templates_word = []
    templates_excel = []

    try:
        for arquivo in sorted(os.listdir(TEMPLATES_DIR)):
            nome_base = os.path.splitext(arquivo)[0]
            if nome_base in TEMPLATES_OS:
                continue  # modelos de O.S pertencem ao Controle de O.S
            if arquivo.lower().endswith(".docx"):
                templates_word.append(nome_base)
            elif arquivo.lower().endswith(".xlsx"):
                templates_excel.append(nome_base)

        return {"word": templates_word, "excel": templates_excel}
    except Exception:
        logger.exception("Erro ao listar templates")
        raise HTTPException(status_code=500, detail="Erro ao listar templates") from None


@router.post("/templates/upload")
def upload_modelo(file: UploadFile = File(...)):
    """Envia um novo modelo de documento (.docx ou .xlsx) para a pasta de templates do backend."""
    garantir_pastas()

    filename = _sanitizar_nome_arquivo(file.filename)
    if not filename:
        raise HTTPException(status_code=400, detail="Nome do arquivo inválido.")

    ext = os.path.splitext(filename)[1].lower()
    if ext not in [".docx", ".xlsx"]:
        raise HTTPException(status_code=400, detail="Formato inválido. Apenas arquivos .docx ou .xlsx são permitidos.")

    caminho_destino = os.path.join(TEMPLATES_DIR, filename)

    # Impede sobrescrita acidental de um template existente
    if os.path.exists(caminho_destino):
        raise HTTPException(
            status_code=409,
            detail=f"O template '{filename}' já existe. Renomeie o arquivo ou exclua o anterior antes de importar.",
        )

    # Validação leve de conteúdo: .docx/.xlsx são arquivos ZIP (assinatura PK)
    primeiros = file.file.read(4)
    if primeiros[:2] != b"PK":
        raise HTTPException(status_code=400, detail="O arquivo não parece ser um documento Word/Excel válido.")
    file.file.seek(0)

    # Lê em blocos, limitando o tamanho total para evitar DoS
    tamanho = 0
    try:
        with open(caminho_destino, "wb") as buffer:
            while True:
                bloco = file.file.read(1024 * 1024)
                if not bloco:
                    break
                tamanho += len(bloco)
                if tamanho > MAX_TEMPLATE_SIZE:
                    raise HTTPException(status_code=400, detail="Arquivo muito grande. O tamanho máximo é 10 MB.")
                buffer.write(bloco)

        if tamanho == 0:
            raise HTTPException(status_code=400, detail="Arquivo vazio.")
        return {"success": True, "message": f"Template '{filename}' importado com sucesso."}
    except HTTPException:
        if os.path.exists(caminho_destino):
            os.remove(caminho_destino)
        raise
    except Exception:
        if os.path.exists(caminho_destino):
            os.remove(caminho_destino)
        raise HTTPException(status_code=500, detail="Erro ao salvar arquivo de template.") from None


@router.post("/gerar")
def gerar_documento(
    cliente_id: int = Form(...),
    template_name: str = Form(...),
    formato: str = Form(..., description="Formato desejado: word, pdf ou excel"),
    db=Depends(get_supabase),
):
    """Gera um documento personalizado para o cliente e inicia o download diretamente no navegador."""
    # 1. Sanitiza o nome do template para impedir path traversal
    template_name = _sanitizar_nome_arquivo(template_name)
    if not template_name:
        raise HTTPException(status_code=400, detail="Nome do template inválido.")
    if os.path.splitext(template_name)[0] in TEMPLATES_OS:
        raise HTTPException(
            status_code=400,
            detail="Modelos de O.S são gerados pelo módulo Controle de O.S, não pelo Gerador de Documentos.",
        )

    # 2. Busca dados do cliente no Supabase
    cliente_resp = db.table("clientes").select("*").eq("id", cliente_id).execute()
    if not cliente_resp.data:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")

    cliente = cliente_resp.data[0]
    temp_dir = tempfile.gettempdir()
    caminho_gerado = None
    media_type = "application/octet-stream"

    formato = formato.lower()

    try:
        # 3. Geração do arquivo no diretório temporário
        if formato == "word":
            caminho_gerado = preencher_word(cliente, template_name, temp_dir)
            media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        elif formato == "excel":
            caminho_gerado = preencher_excel(cliente, template_name, temp_dir)
            media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        elif formato == "pdf":
            # Para gerar PDF, primeiro geramos o Word e depois convertemos
            caminho_word = preencher_word(cliente, template_name, temp_dir)
            if not caminho_word:
                raise HTTPException(
                    status_code=404, detail="Template do Word correspondente não encontrado para conversão."
                )

            try:
                caminho_gerado = convert_docx_to_pdf(caminho_word, temp_dir)
            except RuntimeError as conv_err:
                logger.error("Falha na conversão para PDF: %s", conv_err)
                raise HTTPException(status_code=500, detail=str(conv_err)) from conv_err
            finally:
                # Remove o Word temporário independente do resultado
                if os.path.exists(caminho_word):
                    os.remove(caminho_word)

            media_type = "application/pdf"
        else:
            raise HTTPException(status_code=400, detail="Formato não suportado. Escolha entre: word, pdf, excel.")

        if not caminho_gerado or not os.path.exists(caminho_gerado):
            raise HTTPException(status_code=500, detail="Erro interno ao gerar o arquivo preenchido.")

        nome_arquivo = os.path.basename(caminho_gerado)

        # 4. Registra a geração do documento no histórico do Supabase
        db.table("documentos_gerados").insert(
            {
                "cliente_id": cliente_id,
                "tipo_documento": template_name,
                "formato": formato,
                "caminho_arquivo": nome_arquivo,
            }
        ).execute()

        # 5. Retorna o arquivo para download
        return FileResponse(caminho_gerado, media_type=media_type, filename=nome_arquivo)

    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro no processamento do documento")
        raise HTTPException(status_code=500, detail="Erro no processamento do documento") from None
