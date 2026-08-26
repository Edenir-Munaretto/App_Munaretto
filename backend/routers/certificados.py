"""Documentos do módulo SST (certificados de treinamentos e laudos de ASO).

Integração com o Backblaze B2 (protocolo S3) para armazenamento PRIVADO de
documentos (PDF/imagem) dos colaboradores. No Supabase são salvos apenas os
metadados e a chave do objeto no bucket; o arquivo em si nunca fica no banco.

Fluxos:
  - UPLOAD  : recebe o arquivo do frontend, envia ao bucket privado e insere
              o registro na tabela `certificados`. Se já existir documento
              para o mesmo registro, ele é substituído (objeto antigo removido).
  - DOWNLOAD: valida o registro no Supabase e, se autorizado, devolve uma
              presigned URL (assinatura temporária de 15 minutos) do B2.
  - DELETE  : remove o objeto do bucket e o registro de metadados.

O mesmo bucket/estrutura é usado para dois tipos de documento, diferenciados
por `tipo_registro`:
  - 'treinamento' -> certificado de curso (funcionario_treinamentos)
  - 'aso'         -> laudo/exame (aso)
"""

import logging
import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from auth import require_permisao
from storage import bucket, get_s3_client
from supabase_client import get_supabase

router = APIRouter(dependencies=[Depends(require_permisao("sst"))])

logger = logging.getLogger(__name__)

# Tipos de documento aceitos: certificados/laudos podem ser PDF ou imagem.
MIMES_PERMITIDOS = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}

# Mapeia o tipo de registro para a tabela de origem no Supabase.
TABELA_REGISTRO = {
    "treinamento": "funcionario_treinamentos",
    "aso": "aso",
}

TAMANHO_MAXIMO_BYTES = 15 * 1024 * 1024  # 15 MB por arquivo
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


def _registro_origem(db, tipo_registro: str, registro_id: int):
    """Valida o tipo e busca o registro de origem, retornando o funcionário."""
    tabela = TABELA_REGISTRO.get(tipo_registro)
    if tabela is None:
        raise HTTPException(status_code=400, detail="Tipo de registro inválido.")
    registro = db.table(tabela).select("*").eq("id", registro_id).execute()
    if not registro.data:
        raise HTTPException(status_code=404, detail="Registro não encontrado.")
    return registro.data[0]


async def _enviar_documento(tipo_registro: str, registro_id: int, arquivo: UploadFile, db):
    """Implementa o upload para o tipo de registro informado."""
    registro = _registro_origem(db, tipo_registro, registro_id)
    funcionario_id = registro["funcionario_id"]

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

    s3 = get_s3_client()

    # Substituição segura: se já existe documento, remove o anterior.
    existente = (
        db.table("certificados").select("*").eq("tipo_registro", tipo_registro).eq("registro_id", registro_id).execute()
    )
    if existente.data:
        _remover_objeto(s3, existente.data[0]["bucket_key"])
        db.table("certificados").delete().eq("tipo_registro", tipo_registro).eq("registro_id", registro_id).execute()

    # Chave única no bucket: documentos/<tipo>/<id_colaborador>/<uuid>.<ext>
    bucket_key = f"documentos/{tipo_registro}/{funcionario_id}/{uuid.uuid4().hex}{extensao}"

    s3.put_object(
        Bucket=bucket(),
        Key=bucket_key,
        Body=conteudo,
        ContentType=mime,
    )

    response = (
        db.table("certificados")
        .insert(
            {
                "tipo_registro": tipo_registro,
                "colaborador_id": funcionario_id,
                "registro_id": registro_id,
                "nome_original": _nome_arquivo_seguro(arquivo.filename),
                "tamanho_bytes": len(conteudo),
                "mime_type": mime,
                "bucket_key": bucket_key,
            }
        )
        .execute()
    )

    if not response.data:
        # Rollback: remove o objeto enviado para não deixar arquivo órfão.
        _remover_objeto(s3, bucket_key)
        raise HTTPException(status_code=500, detail="Falha ao salvar metadados do documento.")

    return response.data[0]


def _obter_metadados(db, tipo_registro: str, registro_id: int):
    cert = (
        db.table("certificados").select("*").eq("tipo_registro", tipo_registro).eq("registro_id", registro_id).execute()
    )
    if not cert.data:
        raise HTTPException(status_code=404, detail="Nenhum documento anexado a este registro.")
    return cert.data[0]


# ---------------------------------------------------------------------------
# Certificados de treinamentos (funcionario_treinamentos)
# ---------------------------------------------------------------------------
@router.post("/treinamento/{registro_id}", status_code=201)
async def enviar_certificado_treinamento(
    registro_id: int,
    arquivo: UploadFile = File(...),
    db=Depends(get_supabase),
):
    """Faz upload do certificado de um treinamento realizado."""
    try:
        return await _enviar_documento("treinamento", registro_id, arquivo, db)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao enviar certificado do treinamento %s", registro_id)
        raise HTTPException(status_code=500, detail="Erro ao enviar certificado.") from None


@router.get("/treinamento/{registro_id}")
def obter_certificado_treinamento(registro_id: int, db=Depends(get_supabase)):
    """Retorna os metadados do certificado e uma presigned URL de 15 minutos."""
    try:
        _registro_origem(db, "treinamento", registro_id)
        meta = _obter_metadados(db, "treinamento", registro_id)
        return _com_url(meta)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao gerar URL do certificado do treinamento %s", registro_id)
        raise HTTPException(status_code=500, detail="Erro ao obter certificado.") from None


@router.delete("/treinamento/{registro_id}")
def excluir_certificado_treinamento(registro_id: int, db=Depends(get_supabase)):
    """Remove o certificado do bucket e o registro de metadados."""
    try:
        return _excluir_documento(db, "treinamento", registro_id)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao excluir certificado do treinamento %s", registro_id)
        raise HTTPException(status_code=500, detail="Erro ao excluir certificado.") from None


# ---------------------------------------------------------------------------
# Documentos de ASO (aso)
# ---------------------------------------------------------------------------
@router.post("/aso/{registro_id}", status_code=201)
async def enviar_documento_aso(
    registro_id: int,
    arquivo: UploadFile = File(...),
    db=Depends(get_supabase),
):
    """Faz upload do laudo/exame de um ASO."""
    try:
        return await _enviar_documento("aso", registro_id, arquivo, db)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao enviar documento do ASO %s", registro_id)
        raise HTTPException(status_code=500, detail="Erro ao enviar documento do ASO.") from None


@router.get("/aso/{registro_id}")
def obter_documento_aso(registro_id: int, db=Depends(get_supabase)):
    """Retorna os metadados do documento de ASO e uma presigned URL de 15 minutos."""
    try:
        _registro_origem(db, "aso", registro_id)
        meta = _obter_metadados(db, "aso", registro_id)
        return _com_url(meta)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao gerar URL do documento do ASO %s", registro_id)
        raise HTTPException(status_code=500, detail="Erro ao obter documento do ASO.") from None


@router.delete("/aso/{registro_id}")
def excluir_documento_aso(registro_id: int, db=Depends(get_supabase)):
    """Remove o documento de ASO do bucket e o registro de metadados."""
    try:
        return _excluir_documento(db, "aso", registro_id)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao excluir documento do ASO %s", registro_id)
        raise HTTPException(status_code=500, detail="Erro ao excluir documento do ASO.") from None


# ---------------------------------------------------------------------------
# Helpers compartilhados
# ---------------------------------------------------------------------------
def _com_url(meta: dict) -> dict:
    """Adiciona a presigned URL temporária aos metadados."""
    s3 = get_s3_client()
    url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket(), "Key": meta["bucket_key"]},
        ExpiresIn=VALIDADE_PRESIGNED_SEGUNDOS,
    )
    return {
        **meta,
        "url_temporaria": url,
        "validade_segundos": VALIDADE_PRESIGNED_SEGUNDOS,
    }


def _excluir_documento(db, tipo_registro: str, registro_id: int) -> dict:
    meta = _obter_metadados(db, tipo_registro, registro_id)
    s3 = get_s3_client()
    _remover_objeto(s3, meta["bucket_key"])
    db.table("certificados").delete().eq("tipo_registro", tipo_registro).eq("registro_id", registro_id).execute()
    return {"success": True, "message": "Documento excluído com sucesso."}
