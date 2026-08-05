from typing import List, Optional
from datetime import datetime, timedelta
import logging

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, Field
from supabase_client import get_supabase
from auth import get_current_user, UsuarioAutenticado

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(get_current_user)])


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


def _gerar_lembretes_ferias(db) -> None:
    """Gera lembretes para programações de férias ainda não confirmadas.

    Para cada registro com status "Programado", cria uma notificação 30 dias
    antes da data de início e, a partir daí, uma nova notificação a cada 3 dias
    até a data de início. A geração é idempotente: verifica se já existe uma
    notificação com o mesmo destinatário, registro e mensagem.
    """
    try:
        programacoes = db.table("gestao_ferias").select(
            "id, nome, data_inicio"
        ).eq("status", "Programado").execute()
        if not programacoes.data:
            return

        destinatarios = db.table("usuarios").select("email, permissoes").eq("ativo", True).execute()
        alvos = [u["email"] for u in destinatarios.data if "ferias" in (u.get("permissoes") or [])]
        if not alvos:
            return

        hoje = datetime.now().date()

        for p in programacoes.data:
            try:
                inicio = datetime.strptime(p["data_inicio"], "%Y-%m-%d").date()
            except Exception:
                continue

            if inicio < hoje:
                continue

            nome = p["nome"]
            ferias_id = p["id"]
            inicio_br = inicio.strftime("%d/%m/%Y")

            # Datas de lembrete: 30 dias antes do início e depois a cada 3 dias até o início
            datas_lembrete = []
            d = inicio - timedelta(days=30)
            while d <= inicio:
                datas_lembrete.append(d)
                d = d + timedelta(days=3)

            # Gera APENAS o lembrete do passo atual (maior data de lembrete já chegada),
            # evitando gerar todos os atrasados de uma só vez
            passo_atual = [dia for dia in datas_lembrete if dia <= hoje]
            if not passo_atual:
                continue
            dia = max(passo_atual)

            dias_restantes = (inicio - dia).days
            if dias_restantes == 0:
                titulo = f"Férias de {nome} começam hoje"
                mensagem = (
                    f"As férias de {nome} começam hoje ({inicio_br}) e a "
                    "programação ainda não foi confirmada."
                )
            else:
                titulo = f"Férias de {nome} em {dias_restantes} dias"
                mensagem = (
                    f"Faltam {dias_restantes} dias para o início das férias de "
                    f"{nome} ({inicio_br}). A programação ainda não foi confirmada."
                )

            for alvo in alvos:
                existe = db.table("notificacoes").select("id").eq(
                    "destinatario", alvo
                ).eq("ferias_id", ferias_id).eq("tipo", "ferias").eq(
                    "mensagem", mensagem
                ).execute()
                if existe.data:
                    continue

                db.table("notificacoes").insert({
                    "tipo": "ferias",
                    "titulo": titulo,
                    "mensagem": mensagem,
                    "destinatario": alvo,
                    "ferias_id": ferias_id,
                    "criada_por": "Sistema",
                }).execute()
    except Exception as e:
        logger.warning(f"Erro ao gerar lembretes de férias: {e}")


@router.get("/", response_model=List[NotificacaoResponse])
def listar_notificacoes(
    lida: Optional[bool] = Query(None, description="Filtra por lida/não lida"),
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db = Depends(get_supabase),
):
    """Lista apenas as notificações do usuário autenticado (e-mail derivado do token)."""
    try:
        _gerar_lembretes_ferias(db)
        query = db.table("notificacoes").select("*").order("created_at", desc=True)

        # Escopo obrigatório: ignora qualquer destinatário enviado pelo cliente
        query = query.eq("destinatario", usuario.email)
        if lida is not None:
            query = query.eq("lida", lida)

        response = query.execute()
        return response.data
    except Exception as e:
        logger.exception("Erro ao listar notificações")
        raise HTTPException(status_code=500, detail="Erro ao listar notificações")
@router.post("/", response_model=NotificacaoResponse, status_code=201)
def criar_notificacao(notificacao: NotificacaoCreate, usuario: UsuarioAutenticado = Depends(get_current_user), db = Depends(get_supabase)):
    """Cria uma notificação para o próprio usuário autenticado (destinatário vem do token)."""
    try:
        payload = notificacao.model_dump()
        payload["destinatario"] = usuario.email
        response = db.table("notificacoes").insert(payload).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao criar notificação.")
        return response.data[0]
    except Exception as e:
        logger.exception("Erro ao criar notificação")
        raise HTTPException(status_code=500, detail="Erro ao criar notificação")
@router.patch("/{notificacao_id}/lida")
def marcar_lida(notificacao_id: int, usuario: UsuarioAutenticado = Depends(get_current_user), db = Depends(get_supabase)):
    """Marca uma notificação do usuário autenticado como lida."""
    try:
        response = db.table("notificacoes").update({"lida": True}).eq("id", notificacao_id).eq("destinatario", usuario.email).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Notificação não encontrada.")
        return {"success": True, "id": notificacao_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao marcar notificação como lida")
        raise HTTPException(status_code=500, detail="Erro ao marcar notificação como lida")
@router.post("/marcar-todas-lidas")
def marcar_todas_lidas(usuario: UsuarioAutenticado = Depends(get_current_user), db = Depends(get_supabase)):
    """Marca todas as notificações do usuário autenticado como lidas."""
    try:
        db.table("notificacoes").update({"lida": True}).eq("destinatario", usuario.email).eq("lida", False).execute()
        return {"success": True}
    except Exception as e:
        logger.exception("Erro ao marcar notificações como lidas")
        raise HTTPException(status_code=500, detail="Erro ao marcar notificações como lidas")