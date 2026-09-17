import hashlib
import hmac
import logging
import os
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field, field_validator

from auth import (
    UsuarioAutenticado,
    criar_token_acesso,
    get_current_user,
    limite_login,
    obter_ip_cliente,
    require_permisao,
    secret_esta_configurada,
)
from supabase_client import get_supabase

router = APIRouter()

logger = logging.getLogger(__name__)

SENHA_MIN_LENGTH = 8

# Iterações do PBKDF2-HMAC-SHA256 para novas senhas (recomendação OWASP atual).
# Hashes antigos continuam válidos: a verificação lê as iterações do próprio hash.
SENHA_ITERACOES = 600_000

# ---------------------------------------------------------------------------
# Hash de senha (pbkdf2 - sem dependências externas)
# ---------------------------------------------------------------------------


def hash_senha(senha: str) -> str:
    salt = os.urandom(16).hex()
    hash_value = hashlib.pbkdf2_hmac("sha256", senha.encode("utf-8"), bytes.fromhex(salt), SENHA_ITERACOES).hex()
    # Prefixo com algoritmo/iterações permite migração futura (bcrypt/argon2)
    return f"pbkdf2$sha256${SENHA_ITERACOES}${salt}${hash_value}"


def verificar_senha(senha: str, armazenada: str) -> bool:
    if not armazenada:
        return False
    partes = armazenada.split("$")
    if len(partes) == 5 and partes[0] == "pbkdf2":
        # Formato novo: pbkdf2$sha256$100000$salt$hash
        _, _, iteracoes, salt, hash_armazenado = partes
        try:
            iteracoes = int(iteracoes)
        except ValueError:
            return False
        hash_calculado = hashlib.pbkdf2_hmac("sha256", senha.encode("utf-8"), bytes.fromhex(salt), iteracoes).hex()
        return hmac.compare_digest(hash_calculado, hash_armazenado)
    # Formato legado: salt$hash (aceito para compatibilidade com hashes antigos)
    try:
        salt, hash_armazenado = armazenada.split("$")
        hash_calculado = hashlib.pbkdf2_hmac("sha256", senha.encode("utf-8"), bytes.fromhex(salt), 100000).hex()
        return hmac.compare_digest(hash_calculado, hash_armazenado)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class UsuarioCreate(BaseModel):
    nome: str = Field(..., min_length=2, description="Nome do usuário")
    email: EmailStr = Field(..., description="E-mail de acesso")
    senha: str = Field(
        ..., min_length=SENHA_MIN_LENGTH, description=f"Senha de acesso (mínimo {SENHA_MIN_LENGTH} caracteres)"
    )
    permissoes: list[str] = Field(default_factory=list, description="IDs dos módulos acessíveis")
    ativo: bool = True
    # Vínculo com o funcionário (responsável de equipe). É o que permite ao
    # usuário de campo acessar as O.S das equipes em que atua.
    funcionario_id: int | None = Field(None, description="ID do funcionário vinculado (responsável de equipe)")


class UsuarioUpdate(BaseModel):
    nome: str = Field(..., min_length=2)
    email: EmailStr = Field(...)
    senha: str | None = Field(None, min_length=SENHA_MIN_LENGTH)
    permissoes: list[str] = Field(default_factory=list)
    ativo: bool = True
    funcionario_id: int | None = Field(None, description="ID do funcionário vinculado (responsável de equipe)")

    @field_validator("senha", mode="before")
    @classmethod
    def _senha_vazia_para_none(cls, v):
        # O frontend envia senha vazia quando o usuário deve MANTER a senha atual.
        # Sem isso, "" viola min_length=8 e o Pydantic retorna 422.
        if v == "":
            return None
        return v


class UsuarioResponse(BaseModel):
    id: int
    nome: str
    email: str
    permissoes: list[str]
    ativo: bool
    funcionario_id: int | None = None
    precisa_trocar_senha: bool = False
    created_at: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr = Field(...)
    senha: str = Field(...)


class LoginResponse(UsuarioResponse):
    token: str


# ---------------------------------------------------------------------------
# Admin padrão
# ---------------------------------------------------------------------------


def _caminho_senha_inicial() -> str:
    """Arquivo onde a senha inicial do admin é gravada com permissão restrita."""
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "admin_inicial.txt")


def _definir_senha_inicial() -> tuple[str, str | None]:
    """Obtém a senha do admin inicial sem jamais registrá-la em log.

    Ordem de preferência:
    1. Variável de ambiente ADMIN_SENHA_INICIAL (recomendada em produção);
    2. Senha aleatória gravada em ``backend/admin_inicial.txt`` (0600), para
       leitura pontual pelo operador no shell do servidor.
    """
    senha_env = os.environ.get("ADMIN_SENHA_INICIAL")
    if senha_env:
        if len(senha_env) < SENHA_MIN_LENGTH:
            logger.error(
                "ADMIN_SENHA_INICIAL ignorada: é preciso ter ao menos %d caracteres.",
                SENHA_MIN_LENGTH,
            )
        else:
            return senha_env, "variável de ambiente ADMIN_SENHA_INICIAL"

    senha = secrets.token_urlsafe(12)
    caminho = _caminho_senha_inicial()
    try:
        with open(caminho, "w", encoding="utf-8") as arquivo:
            arquivo.write(
                "Senha inicial de admin@munaretto.com (apague este arquivo após o primeiro acesso):\n"
                f"{senha}\n"
            )
        try:
            os.chmod(caminho, 0o600)
        except OSError:
            logger.warning("Não foi possível restringir as permissões de %s", caminho)
        return senha, f"arquivo {caminho}"
    except OSError:
        logger.exception("Falha ao gravar a senha inicial do admin em %s", caminho)
        return senha, None


def _remover_arquivo_senha_inicial() -> None:
    """Remove o arquivo da senha inicial após o primeiro acesso do admin."""
    caminho = _caminho_senha_inicial()
    try:
        if os.path.exists(caminho):
            os.remove(caminho)
    except OSError:
        logger.warning("Não foi possível remover o arquivo %s", caminho)


def _garantir_admin(db) -> None:
    try:
        res = db.table("usuarios").select("id").limit(1).execute()
        if not res.data:
            senha_inicial, origem = _definir_senha_inicial()
            db.table("usuarios").insert(
                {
                    "nome": "Administrador",
                    "email": "admin@munaretto.com",
                    "senha": hash_senha(senha_inicial),
                    "permissoes": [
                        "dashboard",
                        "clientes",
                        "ferias",
                        "fluxo",
                        "documentos",
                        "comprovantes",
                        "recebimentos",
                        "configuracoes",
                    ],
                    "ativo": True,
                    "precisa_trocar_senha": True,
                }
            ).execute()
            if origem:
                logger.warning(
                    "Usuário inicial admin@munaretto.com criado. A senha foi definida via %s "
                    "e deve ser trocada no primeiro acesso.",
                    origem,
                )
            else:
                logger.error(
                    "Usuário inicial admin@munaretto.com criado, mas a senha não pôde ser disponibilizada. "
                    "Defina ADMIN_SENHA_INICIAL e recrie o usuário."
                )
    except Exception:
        logger.exception("Não foi possível garantir o admin padrão")


def _user_sem_senha(user: dict) -> dict:
    return {k: v for k, v in user.items() if k != "senha"}


def _validar_funcionario(db, funcionario_id: int | None) -> None:
    """Valida que o funcionário vinculado existe (se informado)."""
    if funcionario_id is None:
        return
    resp = db.table("funcionarios").select("id").eq("id", funcionario_id).execute()
    if not resp.data:
        raise HTTPException(status_code=400, detail="Funcionário vinculado não encontrado.")


def _eh_admin(user: dict) -> bool:
    """Usuário ativo com a permissão 'configuracoes' (administrador)."""
    return bool(user.get("ativo", True)) and "configuracoes" in (user.get("permissoes") or [])


def _contar_admins_ativos(db, excluir_id: int | None = None) -> int:
    """Conta administradores ativos, opcionalmente ignorando um usuário."""
    resp = db.table("usuarios").select("*").execute()
    return sum(
        1
        for u in (resp.data or [])
        if u.get("id") != excluir_id and _eh_admin(u)
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/", response_model=list[UsuarioResponse])
def listar_usuarios(usuario: UsuarioAutenticado = Depends(require_permisao("configuracoes")), db=Depends(get_supabase)):
    """Lista todos os usuários cadastrados."""
    try:
        response = db.table("usuarios").select("*").order("nome").execute()
        return [_user_sem_senha(u) for u in response.data]
    except Exception:
        logger.exception("Erro ao buscar usuários")
        raise HTTPException(status_code=500, detail="Erro ao buscar usuários") from None


@router.get("/me", response_model=UsuarioResponse)
def obter_usuario_atual(
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    """Retorna os dados ATUAIS do usuário autenticado (permissões frescas do banco).

    Usado pelo frontend para atualizar a sessão quando o administrador altera
    as permissões, sem exigir logout/login.
    """
    try:
        response = db.table("usuarios").select("*").eq("id", usuario.id).limit(1).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Usuário não encontrado.")
        return _user_sem_senha(response.data[0])
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao buscar usuário atual")
        raise HTTPException(status_code=500, detail="Erro ao buscar usuário atual") from None


@router.get("/{usuario_id}", response_model=UsuarioResponse)
def buscar_usuario(
    usuario_id: int, usuario: UsuarioAutenticado = Depends(require_permisao("configuracoes")), db=Depends(get_supabase)
):
    """Busca um usuário pelo ID."""
    try:
        response = db.table("usuarios").select("*").eq("id", usuario_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Usuário não encontrado.")
        return _user_sem_senha(response.data[0])
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao buscar usuário")
        raise HTTPException(status_code=500, detail="Erro ao buscar usuário") from None


@router.post("/", response_model=UsuarioResponse, status_code=201)
def criar_usuario(
    usuario: UsuarioCreate,
    usuario_auth: UsuarioAutenticado = Depends(require_permisao("configuracoes")),
    db=Depends(get_supabase),
):
    """Cria um novo usuário no sistema."""
    try:
        email = usuario.email.strip().lower()
        dup = db.table("usuarios").select("id").eq("email", email).execute()
        if dup.data:
            raise HTTPException(status_code=400, detail="Já existe um usuário com este e-mail.")

        _validar_funcionario(db, usuario.funcionario_id)

        payload = usuario.model_dump()
        payload["email"] = email
        payload["senha"] = hash_senha(usuario.senha)
        response = db.table("usuarios").insert(payload).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao criar usuário.")
        return _user_sem_senha(response.data[0])
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao criar usuário")
        raise HTTPException(status_code=500, detail="Erro ao criar usuário") from None


@router.put("/{usuario_id}", response_model=UsuarioResponse)
def atualizar_usuario(
    usuario_id: int,
    usuario: UsuarioUpdate,
    usuario_auth: UsuarioAutenticado = Depends(require_permisao("configuracoes")),
    db=Depends(get_supabase),
):
    """Atualiza um usuário existente."""
    try:
        check = db.table("usuarios").select("*").eq("id", usuario_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Usuário não encontrado.")
        atual = check.data[0]

        email = usuario.email.strip().lower()
        dup = db.table("usuarios").select("id").eq("email", email).neq("id", usuario_id).execute()
        if dup.data:
            raise HTTPException(status_code=400, detail="Já existe um usuário com este e-mail.")

        _validar_funcionario(db, usuario.funcionario_id)

        payload = usuario.model_dump()
        payload["email"] = email
        if not payload.get("senha"):
            payload.pop("senha", None)
        else:
            payload["senha"] = hash_senha(payload["senha"])
            # Ao definir nova senha, encerra a exigência de troca no primeiro acesso.
            payload["precisa_trocar_senha"] = False

        # Não deixa o sistema ficar sem administrador ativo (nem o usuário se
        # rebaixar/desativar por engano).
        deixa_de_ser_admin = not payload.get("ativo", True) or "configuracoes" not in payload.get("permissoes", [])
        if _eh_admin(atual) and deixa_de_ser_admin:
            if usuario_id == usuario_auth.id:
                raise HTTPException(
                    status_code=400,
                    detail="Você não pode remover o próprio acesso de administrador.",
                )
            if _contar_admins_ativos(db, excluir_id=usuario_id) == 0:
                raise HTTPException(
                    status_code=400,
                    detail="O sistema precisa de pelo menos um administrador ativo.",
                )

        response = db.table("usuarios").update(payload).eq("id", usuario_id).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar usuário.")
        return _user_sem_senha(response.data[0])
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao atualizar usuário")
        raise HTTPException(status_code=500, detail="Erro ao atualizar usuário") from None


@router.delete("/{usuario_id}")
def excluir_usuario(
    usuario_id: int,
    usuario_auth: UsuarioAutenticado = Depends(require_permisao("configuracoes")),
    db=Depends(get_supabase),
):
    """Exclui um usuário do sistema."""
    try:
        if usuario_id == usuario_auth.id:
            raise HTTPException(status_code=400, detail="Você não pode excluir a própria conta.")

        check = db.table("usuarios").select("*").eq("id", usuario_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Usuário não encontrado.")

        if _eh_admin(check.data[0]) and _contar_admins_ativos(db, excluir_id=usuario_id) == 0:
            raise HTTPException(
                status_code=400,
                detail="O sistema precisa de pelo menos um administrador ativo.",
            )

        db.table("usuarios").delete().eq("id", usuario_id).execute()
        return {"status": "success", "message": "Usuário excluído com sucesso."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao excluir usuário")
        raise HTTPException(status_code=500, detail="Erro ao excluir usuário") from None


@router.post("/login", response_model=LoginResponse)
def login(credenciais: LoginRequest, request: Request, db=Depends(get_supabase)):
    """Autentica um usuário e retorna seus dados, permissões e um token de acesso."""
    try:
        if not secret_esta_configurada():
            raise HTTPException(
                status_code=500,
                detail="Servidor mal configurado: JWT_SECRET não definido. Contate o administrador.",
            )

        ip = obter_ip_cliente(request)
        chave_email = credenciais.email.strip().lower()

        if limite_login.bloqueado(chave_email, db=db) or limite_login.bloqueado(ip, db=db):
            raise HTTPException(
                status_code=429,
                detail="Muitas tentativas de login. Aguarde um pouco e tente novamente.",
            )

        response = db.table("usuarios").select("*").eq("email", credenciais.email).limit(1).execute()
        if not response.data:
            limite_login.registrar(chave_email, db=db)
            limite_login.registrar(ip, db=db)
            raise HTTPException(status_code=401, detail="E-mail ou senha inválidos.")

        user = response.data[0]
        if not verificar_senha(credenciais.senha, user.get("senha", "")):
            limite_login.registrar(chave_email, db=db)
            limite_login.registrar(ip, db=db)
            raise HTTPException(status_code=401, detail="E-mail ou senha inválidos.")

        if not user.get("ativo", True):
            raise HTTPException(status_code=403, detail="Usuário inativo. Contate o administrador.")

        # Login bem-sucedido: zera os contadores do usuário e do IP
        limite_login.restaurar(chave_email, db=db)
        limite_login.restaurar(ip, db=db)

        token = criar_token_acesso(user["id"], user["email"])
        return {**_user_sem_senha(user), "token": token}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao autenticar")
        raise HTTPException(status_code=500, detail="Erro ao autenticar") from None


class TrocarSenhaRequest(BaseModel):
    senha_atual: str = Field(...)
    nova_senha: str = Field(
        ..., min_length=SENHA_MIN_LENGTH, description=f"A nova senha deve ter no mínimo {SENHA_MIN_LENGTH} caracteres"
    )


@router.post("/trocar-senha")
def trocar_senha(
    dados: TrocarSenhaRequest,
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    """Permite o próprio usuário autenticado trocar sua senha (auto-serviço).

    Exige a senha atual para confirmação e zera o flag `precisa_trocar_senha`.
    """
    try:
        response = db.table("usuarios").select("*").eq("id", usuario.id).limit(1).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Usuário não encontrado.")

        if not verificar_senha(dados.senha_atual, response.data[0].get("senha", "")):
            raise HTTPException(status_code=400, detail="Senha atual incorreta.")

        if dados.senha_atual == dados.nova_senha:
            raise HTTPException(status_code=400, detail="A nova senha deve ser diferente da atual.")

        db.table("usuarios").update(
            {
                "senha": hash_senha(dados.nova_senha),
                "precisa_trocar_senha": False,
            }
        ).eq("id", usuario.id).execute()

        # O arquivo com a senha inicial não é mais necessário.
        _remover_arquivo_senha_inicial()

        return {"status": "success", "message": "Senha alterada com sucesso."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao trocar senha")
        raise HTTPException(status_code=500, detail="Erro ao trocar senha") from None


@router.post("/refresh", response_model=LoginResponse)
def renovar_sessao(
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    """Renova a sessão emitindo um novo token para o usuário autenticado.

    Requer um token válido (o `get_current_user` já o valida). Usado pelo
    frontend pouco antes da expiração para evitar deslogar o usuário.
    """
    try:
        if not secret_esta_configurada():
            raise HTTPException(
                status_code=500,
                detail="Servidor mal configurado: JWT_SECRET não definido. Contate o administrador.",
            )
        response = db.table("usuarios").select("*").eq("id", usuario.id).limit(1).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Usuário não encontrado.")
        user = response.data[0]
        if not user.get("ativo", True):
            raise HTTPException(status_code=403, detail="Usuário inativo. Contate o administrador.")
        token = criar_token_acesso(user["id"], user["email"])
        return {**_user_sem_senha(user), "token": token}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao renovar sessão")
        raise HTTPException(status_code=500, detail="Erro ao renovar sessão") from None


# O admin padrão é garantido na inicialização da aplicação (lifespan em main.py).
# A chamada não fica no import do módulo para não tocar o banco durante testes.
