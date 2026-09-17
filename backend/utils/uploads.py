"""Utilitários compartilhados de upload (leitura limitada, nome seguro e
validação de assinatura de arquivo).

Centraliza o que antes estava duplicado em `routers/os.py`,
`routers/certificados.py`, `routers/manutencao.py`, `routers/documentos_diversos.py`
e `routers/documentos.py`.
"""

import os

from fastapi import HTTPException, UploadFile

CHUNK_LEITURA_UPLOAD = 1024 * 1024  # 1 MB


def nome_arquivo_seguro(nome: str) -> str:
    """Remove caminhos (path traversal) e caracteres que podem quebrar a URL."""
    base = os.path.basename(str(nome or "").replace("\\", "/")).strip()
    base = "".join(c for c in base if c.isalnum() or c in (" ", "-", "_", "."))
    return base[:500] or "documento"


def ler_upload_limitado(
    arquivo: UploadFile,
    limite: int,
    *,
    mensagem_vazio: str = "Arquivo vazio.",
    mensagem_limite: str = "Arquivo excede o limite permitido.",
) -> bytes:
    """Versão síncrona: lê em chunks e recusa sem carregar tudo na memória.

    Use apenas em endpoints `def` (threadpool). Para endpoints `async`, use
    `ler_upload_limitado_async`.
    """
    partes = []
    total = 0
    while True:
        bloco = arquivo.file.read(CHUNK_LEITURA_UPLOAD)
        if not bloco:
            break
        total += len(bloco)
        if total > limite:
            raise HTTPException(status_code=400, detail=mensagem_limite)
        partes.append(bloco)
    if total == 0:
        raise HTTPException(status_code=400, detail=mensagem_vazio)
    return b"".join(partes)


async def ler_upload_limitado_async(
    arquivo: UploadFile,
    limite: int,
    *,
    mensagem_vazio: str = "Arquivo vazio.",
    mensagem_limite: str = "Arquivo excede o limite permitido.",
) -> bytes:
    """Versão assíncrona da leitura limitada (endpoints `async def`)."""
    partes = []
    total = 0
    while True:
        bloco = await arquivo.read(CHUNK_LEITURA_UPLOAD)
        if not bloco:
            break
        total += len(bloco)
        if total > limite:
            raise HTTPException(status_code=400, detail=mensagem_limite)
        partes.append(bloco)
    if total == 0:
        raise HTTPException(status_code=400, detail=mensagem_vazio)
    return b"".join(partes)


_ASSINATURAS = {
    "application/pdf": (b"%PDF-",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
}


def validar_magia_documento(mime: str, conteudo: bytes) -> None:
    """Confere os bytes de assinatura (magic bytes) do formato declarado.

    O `content_type` é informado pelo cliente; sem esta checagem, conteúdo
    arbitrário seria gravado no bucket (mitigado só pela privacidade dele).
    """
    if not conteudo:
        raise HTTPException(status_code=400, detail="Arquivo vazio.")

    mime = (mime or "").lower()
    if mime == "image/webp":
        if not (conteudo.startswith(b"RIFF") and b"WEBP" in conteudo[8:16]):
            raise HTTPException(status_code=400, detail="O arquivo enviado não é uma imagem WEBP válida.")
        return

    prefixos = _ASSINATURAS.get(mime)
    if not prefixos:
        return  # mime já validado pelo mapa de permitidos antes
    if not any(conteudo.startswith(p) for p in prefixos):
        raise HTTPException(
            status_code=400,
            detail="O conteúdo do arquivo não corresponde ao tipo informado.",
        )
