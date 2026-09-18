"""Autenticação por token JWT.

Fornece criação e validação de tokens de acesso usados pela API.
A secret é lida da variável de ambiente JWT_SECRET.
"""

import logging
import os
import threading
import time
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel

from supabase_client import get_supabase

logger = logging.getLogger(__name__)

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


# Validade padrão do token (16h) — usada quando JWT_VALIDADE_MINUTOS não está
# configurada ou contém valor inválido.
VALIDADE_PADRAO_MINUTOS = 960


def _validade_minutos() -> int:
    """Validade do token em minutos (JWT_VALIDADE_MINUTOS; fallback 16h)."""
    bruto = os.environ.get("JWT_VALIDADE_MINUTOS")
    if not bruto:
        return VALIDADE_PADRAO_MINUTOS
    try:
        valor = int(str(bruto).strip())
    except (TypeError, ValueError):
        return VALIDADE_PADRAO_MINUTOS
    return valor if valor > 0 else VALIDADE_PADRAO_MINUTOS


def criar_token_acesso(user_id: int, email: str, validade_minutos: int | None = None) -> str:
    """Gera um token JWT assinado com o id e e-mail do usuário (16 horas)."""
    secret = _secret()
    if not secret:
        raise RuntimeError("JWT_SECRET não configurado. Adicione a variável JWT_SECRET no arquivo .env")
    minutos = _validade_minutos() if validade_minutos is None else validade_minutos
    expiracao = datetime.now(UTC) + timedelta(minutes=minutos)
    payload = {
        "sub": str(user_id),
        "email": email,
        "iat": datetime.now(UTC),
        "exp": expiracao,
    }
    return jwt.encode(payload, secret, algorithm=ALGORITMO)


def decodificar_token(token: str) -> dict | None:
    """Valida o token e retorna o payload. Retorna None se inválido ou expirado.

    Exige as claims ``exp`` e ``sub`` (token sem expiração é rejeitado).
    """
    secret = _secret()
    if not secret:
        return None
    try:
        return jwt.decode(
            token,
            secret,
            algorithms=[ALGORITMO],
            options={"require": ["exp", "sub"]},
        )
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
    except jwt.PyJWTError:
        # Cobre InvalidKeyError e demais falhas de configuração do token.
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
    # Vínculo com o cadastro de funcionário (permite derivar as equipes do
    # usuário de campo). Definido no cadastro de Usuários (Configurações).
    funcionario_id: int | None = None
    # Quando True, o usuário só pode acessar as rotas de troca de senha até
    # definir uma nova senha (primeiro acesso com senha temporária).
    precisa_trocar_senha: bool = False


def _sem_senha(user: dict) -> dict:
    return {k: v for k, v in user.items() if k != "senha"}


# ---------------------------------------------------------------------------
# Cache curto do usuário autenticado
#
# Cada request autenticada consulta a tabela `usuarios`. Com os pollings do
# frontend (notificações, alertas, sessão) a mesma leitura se repete centenas
# de vezes por dia. Um cache TTL de 60s por id elimina as repetições; os
# endpoints que alteram usuários invalidam a entrada (routers/usuarios.py).
# ---------------------------------------------------------------------------
COLUNAS_USUARIO_AUTENTICACAO = "id, nome, email, permissoes, ativo, funcionario_id, precisa_trocar_senha"
_CACHE_USUARIO_TTL_SEGUNDOS = 60.0
_cache_usuarios: dict[int, tuple[float, dict]] = {}
_trava_cache_usuarios = threading.Lock()


def limpar_cache_usuarios(usuario_id: int | None = None) -> None:
    """Limpa o cache de autenticação (um usuário específico ou todos)."""
    with _trava_cache_usuarios:
        if usuario_id is None:
            _cache_usuarios.clear()
        else:
            _cache_usuarios.pop(usuario_id, None)


def _usuario_por_id(db, user_id: int) -> dict | None:
    """Busca o usuário no cache (TTL curto) ou no banco, sem trazer a senha."""
    agora = time.monotonic()
    with _trava_cache_usuarios:
        entrada = _cache_usuarios.get(user_id)
        if entrada is not None and agora - entrada[0] < _CACHE_USUARIO_TTL_SEGUNDOS:
            return entrada[1]

    response = db.table("usuarios").select(COLUNAS_USUARIO_AUTENTICACAO).eq("id", user_id).limit(1).execute()
    if not response.data:
        limpar_cache_usuarios(user_id)
        return None

    usuario = response.data[0]
    with _trava_cache_usuarios:
        _cache_usuarios[user_id] = (agora, usuario)
    return usuario


# Rotas acessíveis mesmo com troca de senha pendente (o usuário precisa
# conseguir ver quem está logado e definir a nova senha).
ROTAS_LIVRES_COM_TROCA_PENDENTE = (
    "/api/usuarios/trocar-senha",
    "/api/usuarios/me",
)


def get_current_user(
    request: Request,
    token: str = Depends(oauth2_scheme),
    db=Depends(get_supabase),
) -> UsuarioAutenticado:
    """Valida o token JWT e retorna o usuário autenticado do banco."""
    if not secret_esta_configurada():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Servidor mal configurado: JWT_SECRET não definido. Contate o administrador.",
        )

    payload = decodificar_token(token)
    if not payload:
        raise CREDENCIAIS_INVALIDAS

    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        raise CREDENCIAIS_INVALIDAS from None

    response = _usuario_por_id(db, user_id)
    if not response:
        raise CREDENCIAIS_INVALIDAS

    user = response
    if not user.get("ativo", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuário inativo. Contate o administrador.",
        )

    if user.get("precisa_trocar_senha") and request.url.path not in ROTAS_LIVRES_COM_TROCA_PENDENTE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Troca de senha obrigatória no primeiro acesso.",
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
    """Limita tentativas de login por chave (janela deslizante simples).

    Os contadores são persistidos na tabela ``login_tentativas`` do Supabase
    para sobreviver a reinícios do servidor e a múltiplas instâncias. Um cache
    em memória funciona como fallback quando o banco está indisponível.
    """

    TABELA = "login_tentativas"

    def __init__(self, limite: int = 5, janela_segundos: int = 60):
        self._lock = threading.Lock()
        self._limite = limite
        self._janela_segundos = janela_segundos
        self._janelas: dict = {}

    # --- Fallback em memória -------------------------------------------------
    def _janela_atual(self, chave: str, agora: float):
        inicio, contador = self._janelas.get(chave, (0, 0))
        if agora - inicio >= self._janela_segundos:
            return agora, 0
        return inicio, contador

    # --- Persistência no Supabase --------------------------------------------
    def _ler_banco(self, db, chave: str) -> dict | None:
        resp = db.table(self.TABELA).select("*").eq("chave", chave).limit(1).execute()
        if not resp.data:
            return None
        return resp.data[0]

    def _gravar_banco(self, db, chave: str, inicio: float, contador: int) -> None:
        db.table(self.TABELA).upsert(
            {"chave": chave, "contador": contador, "janela_inicio": inicio},
            on_conflict="chave",
        ).execute()

    def _apagar_banco(self, db, chave: str) -> None:
        db.table(self.TABELA).delete().eq("chave", chave).execute()

    # --- API pública ----------------------------------------------------------
    def bloqueado(self, chave: str, db=None) -> bool:
        agora = time.time()
        if db is not None:
            try:
                reg = self._ler_banco(db, chave)
                if reg is not None:
                    if agora - reg["janela_inicio"] >= self._janela_segundos:
                        return False
                    return reg["contador"] >= self._limite
            except Exception:
                logger.exception("Erro ao ler rate limit do banco; usando memória")

        with self._lock:
            _, contador = self._janela_atual(chave, agora)
            return contador >= self._limite

    def registrar(self, chave: str, db=None) -> None:
        agora = time.time()
        if db is not None:
            try:
                reg = self._ler_banco(db, chave)
                if reg is not None and agora - reg["janela_inicio"] < self._janela_segundos:
                    self._gravar_banco(db, chave, reg["janela_inicio"], reg["contador"] + 1)
                else:
                    self._gravar_banco(db, chave, agora, 1)
                return
            except Exception:
                logger.exception("Erro ao registrar tentativa no banco; usando memória")

        with self._lock:
            inicio, contador = self._janela_atual(chave, agora)
            self._janelas[chave] = (inicio, contador + 1)

    def restaurar(self, chave: str, db=None) -> None:
        with self._lock:
            self._janelas.pop(chave, None)
        if db is not None:
            try:
                self._apagar_banco(db, chave)
            except Exception:
                logger.exception("Erro ao restaurar rate limit no banco")


limite_login = LoginRateLimiter()


def obter_ip_cliente(request: Request) -> str:
    """Obtém o IP do cliente a partir do X-Forwarded-For.

    Usa a ÚLTIMA entrada do cabeçalho: é a mais próxima do proxy reverso
    confiável (Render), enquanto as primeiras podem ter sido forjadas pelo
    próprio cliente para burlar o rate limit.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        partes = [p.strip() for p in forwarded.split(",") if p.strip()]
        if partes:
            return partes[-1]
    return request.client.host if request.client else "desconhecido"
