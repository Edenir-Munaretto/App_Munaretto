import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, Field
from supabase_client import get_supabase
from auth import get_current_user, require_qualquer_permisao

# O router é acessível por quem tem o módulo "funcionarios" (novo), além de
# "clientes"/"ferias" (compatibilidade) e "sst" (o módulo de Segurança do
# Trabalho usa a lista de funcionários para treinamentos, ASO e EPIs).
router = APIRouter(dependencies=[Depends(require_qualquer_permisao(["funcionarios", "clientes", "ferias", "sst"]))])

logger = logging.getLogger(__name__)


class FuncionarioCreate(BaseModel):
    nome: str = Field(..., min_length=2, description="Nome do funcionário")
    cpf: str = Field(..., min_length=11, description="CPF do funcionário")
    cargo_id: Optional[int] = Field(None, description="ID do cargo/função (módulo SST)")
    cargo_id_2: Optional[int] = Field(None, description="ID da 2ª função (módulo SST)")


class FuncionarioResponse(FuncionarioCreate):
    id: int
    ativo: bool
    created_at: Optional[str] = None
    cargo_id: Optional[int] = None
    cargo_id_2: Optional[int] = None


class FuncionarioStats(BaseModel):
    total: int
    ativos: int
    inativos: int


@router.get("/stats", response_model=FuncionarioStats)
def estatisticas_funcionarios(db = Depends(get_supabase)):
    """Retorna a quantidade total de funcionários cadastrados (ativos + inativos), sem contar os excluídos."""
    try:
        response = db.table("funcionarios").select("ativo", "excluido").eq("excluido", False).execute()
        dados = response.data
        total = len(dados)
        ativos = sum(1 for r in dados if r.get("ativo", True))
        return FuncionarioStats(total=total, ativos=ativos, inativos=total - ativos)
    except Exception as e:
        logger.exception("Erro ao buscar estatísticas de funcionários")
        raise HTTPException(status_code=500, detail="Erro ao buscar estatísticas de funcionários")


@router.get("/", response_model=List[FuncionarioResponse])
def listar_funcionarios(
    busca: Optional[str] = Query(None, description="Termo de busca (nome ou CPF)"),
    status: Optional[str] = Query("ativos", description="Filtro de status: ativos, inativos ou todos"),
    limit: Optional[int] = Query(None, ge=1, le=10000, description="Máximo de registros a retornar (paginação)"),
    offset: Optional[int] = Query(0, ge=0, description="Registros a pular (paginação)"),
    db = Depends(get_supabase),
):
    """Lista funcionários filtrados por status (exclui os excluídos). Filtra por nome ou CPF se informado."""

    def base():
        query = db.table("funcionarios").select("*").eq("excluido", False)
        if status == "inativos":
            query = query.eq("ativo", False)
        elif status != "todos":
            query = query.eq("ativo", True)
        return query

    try:
        if busca:
            # Busca segura por coluna (parametrizada); sem interpolação no filtro do PostgREST
            consolidado = {}
            for coluna in ("nome", "cpf"):
                resposta = base().ilike(coluna, f"%{busca}%").execute()
                for linha in resposta.data:
                    consolidado[linha["id"]] = linha
            dados = list(consolidado.values())
        else:
            query = base().order("nome")
            if limit is not None:
                query = query.range(offset, offset + limit - 1)
            dados = query.execute().data

        dados.sort(key=lambda x: str(x.get("nome", "")).lower())
        # Quando há busca, aplica paginação em memória (busca já consolidou tudo)
        if busca and limit is not None:
            dados = dados[offset:offset + limit]
        return dados
    except Exception as e:
        logger.exception("Erro ao buscar funcionários")
        raise HTTPException(status_code=500, detail="Erro ao buscar funcionários")
@router.get("/{funcionario_id}", response_model=FuncionarioResponse)
def buscar_funcionario(funcionario_id: int, db = Depends(get_supabase)):
    """Busca os detalhes de um funcionário pelo ID."""
    try:
        response = db.table("funcionarios").select("*").eq("id", funcionario_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Funcionário não encontrado")
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao buscar funcionário")
        raise HTTPException(status_code=500, detail="Erro ao buscar funcionário")
@router.post("/", response_model=FuncionarioResponse, status_code=201)
def cadastrar_funcionario(funcionario: FuncionarioCreate, db = Depends(get_supabase)):
    """Cadastra um novo funcionário. Retorna erro se o CPF já existir."""
    try:
        dup_check = db.table("funcionarios").select("id").eq("cpf", funcionario.cpf).eq("ativo", True).execute()
        if dup_check.data:
            raise HTTPException(status_code=400, detail="Este CPF já está cadastrado para um funcionário ativo.")

        response = db.table("funcionarios").insert(funcionario.model_dump()).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao cadastrar funcionário.")

        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao cadastrar funcionário")
        raise HTTPException(status_code=500, detail="Erro ao cadastrar funcionário")
@router.put("/{funcionario_id}", response_model=FuncionarioResponse)
def atualizar_funcionario(funcionario_id: int, funcionario: FuncionarioCreate, db = Depends(get_supabase)):
    """Atualiza os dados de um funcionário existente."""
    try:
        check = db.table("funcionarios").select("id").eq("id", funcionario_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Funcionário não encontrado")

        dup_check = db.table("funcionarios").select("id").eq("cpf", funcionario.cpf).neq("id", funcionario_id).eq("ativo", True).execute()
        if dup_check.data:
            raise HTTPException(status_code=400, detail="Este CPF já está cadastrado para outro funcionário.")

        response = db.table("funcionarios").update(funcionario.model_dump()).eq("id", funcionario_id).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar funcionário.")

        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao atualizar funcionário")
        raise HTTPException(status_code=500, detail="Erro ao atualizar funcionário")
class FuncionarioStatusUpdate(BaseModel):
    ativo: bool


@router.patch("/{funcionario_id}/status", response_model=FuncionarioResponse)
def alterar_status_funcionario(funcionario_id: int, payload: FuncionarioStatusUpdate, db = Depends(get_supabase)):
    """Ativa ou inativa um funcionário existente."""
    try:
        check = db.table("funcionarios").select("id").eq("id", funcionario_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Funcionário não encontrado")

        response = db.table("funcionarios").update({"ativo": payload.ativo}).eq("id", funcionario_id).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao alterar status do funcionário.")

        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao alterar status do funcionário")
        raise HTTPException(status_code=500, detail="Erro ao alterar status do funcionário")


@router.delete("/{funcionario_id}")
def excluir_funcionario(funcionario_id: int, db = Depends(get_supabase)):
    """Realiza exclusão lógica (soft delete) do funcionário."""
    try:
        check = db.table("funcionarios").select("id").eq("id", funcionario_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Funcionário não encontrado")

        db.table("funcionarios").update({"ativo": False, "excluido": True}).eq("id", funcionario_id).execute()
        return {"success": True, "message": "Funcionário excluído com sucesso."}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao excluir funcionário")
        raise HTTPException(status_code=500, detail="Erro ao excluir funcionário")