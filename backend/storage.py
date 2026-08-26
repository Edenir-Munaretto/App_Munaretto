"""Cliente S3 (Backblaze B2) para armazenamento privado de arquivos.

O Backblaze B2 é compatível com o protocolo S3, então usamos o AWS SDK
(boto3) apontando para o endpoint do B2. As credenciais são lidas das
variáveis de ambiente (nunca versionadas):

    B2_ENDPOINT          - ex: https://s3.us-west-004.backblazeb2.com
    B2_KEY_ID            - Key ID gerado no painel do Backblaze B2
    B2_APPLICATION_KEY   - Application Key gerada no painel do Backblaze B2
    B2_BUCKET_NAME       - Nome do bucket PRIVADO
    B2_REGION            - Região do bucket (opcional, padrão us-west-004)
"""

import logging
import os

import boto3
from botocore.config import Config
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Carrega o arquivo .env se existir, garantindo as variáveis do B2 mesmo
# quando o módulo é importado antes do load_dotenv() do main.
load_dotenv()

B2_ENDPOINT = os.environ.get("B2_ENDPOINT")
B2_KEY_ID = os.environ.get("B2_KEY_ID")
B2_APPLICATION_KEY = os.environ.get("B2_APPLICATION_KEY")
B2_BUCKET_NAME = os.environ.get("B2_BUCKET_NAME")
B2_REGION = os.environ.get("B2_REGION", "us-west-004")

_cliente = None


def get_s3_client():
    """Retorna o cliente S3 do Backblaze B2 (singleton).

    Exige as variáveis B2_ENDPOINT, B2_KEY_ID, B2_APPLICATION_KEY e
    B2_BUCKET_NAME. Lança RuntimeError se alguma não estiver configurada,
    evitando que arquivos sejam enviados a um destino indevido.
    """
    global _cliente
    if _cliente is not None:
        return _cliente

    faltando = [
        nome
        for nome, valor in (
            ("B2_ENDPOINT", B2_ENDPOINT),
            ("B2_KEY_ID", B2_KEY_ID),
            ("B2_APPLICATION_KEY", B2_APPLICATION_KEY),
            ("B2_BUCKET_NAME", B2_BUCKET_NAME),
        )
        if not valor
    ]
    if faltando:
        raise RuntimeError(
            "Armazenamento de arquivos não configurado. Variáveis ausentes no .env: " + ", ".join(faltando)
        )

    _cliente = boto3.client(
        "s3",
        endpoint_url=B2_ENDPOINT,
        aws_access_key_id=B2_KEY_ID,
        aws_secret_access_key=B2_APPLICATION_KEY,
        region_name=B2_REGION,
        config=Config(signature_version="s3v4"),
    )
    return _cliente


def bucket():
    """Nome do bucket B2 onde os arquivos são armazenados."""
    return B2_BUCKET_NAME
