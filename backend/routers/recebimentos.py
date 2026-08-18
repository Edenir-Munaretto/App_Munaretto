import logging
from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, Field
from typing import List, Optional
from supabase_client import get_supabase
from auth import get_current_user, require_permisao

router = APIRouter(dependencies=[Depends(require_permisao("recebimentos"))])

logger = logging.getLogger(__name__)

class RecebimentoCreate(BaseModel):
    nome_cliente: str = Field(..., description="Nome do cliente")
    data_inicio: Optional[str] = None
    valor_da_obra: Optional[float] = 0.0
    valor_de_devolucao: Optional[float] = 0.0
    pag_cliente: Optional[float] = 0.0
    emissao_nf: Optional[str] = None
    nota_ps: Optional[str] = None
    cessao: Optional[str] = "nao"

class RecebimentoResponse(RecebimentoCreate):
    id: int
    data_registro: str

@router.get("/", response_model=List[RecebimentoResponse])
def listar_recebimentos(
    data_inicio_de: Optional[str] = Query(None, description="Filtrar registros com data_inicio >= esta data (YYYY-MM-DD)"),
    data_inicio_ate: Optional[str] = Query(None, description="Filtrar registros com data_inicio <= esta data (YYYY-MM-DD)"),
    limit: Optional[int] = Query(None, ge=1, le=10000, description="Máximo de registros a retornar (paginação)"),
    offset: Optional[int] = Query(0, ge=0, description="Registros a pular (paginação)"),
    db = Depends(get_supabase)
):
    """Lista recebimentos registrados. Suporta filtro por intervalo de data de início."""
    try:
        query = db.table("controle_recebimentos").select("*")
        if data_inicio_de:
            query = query.gte("data_inicio", data_inicio_de)
        if data_inicio_ate:
            query = query.lte("data_inicio", data_inicio_ate)
        query = query.order("data_inicio", desc=True)
        if limit is not None:
            query = query.range(offset, offset + limit - 1)
        response = query.execute()
        return response.data
    except Exception as e:
        logger.exception("Erro ao buscar recebimentos")
        raise HTTPException(status_code=500, detail="Erro ao buscar recebimentos")
@router.get("/{recebimento_id}", response_model=RecebimentoResponse)
def buscar_recebimento(recebimento_id: int, db = Depends(get_supabase)):
    """Busca um recebimento específico pelo ID."""
    try:
        response = db.table("controle_recebimentos").select("*").eq("id", recebimento_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Recebimento não encontrado.")
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao buscar recebimento")
        raise HTTPException(status_code=500, detail="Erro ao buscar recebimento")
@router.post("/", response_model=RecebimentoResponse, status_code=201)
def criar_recebimento(recebimento: RecebimentoCreate, db = Depends(get_supabase)):
    """Cria um novo registro de recebimento."""
    try:
        payload = recebimento.model_dump()
        for key, value in list(payload.items()):
            if value == "":
                payload[key] = None
        response = db.table("controle_recebimentos").insert(payload).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao salvar recebimento.")
        return response.data[0]
    except Exception as e:
        logger.exception("Erro ao criar recebimento")
        raise HTTPException(status_code=500, detail="Erro ao criar recebimento")
@router.put("/{recebimento_id}", response_model=RecebimentoResponse)
def atualizar_recebimento(recebimento_id: int, recebimento: RecebimentoCreate, db = Depends(get_supabase)):
    """Atualiza um recebimento existente."""
    try:
        check = db.table("controle_recebimentos").select("id").eq("id", recebimento_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Recebimento não encontrado.")

        payload = recebimento.model_dump()
        for key, value in list(payload.items()):
            if value == "":
                payload[key] = None
        response = db.table("controle_recebimentos").update(payload).eq("id", recebimento_id).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar recebimento.")
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao atualizar recebimento")
        raise HTTPException(status_code=500, detail="Erro ao atualizar recebimento")
@router.delete("/{recebimento_id}")
def excluir_recebimento(recebimento_id: int, db = Depends(get_supabase)):
    """Exclui um recebimento do sistema."""
    try:
        check = db.table("controle_recebimentos").select("id").eq("id", recebimento_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Recebimento não encontrado.")

        db.table("controle_recebimentos").delete().eq("id", recebimento_id).execute()
        return {"status": "success", "message": "Recebimento excluído com sucesso."}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao excluir recebimento")
        raise HTTPException(status_code=500, detail="Erro ao excluir recebimento")