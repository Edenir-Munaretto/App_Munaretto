import hashlib
import hmac
import os
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from supabase_client import get_supabase, supabase

router = APIRouter()

# ---------------------------------------------------------------------------
# Hash de senha (pbkdf2 - sem dependências externas)
# ---------------------------------------------------------------------------

def hash_senha(senha: str) -> str:
    salt = os.urandom(16).hex()
    hash_value = hashlib.pbkdf2_hmac(
        "sha256", senha.encode("utf-8"), bytes.fromhex(salt), 100000
    ).hex()
    return f"{salt}${hash_value}"

def verificar_senha(senha: str, armazenada: str) -> bool:
    try:
        salt, hash_armazenado = armazenada.split("$")
        hash_calculado = hashlib.pbkdf2_hmac(
            "sha256", senha.encode("utf-8"), bytes.fromhex(salt), 100000
        ).hex()
        return hmac.compare_digest(hash_calculado, hash_armazenado)
    except Exception:
        return False

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class UsuarioCreate(BaseModel):
    nome: str = Field(..., min_length=2, description="Nome do usuário")
    email: str = Field(..., description="E-mail de acesso")
    senha: str = Field(..., min_length=4, description="Senha de acesso")
    permissoes: List[str] = Field(default_factory=list, description="IDs dos módulos acessíveis")
    ativo: bool = True

class UsuarioUpdate(BaseModel):
    nome: str = Field(..., min_length=2)
    email: str = Field(...)
    senha: Optional[str] = None
    permissoes: List[str] = Field(default_factory=list)
    ativo: bool = True

class UsuarioResponse(BaseModel):
    id: int
    nome: str
    email: str
    permissoes: List[str]
    ativo: bool
    created_at: Optional[str] = None

class LoginRequest(BaseModel):
    email: str = Field(...)
    senha: str = Field(...)

# ---------------------------------------------------------------------------
# Admin padrão
# ---------------------------------------------------------------------------

def _garantir_admin(db) -> None:
    try:
        res = db.table("usuarios").select("id").limit(1).execute()
        if not res.data:
            db.table("usuarios").insert({
                "nome": "Administrador",
                "email": "admin@munaretto.com",
                "senha": hash_senha("admin123"),
                "permissoes": [
                    "dashboard", "clientes", "ferias", "fluxo",
                    "documentos", "comprovantes", "recebimentos", "configuracoes"
                ],
                "ativo": True,
            }).execute()
            print("✅ Usuário padrão criado: admin@munaretto.com / admin123")
    except Exception as e:
        print(f"⚠️ Aviso: não foi possível garantir o admin padrão: {e}")

def _user_sem_senha(user: dict) -> dict:
    return {k: v for k, v in user.items() if k != "senha"}

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/", response_model=List[UsuarioResponse])
def listar_usuarios(db = Depends(get_supabase)):
    """Lista todos os usuários cadastrados."""
    try:
        response = db.table("usuarios").select("*").order("nome").execute()
        return [_user_sem_senha(u) for u in response.data]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao buscar usuários: {str(e)}")

@router.get("/{usuario_id}", response_model=UsuarioResponse)
def buscar_usuario(usuario_id: int, db = Depends(get_supabase)):
    """Busca um usuário pelo ID."""
    try:
        response = db.table("usuarios").select("*").eq("id", usuario_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Usuário não encontrado.")
        return _user_sem_senha(response.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao buscar usuário: {str(e)}")

@router.post("/", response_model=UsuarioResponse, status_code=201)
def criar_usuario(usuario: UsuarioCreate, db = Depends(get_supabase)):
    """Cria um novo usuário no sistema."""
    try:
        dup = db.table("usuarios").select("id").eq("email", usuario.email).execute()
        if dup.data:
            raise HTTPException(status_code=400, detail="Já existe um usuário com este e-mail.")

        payload = usuario.model_dump()
        payload["senha"] = hash_senha(usuario.senha)
        response = db.table("usuarios").insert(payload).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao criar usuário.")
        return _user_sem_senha(response.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao criar usuário: {str(e)}")

@router.put("/{usuario_id}", response_model=UsuarioResponse)
def atualizar_usuario(usuario_id: int, usuario: UsuarioUpdate, db = Depends(get_supabase)):
    """Atualiza um usuário existente."""
    try:
        check = db.table("usuarios").select("id").eq("id", usuario_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Usuário não encontrado.")

        dup = db.table("usuarios").select("id").eq("email", usuario.email).neq("id", usuario_id).execute()
        if dup.data:
            raise HTTPException(status_code=400, detail="Já existe um usuário com este e-mail.")

        payload = usuario.model_dump()
        if not payload.get("senha"):
            payload.pop("senha", None)
        else:
            payload["senha"] = hash_senha(payload["senha"])

        response = db.table("usuarios").update(payload).eq("id", usuario_id).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar usuário.")
        return _user_sem_senha(response.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar usuário: {str(e)}")

@router.delete("/{usuario_id}")
def excluir_usuario(usuario_id: int, db = Depends(get_supabase)):
    """Exclui um usuário do sistema."""
    try:
        check = db.table("usuarios").select("id").eq("id", usuario_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Usuário não encontrado.")

        db.table("usuarios").delete().eq("id", usuario_id).execute()
        return {"status": "success", "message": "Usuário excluído com sucesso."}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao excluir usuário: {str(e)}")

@router.post("/login", response_model=UsuarioResponse)
def login(credenciais: LoginRequest, db = Depends(get_supabase)):
    """Autentica um usuário e retorna seus dados e permissões."""
    try:
        response = db.table("usuarios").select("*").eq("email", credenciais.email).limit(1).execute()
        if not response.data:
            raise HTTPException(status_code=401, detail="E-mail ou senha inválidos.")

        user = response.data[0]
        if not verificar_senha(credenciais.senha, user.get("senha", "")):
            raise HTTPException(status_code=401, detail="E-mail ou senha inválidos.")
        if not user.get("ativo", True):
            raise HTTPException(status_code=403, detail="Usuário inativo. Contate o administrador.")

        return _user_sem_senha(user)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao autenticar: {str(e)}")

# Garante a existência de um usuário admin padrão no primeiro acesso
if supabase is not None:
    try:
        _garantir_admin(supabase)
    except Exception as e:
        print(f"⚠️ Aviso ao inicializar admin padrão: {e}")
