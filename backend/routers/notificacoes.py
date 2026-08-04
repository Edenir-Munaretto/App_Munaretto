from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, Field
from supabase_client import get_supabase

router = APIRouter()


class NotificacaoCreate(BaseModel):
    tipo: str = Field("ferias", description="Tipo da notificação (ex: ferias)")
    titulo: str = Field(..., min_length=1, description="Título curto da notificação")
    mensagem: str = Field(..., min_length=1, description="Descrição da notificação")
    destinatario: Optional[str] = Field(None, description="E-mail do usuário destinatário")
    ferias_id: Optional[int] = Field(None, description="ID do registro de férias relacionado")
    criada_por: Optional[str] = Field(None, description="Usuário que originou a notificação")


class NotificacaoResponse(BaseModel):
    id: int
    tipo: str
    titulo: str
    mensagem: str
    destinatario: Optional[str]
    ferias_id: Optional[int]
    lida: bool
    criada_por: Optional[str]
    created_at: Optional[str] = None


@router.get("/", response_model=List[NotificacaoResponse])
def listar_notificacoes(
    destinatario: Optional[str] = Query(None, description="Filtra pelos e-mails destinatários"),
    lida: Optional[bool] = Query(None, description="Filtra por lida/não lida"),
    db = Depends(get_supabase),
):
    """Lista notificações. Pode filtrar por destinatário e estado de leitura."""
    try:
        query = db.table("notificacoes").select("*").order("created_at", desc=True)

        if destinatario:
            query = query.eq("destinatario", destinatario)
        if lida is not None:
            query = query.eq("lida", lida)

        response = query.execute()
        return response.data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao listar notificações: {str(e)}")


@router.post("/", response_model=NotificacaoResponse, status_code=201)
def criar_notificacao(notificacao: NotificacaoCreate, db = Depends(get_supabase)):
    """Cria uma nova notificação no sistema."""
    try:
        response = db.table("notificacoes").insert(notificacao.model_dump()).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao criar notificação.")
        return response.data[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao criar notificação: {str(e)}")


@router.patch("/{notificacao_id}/lida")
def marcar_lida(notificacao_id: int, db = Depends(get_supabase)):
    """Marca uma notificação como lida."""
    try:
        response = db.table("notificacoes").update({"lida": True}).eq("id", notificacao_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Notificação não encontrada.")
        return {"success": True, "id": notificacao_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao marcar notificação como lida: {str(e)}")


@router.post("/marcar-todas-lidas")
def marcar_todas_lidas(destinatario: str = Query(...), db = Depends(get_supabase)):
    """Marca todas as notificações de um destinatário como lidas."""
    try:
        db.table("notificacoes").update({"lida": True}).eq("destinatario", destinatario).eq("lida", False).execute()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao marcar notificações como lidas: {str(e)}")