import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, Field
from supabase_client import get_supabase
from auth import get_current_user, require_qualquer_permisao

router = APIRouter(dependencies=[Depends(require_qualquer_permisao(["clientes", "ferias"]))])

logger = logging.getLogger(__name__)


class FuncionarioCreate(BaseModel):
    nome: str = Field(..., min_length=2, description="Nome do funcionário")
    cpf: str = Field(..., min_length=11, description="CPF do funcionário")


class FuncionarioResponse(FuncionarioCreate):
    id: int
    ativo: bool
    created_at: Optional[str] = None


@router.get("/", response_model=List[FuncionarioResponse])
def listar_funcionarios(
    busca: Optional[str] = Query(None, description="Termo de busca (nome ou CPF)"),
    db = Depends(get_supabase),
):
    """Lista todos os funcionários ativos. Filtra por nome ou CPF se informado."""
    try:
        base = lambda: db.table("funcionarios").select("*").eq("ativo", True)

        if busca:
            # Busca segura por coluna (parametrizada); sem interpolação no filtro do PostgREST
            consolidado = {}
            for coluna in ("nome", "cpf"):
                resposta = base().ilike(coluna, f"%{busca}%").execute()
                for linha in resposta.data:
                    consolidado[linha["id"]] = linha
            dados = list(consolidado.values())
        else:
            dados = base().execute().data

        dados.sort(key=lambda x: str(x.get("nome", "")))
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
@router.delete("/{funcionario_id}")
def excluir_funcionario(funcionario_id: int, db = Depends(get_supabase)):
    """Realiza exclusão lógica (soft delete) do funcionário."""
    try:
        check = db.table("funcionarios").select("id").eq("id", funcionario_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Funcionário não encontrado")

        db.table("funcionarios").update({"ativo": False}).eq("id", funcionario_id).execute()
        return {"success": True, "message": "Funcionário excluído com sucesso."}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao excluir funcionário")
        raise HTTPException(status_code=500, detail="Erro ao excluir funcionário")