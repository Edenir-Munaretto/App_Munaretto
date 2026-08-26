import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth import require_permisao
from supabase_client import get_supabase

router = APIRouter(dependencies=[Depends(require_permisao("clientes"))])

logger = logging.getLogger(__name__)


# Schema Pydantic para validação na criação de clientes
class ClienteCreate(BaseModel):
    nome: str = Field(..., min_length=2, description="Nome completo do cliente")
    cpf_cnpj: str = Field(..., min_length=11, description="CPF ou CNPJ do cliente")
    endereco: str = Field(..., description="Endereço residencial ou comercial")
    cidade: str | None = None
    cep: str | None = None
    nota_ps: str | None = None
    valor_da_obra: str | None = None
    valor_de_devolucao: str | None = None


class ClienteResponse(ClienteCreate):
    id: int
    data_cadastro: str
    ativo: bool


@router.get("/", response_model=list[ClienteResponse])
def listar_clientes(
    busca: str | None = Query(None, description="Termo de busca (nome ou CPF/CNPJ)"), db=Depends(get_supabase)
):
    """Lista todos os clientes ativos. Se um termo de busca for fornecido, filtra os resultados."""
    try:
        query = db.table("clientes").select("*").eq("ativo", True)

        if busca:
            # OR nativo do PostgREST — uma única query em vez de duas separadas
            # Remove caracteres que o PostgREST interpreta como sintaxe de filtro
            termo = re.sub(r"[%_*,()=;<>]", "", busca)
            query = query.or_(f"nome.ilike.%{termo}%,cpf_cnpj.ilike.%{termo}%")

        response = query.order("nome").execute()
        return response.data
    except Exception:
        logger.exception("Erro ao buscar clientes")
        raise HTTPException(status_code=500, detail="Erro ao buscar clientes") from None


@router.get("/{cliente_id}", response_model=ClienteResponse)
def buscar_cliente(cliente_id: int, db=Depends(get_supabase)):
    """Busca os detalhes de um cliente específico pelo ID."""
    try:
        response = db.table("clientes").select("*").eq("id", cliente_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Cliente não encontrado")
        return response.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao buscar cliente")
        raise HTTPException(status_code=500, detail="Erro ao buscar cliente") from None


@router.post("/", response_model=ClienteResponse, status_code=201)
def cadastrar_cliente(cliente: ClienteCreate, db=Depends(get_supabase)):
    """Cadastra um novo cliente no sistema. Retorna erro se o CPF/CNPJ já existir."""
    try:
        # Verifica duplicidade
        dup_check = db.table("clientes").select("id").eq("cpf_cnpj", cliente.cpf_cnpj).eq("ativo", True).execute()
        if dup_check.data:
            raise HTTPException(status_code=400, detail="Este CPF/CNPJ já está cadastrado para um cliente ativo.")

        data = cliente.model_dump()
        response = db.table("clientes").insert(data).execute()

        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao criar cliente.")

        return response.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao cadastrar cliente")
        raise HTTPException(status_code=500, detail="Erro ao cadastrar cliente") from None


@router.put("/{cliente_id}", response_model=ClienteResponse)
def atualizar_cliente(cliente_id: int, cliente: ClienteCreate, db=Depends(get_supabase)):
    """Atualiza as informações de um cliente existente."""
    try:
        # Verifica se o cliente existe
        check = db.table("clientes").select("id").eq("id", cliente_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Cliente não encontrado")

        data = cliente.model_dump()
        response = db.table("clientes").update(data).eq("id", cliente_id).execute()

        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar cliente.")

        return response.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao atualizar cliente")
        raise HTTPException(status_code=500, detail="Erro ao atualizar cliente") from None


@router.delete("/{cliente_id}")
def excluir_cliente(cliente_id: int, db=Depends(get_supabase)):
    """Realiza exclusão lógica (soft delete) do cliente, marcando 'ativo' como falso."""
    try:
        # Verifica se o cliente existe
        check = db.table("clientes").select("id").eq("id", cliente_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Cliente não encontrado")

        db.table("clientes").update({"ativo": False}).eq("id", cliente_id).execute()
        return {"success": True, "message": "Cliente excluído com sucesso."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao excluir cliente")
        raise HTTPException(status_code=500, detail="Erro ao excluir cliente") from None
