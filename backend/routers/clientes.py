import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

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


class ObraClienteCreate(BaseModel):
    """Obra adicional do cliente (tabela isolada do módulo O.S)."""

    nome: str = Field(..., min_length=2, description="Identificação da obra")
    nota_ps: str | None = Field(None, description="Nota PS / Projeto Sap")
    endereco: str | None = None
    cidade: str | None = None
    cep: str | None = None
    valor_da_obra: str | None = None
    valor_de_devolucao: str | None = None

    @field_validator("nota_ps", "endereco", "cidade", "cep", "valor_da_obra", "valor_de_devolucao")
    @classmethod
    def _vazio_para_none(cls, valor):
        if isinstance(valor, str):
            valor = valor.strip()
            return valor or None
        return valor

    @field_validator("nome")
    @classmethod
    def _normalizar_nome(cls, valor: str) -> str:
        valor = valor.strip()
        if len(valor) < 2:
            raise ValueError("Informe a identificação da obra.")
        return valor


class ObraClienteResponse(ObraClienteCreate):
    id: int
    cliente_id: int
    ativo: bool = True
    created_at: str | None = None


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
            query = query.or_(f"nome.ilike.%{termo}%,cpf_cnpj.ilike.%{termo}%,nota_ps.ilike.%{termo}%")

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


# ---------------------------------------------------------------------------
# Obras adicionais do cliente
#
# Tabela própria (`obras_cliente`) para NÃO interferir no módulo O.S, que
# continua lendo exclusivamente a tabela `obras`. A primeira obra continua nos
# campos do cadastro do cliente; aqui ficam as obras seguintes.
# ---------------------------------------------------------------------------


def _cliente_ou_404(db, cliente_id: int) -> None:
    check = db.table("clientes").select("id").eq("id", cliente_id).execute()
    if not check.data:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")


def _obra_cliente_ou_404(db, cliente_id: int, obra_id: int) -> dict:
    check = (
        db.table("obras_cliente")
        .select("id")
        .eq("id", obra_id)
        .eq("cliente_id", cliente_id)
        .execute()
    )
    if not check.data:
        raise HTTPException(status_code=404, detail="Obra não encontrada para este cliente.")
    return check.data[0]


@router.get("/{cliente_id}/obras", response_model=list[ObraClienteResponse])
def listar_obras_cliente(
    cliente_id: int,
    incluir_inativas: bool = Query(False, description="Inclui obras inativadas"),
    db=Depends(get_supabase),
):
    """Lista as obras adicionais vinculadas ao cliente."""
    try:
        _cliente_ou_404(db, cliente_id)
        query = db.table("obras_cliente").select("*").eq("cliente_id", cliente_id)
        if not incluir_inativas:
            query = query.eq("ativo", True)
        return query.order("id").execute().data
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao listar obras do cliente %s", cliente_id)
        raise HTTPException(status_code=500, detail="Erro ao listar obras do cliente") from None


@router.post("/{cliente_id}/obras", response_model=ObraClienteResponse, status_code=201)
def criar_obra_cliente(cliente_id: int, obra: ObraClienteCreate, db=Depends(get_supabase)):
    """Cria uma obra adicional para o cliente, sem duplicar o cadastro dele."""
    try:
        _cliente_ou_404(db, cliente_id)
        dados = obra.model_dump()
        dados["cliente_id"] = cliente_id
        dados["ativo"] = True
        response = db.table("obras_cliente").insert(dados).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao criar obra.")
        return response.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao criar obra do cliente %s", cliente_id)
        raise HTTPException(status_code=500, detail="Erro ao criar obra do cliente") from None


@router.put("/{cliente_id}/obras/{obra_id}", response_model=ObraClienteResponse)
def atualizar_obra_cliente(
    cliente_id: int, obra_id: int, obra: ObraClienteCreate, db=Depends(get_supabase)
):
    """Atualiza os dados de uma obra adicional do cliente."""
    try:
        _cliente_ou_404(db, cliente_id)
        _obra_cliente_ou_404(db, cliente_id, obra_id)
        response = db.table("obras_cliente").update(obra.model_dump()).eq("id", obra_id).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar obra.")
        return response.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao atualizar obra %s do cliente %s", obra_id, cliente_id)
        raise HTTPException(status_code=500, detail="Erro ao atualizar obra do cliente") from None


@router.delete("/{cliente_id}/obras/{obra_id}")
def excluir_obra_cliente(cliente_id: int, obra_id: int, db=Depends(get_supabase)):
    """Inativa a obra adicional do cliente (soft delete)."""
    try:
        _cliente_ou_404(db, cliente_id)
        _obra_cliente_ou_404(db, cliente_id, obra_id)
        db.table("obras_cliente").update({"ativo": False}).eq("id", obra_id).execute()
        return {"success": True, "message": "Obra excluída com sucesso."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao excluir obra %s do cliente %s", obra_id, cliente_id)
        raise HTTPException(status_code=500, detail="Erro ao excluir obra do cliente") from None
