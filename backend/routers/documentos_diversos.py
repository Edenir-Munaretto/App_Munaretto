"""Documentos Diversos do módulo SST.

Pasta de documentos avulsos (PDF/imagem) com upload, download e exclusão.
Assim como nos certificados, o arquivo NÃO fica no banco: é armazenado no
bucket privado do Backblaze B2 e no Supabase ficam apenas os metadados
(tabela `sst_documentos`).

Compressão para reduzir o consumo de armazenamento:
  - PDF : recompactado no backend com PyMuPDF (garbage + deflate);
  - imagem: compactada no frontend (canvas -> JPEG) antes do envio.
O tamanho original enviado também é guardado para exibir a economia.

Fluxos:
  - GET    /documentos-diversos        -> lista todos (com presigned URL)
  - POST   /documentos-diversos        -> upload (multipart) com compressão
  - GET    /documentos-diversos/{id}   -> presigned URL do documento
  - DELETE /documentos-diversos/{id}   -> remove objeto + metadados
"""

import io
import logging
import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from auth import UsuarioAutenticado, require_permisao
from storage import bucket, get_s3_client
from supabase_client import get_supabase

router = APIRouter(dependencies=[Depends(require_permisao("sst"))])

logger = logging.getLogger(__name__)

# Tipos aceitos: PDF (compactado no backend) e imagens (compactadas no frontend).
MIMES_PERMITIDOS = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}

TAMANHO_MAXIMO_BYTES = 15 * 1024 * 1024  # 15 MB por arquivo (antes da compressão)
VALIDADE_PRESIGNED_SEGUNDOS = 15 * 60  # 15 minutos


def _nome_arquivo_seguro(nome: str) -> str:
    """Remove caminhos (path traversal) e caracteres que podem quebrar a URL."""
    base = os.path.basename(str(nome or "").replace("\\", "/")).strip()
    base = "".join(c for c in base if c.isalnum() or c in (" ", "-", "_", "."))
    return base[:500] or "documento"


def _remover_objeto(s3, chave: str) -> None:
    """Remove um objeto do bucket ignorando erro de objeto inexistente."""
    try:
        s3.delete_object(Bucket=bucket(), Key=chave)
    except Exception:
        logger.exception("Erro ao remover objeto %s do B2", chave)


def _comprimir_pdf(conteudo: bytes) -> bytes:
    """Recompacta um PDF removendo objetos não usados (garbage + deflate).

    Retorna o conteúdo original quando a compactação não reduz o tamanho
    ou quando o PDF não pode ser processado (arquivo corrompido, etc).
    """
    try:
        import pymupdf
    except ImportError:
        return conteudo
    try:
        with pymupdf.open(stream=conteudo, filetype="pdf") as doc:
            saida = io.BytesIO()
            doc.save(saida, garbage=4, deflate=True, clean=True)
            comprimido = saida.getvalue()
        return comprimido if len(comprimido) < len(conteudo) else conteudo
    except Exception:
        logger.exception("Falha ao compactar PDF; mantendo o arquivo original")
        return conteudo


def _com_url(meta: dict) -> dict:
    """Adiciona a presigned URL temporária com download forçado (anexo)."""
    s3 = get_s3_client()
    url = s3.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": bucket(),
            "Key": meta["bucket_key"],
            "ResponseContentDisposition": f'attachment; filename="{meta["nome_original"]}"',
        },
        ExpiresIn=VALIDADE_PRESIGNED_SEGUNDOS,
    )
    return {
        **meta,
        "url_temporaria": url,
        "validade_segundos": VALIDADE_PRESIGNED_SEGUNDOS,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/documentos-diversos", summary="Lista os Documentos Diversos")
def listar_documentos(db=Depends(get_supabase)):
    """Retorna todos os documentos da pasta, do mais recente para o mais antigo."""
    try:
        docs = (
            db.table("sst_documentos")
            .select("*")
            .order("created_at", desc=True)
            .order("id", desc=True)
            .execute()
            .data
        )
        return [_com_url(d) for d in docs or []]
    except Exception:
        logger.exception("Erro ao listar documentos diversos")
        raise HTTPException(status_code=500, detail="Erro ao listar documentos.") from None


@router.post("/documentos-diversos", status_code=201, summary="Envia um documento (com compressão)")
async def enviar_documento(
    arquivo: UploadFile = File(...),
    usuario: UsuarioAutenticado = Depends(require_permisao("sst")),
    db=Depends(get_supabase),
):
    """Faz upload de um PDF ou imagem para a pasta de Documentos Diversos.

    PDFs são recompactados no backend (PyMuPDF); imagens devem ser
    compactadas no frontend (canvas -> JPEG) antes do envio.
    """
    try:
        mime = (arquivo.content_type or "").lower()
        extensao = MIMES_PERMITIDOS.get(mime)
        if extensao is None:
            raise HTTPException(
                status_code=400,
                detail="Tipo de arquivo não permitido. Envie PDF, JPG, PNG ou WEBP.",
            )

        conteudo = await arquivo.read()
        if not conteudo:
            raise HTTPException(status_code=400, detail="Arquivo vazio.")
        if len(conteudo) > TAMANHO_MAXIMO_BYTES:
            raise HTTPException(
                status_code=400,
                detail="Arquivo excede o limite de 15 MB.",
            )

        tamanho_original = len(conteudo)
        if mime == "application/pdf":
            conteudo = _comprimir_pdf(conteudo)

        # Chave única no bucket: documentos_diversos/<uuid>.<ext>
        bucket_key = f"documentos_diversos/{uuid.uuid4().hex}{extensao}"

        s3 = get_s3_client()
        s3.put_object(
            Bucket=bucket(),
            Key=bucket_key,
            Body=conteudo,
            ContentType=mime,
        )

        response = (
            db.table("sst_documentos")
            .insert(
                {
                    "nome_original": _nome_arquivo_seguro(arquivo.filename),
                    "tamanho_bytes": len(conteudo),
                    "tamanho_original": tamanho_original,
                    "mime_type": mime,
                    "bucket_key": bucket_key,
                    "criado_por": usuario.email,
                }
            )
            .execute()
        )

        if not response.data:
            # Rollback: remove o objeto enviado para não deixar arquivo órfão.
            _remover_objeto(s3, bucket_key)
            raise HTTPException(status_code=500, detail="Falha ao salvar metadados do documento.")

        return _com_url(response.data[0])
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao enviar documento diverso")
        raise HTTPException(status_code=500, detail="Erro ao enviar documento.") from None


@router.get("/documentos-diversos/{doc_id}", summary="Presigned URL de um documento")
def obter_documento(doc_id: int, db=Depends(get_supabase)):
    """Retorna os metadados do documento e a URL temporária de download."""
    try:
        docs = db.table("sst_documentos").select("*").eq("id", doc_id).execute().data
        if not docs:
            raise HTTPException(status_code=404, detail="Documento não encontrado.")
        return _com_url(docs[0])
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao obter documento %s", doc_id)
        raise HTTPException(status_code=500, detail="Erro ao obter documento.") from None


@router.delete("/documentos-diversos/{doc_id}", summary="Exclui um documento")
def excluir_documento(doc_id: int, db=Depends(get_supabase)):
    """Remove o arquivo do bucket e o registro de metadados."""
    try:
        docs = db.table("sst_documentos").select("*").eq("id", doc_id).execute().data
        if not docs:
            raise HTTPException(status_code=404, detail="Documento não encontrado.")
        meta = docs[0]

        s3 = get_s3_client()
        _remover_objeto(s3, meta["bucket_key"])
        db.table("sst_documentos").delete().eq("id", doc_id).execute()
        return {"success": True, "message": "Documento excluído com sucesso."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao excluir documento %s", doc_id)
        raise HTTPException(status_code=500, detail="Erro ao excluir documento.") from None
