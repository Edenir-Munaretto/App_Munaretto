import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth import UsuarioAutenticado, get_current_user
from supabase_client import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(get_current_user)])


class NotificacaoCreate(BaseModel):
    tipo: str = Field("ferias", description="Tipo da notificação (ex: ferias)")
    titulo: str = Field(..., min_length=1, description="Título curto da notificação")
    mensagem: str = Field(..., min_length=1, description="Descrição da notificação")
    destinatario: str | None = Field(None, description="E-mail do usuário destinatário")
    ferias_id: int | None = Field(None, description="ID do registro de férias relacionado")
    veiculo_documento_id: int | None = Field(None, description="ID do documento de veículo relacionado")
    criada_por: str | None = Field(None, description="Usuário que originou a notificação")


class NotificacaoResponse(BaseModel):
    id: int
    tipo: str
    titulo: str
    mensagem: str
    destinatario: str | None
    ferias_id: int | None = None
    veiculo_documento_id: int | None = None
    lida: bool
    criada_por: str | None
    created_at: str | None = None


def _gerar_lembretes_ferias(db) -> None:
    """Gera lembretes para programações de férias ainda não confirmadas.

    Para cada registro com status "Programado", cria uma notificação 30 dias
    antes da data de início e, a partir daí, uma nova notificação a cada 3 dias
    até a data de início. A geração é idempotente: verifica se já existe uma
    notificação com o mesmo destinatário, registro e mensagem.
    """
    try:
        programacoes = db.table("gestao_ferias").select("id, nome, data_inicio").eq("status", "Programado").execute()
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
                mensagem = f"As férias de {nome} começam hoje ({inicio_br}) e a programação ainda não foi confirmada."
            else:
                titulo = f"Férias de {nome} em {dias_restantes} dias"
                mensagem = (
                    f"Faltam {dias_restantes} dias para o início das férias de "
                    f"{nome} ({inicio_br}). A programação ainda não foi confirmada."
                )

            for alvo in alvos:
                existe = (
                    db.table("notificacoes")
                    .select("id")
                    .eq("destinatario", alvo)
                    .eq("ferias_id", ferias_id)
                    .eq("tipo", "ferias")
                    .eq("mensagem", mensagem)
                    .execute()
                )
                if existe.data:
                    continue

                db.table("notificacoes").insert(
                    {
                        "tipo": "ferias",
                        "titulo": titulo,
                        "mensagem": mensagem,
                        "destinatario": alvo,
                        "ferias_id": ferias_id,
                        "criada_por": "Sistema",
                    }
                ).execute()
    except Exception as e:
        logger.warning(f"Erro ao gerar lembretes de férias: {e}")


def _gerar_lembretes_documentos_veiculos(db) -> None:
    """Gera lembretes de vencimento dos documentos dos veículos (aba Documentos).

    Para cada documento de veículo com data de validade, cria notificações para
    os usuários com permissão 'manutencao':
      - lembretes a cada 3 dias começando 30 dias antes do vencimento (mensagem
        com os dias restantes), acompanhando o mesmo padrão das férias;
      - 1 notificação de "Vencido" após a data (mensagem fixa, idempotente).

    A geração é idempotente: verifica se já existe uma notificação com o mesmo
    documento (veiculo_documento_id), destinatário, tipo e mensagem.
    """
    try:
        docs = (
            db.table("veiculo_documentos")
            .select("id, tipo, data_validade, veiculo_id")
            .not_("data_validade", "is", None)
            .execute()
        )
        if not docs.data:
            return

        veiculos = {v["id"]: v for v in db.table("veiculos").select("id, modelo, placa").execute().data}

        destinatarios = db.table("usuarios").select("email, permissoes").eq("ativo", True).execute()
        alvos = [u["email"] for u in destinatarios.data if "manutencao" in (u.get("permissoes") or [])]
        if not alvos:
            return

        hoje = datetime.now().date()

        for d in docs.data:
            try:
                validade = datetime.strptime(d["data_validade"], "%Y-%m-%d").date()
            except Exception:
                continue

            veiculo = veiculos.get(d["veiculo_id"], {})
            rotulo = f"{veiculo.get('modelo', '')} - {veiculo.get('placa', '')}".strip()
            if not rotulo:
                rotulo = f"Veículo #{d['veiculo_id']}"
            validade_br = validade.strftime("%d/%m/%Y")
            doc_id = d["id"]

            if validade < hoje:
                titulo = f"Documento vencido: {d['tipo']}"
                mensagem = f'O documento "{d["tipo"]}" do veículo {rotulo} venceu em {validade_br} e está vencido.'
            else:
                dias_total = (validade - hoje).days
                if dias_total > 30:
                    continue
                # Passos de lembrete: 30 dias antes e depois a cada 3 dias até a data
                datas_lembrete = []
                passo = validade - timedelta(days=30)
                while passo <= validade:
                    datas_lembrete.append(passo)
                    passo = passo + timedelta(days=3)
                passo_atual = [dia for dia in datas_lembrete if dia <= hoje]
                if not passo_atual:
                    continue
                dia = max(passo_atual)
                dias_restantes = (validade - dia).days
                if dias_restantes == 0:
                    titulo = f"Documento vence hoje: {d['tipo']}"
                    mensagem = f'O documento "{d["tipo"]}" do veículo {rotulo} vence hoje ({validade_br}).'
                else:
                    titulo = f"Documento vence em {dias_restantes} dias"
                    mensagem = (
                        f'O documento "{d["tipo"]}" do veículo {rotulo} '
                        f"vence em {dias_restantes} dia(s) ({validade_br})."
                    )

            for alvo in alvos:
                existe = (
                    db.table("notificacoes")
                    .select("id")
                    .eq("destinatario", alvo)
                    .eq("veiculo_documento_id", doc_id)
                    .eq("tipo", "documento_veiculo")
                    .eq("mensagem", mensagem)
                    .execute()
                )
                if existe.data:
                    continue

                db.table("notificacoes").insert(
                    {
                        "tipo": "documento_veiculo",
                        "titulo": titulo,
                        "mensagem": mensagem,
                        "destinatario": alvo,
                        "veiculo_documento_id": doc_id,
                        "criada_por": "Sistema",
                    }
                ).execute()
    except Exception as e:
        logger.warning(f"Erro ao gerar lembretes de documentos de veículos: {e}")


@router.get("/", response_model=list[NotificacaoResponse])
def listar_notificacoes(
    lida: bool | None = Query(None, description="Filtra por lida/não lida"),
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    """Lista apenas as notificações do usuário autenticado (e-mail derivado do token)."""
    try:
        _gerar_lembretes_ferias(db)
        _gerar_lembretes_documentos_veiculos(db)
        query = db.table("notificacoes").select("*").order("created_at", desc=True)

        # Escopo obrigatório: ignora qualquer destinatário enviado pelo cliente
        query = query.eq("destinatario", usuario.email)
        if lida is not None:
            # `not is true` também captura registros com lida NULL (legado),
            # que o `eq(false)` deixaria de fora
            query = query.eq("lida", True) if lida else query.not_("lida", "is", True)

        response = query.execute()
        # Normaliza lida NULL (registros legados) para False, evitando erro de
        # serialização no response_model (lida é bool) e mantendo-os como "não lidas"
        for n in response.data:
            if n.get("lida") is None:
                n["lida"] = False
        return response.data
    except Exception:
        logger.exception("Erro ao listar notificações")
        raise HTTPException(status_code=500, detail="Erro ao listar notificações") from None


@router.post("/", response_model=NotificacaoResponse, status_code=201)
def criar_notificacao(
    notificacao: NotificacaoCreate, usuario: UsuarioAutenticado = Depends(get_current_user), db=Depends(get_supabase)
):
    """Cria uma notificação para o próprio usuário autenticado (destinatário vem do token)."""
    try:
        payload = notificacao.model_dump()
        payload["destinatario"] = usuario.email
        payload["lida"] = False
        response = db.table("notificacoes").insert(payload).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao criar notificação.")
        return response.data[0]
    except Exception:
        logger.exception("Erro ao criar notificação")
        raise HTTPException(status_code=500, detail="Erro ao criar notificação") from None


@router.patch("/{notificacao_id}/lida")
def marcar_lida(notificacao_id: int, usuario: UsuarioAutenticado = Depends(get_current_user), db=Depends(get_supabase)):
    """Marca uma notificação do usuário autenticado como lida."""
    try:
        response = (
            db.table("notificacoes")
            .update({"lida": True})
            .eq("id", notificacao_id)
            .eq("destinatario", usuario.email)
            .execute()
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Notificação não encontrada.")
        return {"success": True, "id": notificacao_id}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao marcar notificação como lida")
        raise HTTPException(status_code=500, detail="Erro ao marcar notificação como lida") from None


@router.delete("/{notificacao_id}")
def excluir_notificacao(
    notificacao_id: int, usuario: UsuarioAutenticado = Depends(get_current_user), db=Depends(get_supabase)
):
    """Exclui uma notificação do usuário autenticado."""
    try:
        response = (
            db.table("notificacoes").delete().eq("id", notificacao_id).eq("destinatario", usuario.email).execute()
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Notificação não encontrada.")
        return {"success": True, "id": notificacao_id}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao excluir notificação")
        raise HTTPException(status_code=500, detail="Erro ao excluir notificação") from None


@router.post("/marcar-todas-lidas")
def marcar_todas_lidas(usuario: UsuarioAutenticado = Depends(get_current_user), db=Depends(get_supabase)):
    """Marca todas as notificações do usuário autenticado como lidas."""
    try:
        # Sem filtro em lida: garante que registros com lida NULL (legado)
        # também sejam marcados
        db.table("notificacoes").update({"lida": True}).eq("destinatario", usuario.email).execute()
        return {"success": True}
    except Exception:
        logger.exception("Erro ao marcar notificações como lidas")
        raise HTTPException(status_code=500, detail="Erro ao marcar notificações como lidas") from None
