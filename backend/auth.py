"""Autenticação por token JWT.

Fornece criação e validação de tokens de acesso usados pela API.
A secret é lida da variável de ambiente JWT_SECRET.
"""
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from supabase_client import get_supabase

ALGORITMO = "HS256"

# Extrai o token do cabeçalho "Authorization: Bearer <token>"
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/usuarios/login")

CREDENCIAIS_INVALIDAS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Não foi possível validar as credenciais.",
    headers={"WWW-Authenticate": "Bearer"},
)


def _secret() -> str:
    return os.environ.get("JWT_SECRET") or ""


def criar_token_acesso(user_id: int, email: str, validade_minutos: int = 480) -> str:
    """Gera um token JWT assinado com o id e e-mail do usuário."""
    secret = _secret()
    if not secret:
        raise RuntimeError(
            "JWT_SECRET não configurado. Adicione a variável JWT_SECRET no arquivo .env"
        )
    expiracao = datetime.now(timezone.utc) + timedelta(minutes=validade_minutos)
    payload = {
        "sub": str(user_id),
        "email": email,
        "iat": datetime.now(timezone.utc),
        "exp": expiracao,
    }
    return jwt.encode(payload, secret, algorithm=ALGORITMO)


def decodificar_token(token: str) -> Optional[dict]:
    """Valida o token e retorna o payload. Retorna None se inválido ou expirado."""
    try:
        return jwt.decode(token, _secret(), algorithms=[ALGORITMO])
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def secret_esta_configurada() -> bool:
    """Indica se a variável JWT_SECRET foi configurada."""
    return bool(_secret())


class UsuarioAutenticado(BaseModel):
    """Usuário autenticado, sem campo de senha."""
    id: int
    nome: str
    email: str
    permissoes: list
    ativo: bool


def _sem_senha(user: dict) -> dict:
    return {k: v for k, v in user.items() if k != "senha"}


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db=Depends(get_supabase),
) -> UsuarioAutenticado:
    """Valida o token JWT e retorna o usuário autenticado do banco."""
    payload = decodificar_token(token)
    if not payload:
        raise CREDENCIAIS_INVALIDAS

    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        raise CREDENCIAIS_INVALIDAS

    response = db.table("usuarios").select("*").eq("id", user_id).limit(1).execute()
    if not response.data:
        raise CREDENCIAIS_INVALIDAS

    user = response.data[0]
    if not user.get("ativo", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuário inativo. Contate o administrador.",
        )

    dados = _sem_senha(user)
    return UsuarioAutenticado(**dados)


def require_permisao(modulo: str):
    """Dependência que exige que o usuário tenha a permissão do módulo informado."""
    def verificador(usuario: UsuarioAutenticado = Depends(get_current_user)) -> UsuarioAutenticado:
        if modulo not in (usuario.permissoes or []):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Acesso negado: você não tem permissão para o módulo '{modulo}'.",
            )
        return usuario
    return verificador


def require_qualquer_permisao(modulos: list):
    """Dependência que exige que o usuário tenha pelo menos uma das permissões informadas."""
    def verificador(usuario: UsuarioAutenticado = Depends(get_current_user)) -> UsuarioAutenticado:
        if not any(m in (usuario.permissoes or []) for m in modulos):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Acesso negado: você não tem permissão para nenhum dos módulos: {', '.join(modulos)}.",
            )
        return usuario
    return verificador


class LoginRateLimiter:
    """Limita tentativas de login por chave (janela deslizante simples, em memória)."""

    def __init__(self, limite: int = 5, janela_segundos: int = 60):
        self._lock = threading.Lock()
        self._limite = limite
        self._janela_segundos = janela_segundos
        self._janelas: dict = {}

    def _janela_atual(self, chave: str, agora: float):
        inicio, contador = self._janelas.get(chave, (0, 0))
        if agora - inicio >= self._janela_segundos:
            return agora, 0
        return inicio, contador

    def bloqueado(self, chave: str) -> bool:
        with self._lock:
            _, contador = self._janela_atual(chave, time.monotonic())
            return contador >= self._limite

    def registrar(self, chave: str) -> None:
        with self._lock:
            inicio, contador = self._janela_atual(chave, time.monotonic())
            self._janelas[chave] = (inicio, contador + 1)

    def restaurar(self, chave: str) -> None:
        with self._lock:
            self._janelas.pop(chave, None)


limite_login = LoginRateLimiter()


def obter_ip_cliente(request: Request) -> str:
    """Obtém o IP do cliente, respeitando cabeçalho X-Forwarded-For quando existir."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "desconhecido"
