import logging
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth import require_permisao
from supabase_client import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(require_permisao("ferias"))])

# Status aceitos para um registro de férias
STATUS_VALIDOS = {"Programado", "Agendado", "Em Férias", "Concluído", "Gozadas", "Cancelado"}


class FeriasCreate(BaseModel):
    nome: str = Field(..., description="Nome do colaborador")
    data_inicio: str = Field(..., description="Data de início no formato YYYY-MM-DD")
    dias_abono: int = Field(0, ge=0, le=10, description="Dias de abono pecuniário (máximo 10)")
    dias_gozo: int | None = Field(None, ge=1, le=30, description="Dias de gozo (opcional - padrão: 30 - abono)")
    data_limite: str | None = Field(None, description="Data limite para gozo no formato YYYY-MM-DD")
    departamento: str | None = None
    saldo_anterior: int | None = 0
    dias_utilizados: int | None = 0
    motivo_cancelamento: str | None = None
    criado_por: str | None = None


class FeriasResponse(BaseModel):
    id: int
    nome: str
    data_inicio: str
    dias_abono: int
    dias_gozo: int
    data_retorno: str
    data_limite: str
    departamento: str | None
    saldo_anterior: int | None
    dias_utilizados: int | None
    motivo_cancelamento: str | None
    status: str
    created_at: str


def add_business_days(start_date: date, business_days: int) -> date:
    current = start_date
    days_added = 0
    step = 1 if business_days >= 0 else -1
    business_days = abs(business_days)
    while days_added < business_days:
        current = current + timedelta(days=step)
        if current.weekday() < 5:  # Segunda a Sexta
            days_added += 1
    return current


def calculate_current_status(data_inicio_str: str, data_retorno_str: str, status_atual: str) -> str:
    if status_atual in ("Cancelado", "Programado"):
        return status_atual
    try:
        hoje = datetime.now().date()
        inicio = datetime.strptime(data_inicio_str, "%Y-%m-%d").date()
        retorno = datetime.strptime(data_retorno_str, "%Y-%m-%d").date()

        if hoje < inicio:
            return "Agendado"
        elif inicio <= hoje < retorno:
            return "Em Férias"
        else:
            return "Concluído"
    except Exception:
        return status_atual


@router.get("/", response_model=list[FeriasResponse])
def listar_ferias(
    busca: str | None = Query(None, description="Nome do colaborador para buscar"),
    proximo_mes: bool | None = Query(False, description="Filtrar apenas férias do próximo mês"),
    status: str | None = Query(None, description="Filtrar por status exato (ex: Programado, Agendado)"),
    limit: int | None = Query(None, ge=1, le=10000, description="Máximo de registros a retornar (paginação)"),
    offset: int | None = Query(0, ge=0, description="Registros a pular (paginação)"),
    db=Depends(get_supabase),
):
    """Lista o histórico de férias. Permite busca por nome, filtro por status e férias no próximo mês."""
    try:
        query = db.table("gestao_ferias").select("*")

        if busca:
            query = query.ilike("nome", f"%{busca}%")

        if status:
            status = status.strip()
            if status not in STATUS_VALIDOS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Status inválido. Valores permitidos: {', '.join(sorted(STATUS_VALIDOS))}.",
                )
            query = query.eq("status", status)

        if proximo_mes:
            hoje = datetime.now()
            primeiro_dia_prox_mes = (hoje.replace(day=1) + timedelta(days=32)).replace(day=1)
            ultimo_dia_prox_mes = (primeiro_dia_prox_mes + timedelta(days=32)).replace(day=1) - timedelta(days=1)

            query = query.gte("data_inicio", primeiro_dia_prox_mes.strftime("%Y-%m-%d"))
            query = query.lte("data_inicio", ultimo_dia_prox_mes.strftime("%Y-%m-%d"))

        query = query.order("data_inicio", desc=True)
        if limit is not None:
            query = query.range(offset, offset + limit - 1)
        response = query.execute()

        # Atualiza status dinamicamente antes de retornar
        result = []
        for r in response.data:
            r["status"] = calculate_current_status(r["data_inicio"], r["data_retorno"], r["status"])
            result.append(r)

        return result
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao buscar férias")
        raise HTTPException(status_code=500, detail="Erro ao buscar férias") from None


@router.post("/", response_model=FeriasResponse, status_code=201)
def agendar_ferias(ferias: FeriasCreate, db=Depends(get_supabase)):
    """Calcula prazos, valida conflitos e agenda férias de um colaborador."""
    try:
        # 1. Valida data de início
        try:
            dt_inicio = datetime.strptime(ferias.data_inicio, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(
                status_code=400, detail="Data de início com formato inválido. Use YYYY-MM-DD."
            ) from None

        # 2. Calcula dias de gozo e retorno (dias corridos)
        dias_gozo = ferias.dias_gozo if ferias.dias_gozo is not None else 30 - ferias.dias_abono
        dt_retorno = dt_inicio + timedelta(days=dias_gozo)
        data_retorno_str = dt_retorno.strftime("%Y-%m-%d")

        # 3. Calcula data limite se não fornecida (1 ano após data de início)
        if not ferias.data_limite:
            dt_limite = dt_inicio + timedelta(days=365)
            data_limite_str = dt_limite.strftime("%Y-%m-%d")
        else:
            try:
                dt_limite = datetime.strptime(ferias.data_limite, "%Y-%m-%d").date()
                data_limite_str = ferias.data_limite
            except ValueError:
                raise HTTPException(
                    status_code=400, detail="Data limite com formato inválido. Use YYYY-MM-DD."
                ) from None

        # 4. Verifica conflitos de data para o mesmo colaborador
        conflitos = (
            db.table("gestao_ferias")
            .select("data_inicio, data_retorno")
            .eq("nome", ferias.nome)
            .neq("status", "Cancelado")
            .execute()
        )
        for c in conflitos.data:
            exist_start = datetime.strptime(c["data_inicio"], "%Y-%m-%d").date()
            exist_return = datetime.strptime(c["data_retorno"], "%Y-%m-%d").date()

            # Se sobrepõe
            if dt_inicio <= exist_return and dt_retorno >= exist_start:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Conflito com férias já agendadas para este colaborador no período: "
                        f"{exist_start.strftime('%d/%m/%Y')} a {exist_return.strftime('%d/%m/%Y')}."
                    ),
                )

        # 5. Salva no banco de dados
        payload = ferias.model_dump()
        payload.pop("criado_por", None)
        payload["dias_gozo"] = dias_gozo
        payload["data_retorno"] = data_retorno_str
        payload["data_limite"] = data_limite_str
        payload["status"] = "Programado"

        response = db.table("gestao_ferias").insert(payload).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Erro ao salvar registro de férias.")

        registro = response.data[0]

        # 6. Notifica os responsáveis pela confirmação de agendamento
        try:
            data_inicio_br = dt_inicio.strftime("%d/%m/%Y")
            quem_lancou = ferias.criado_por or "um usuário"
            destinatarios = db.table("usuarios").select("email, permissoes").eq("ativo", True).execute()
            for u in destinatarios.data:
                if "ferias" in (u.get("permissoes") or []):
                    db.table("notificacoes").insert(
                        {
                            "tipo": "ferias",
                            "titulo": "Nova programação de férias",
                            "mensagem": (
                                f"Uma nova programação de férias foi lançada por {quem_lancou} "
                                f"para {ferias.nome} (início {data_inicio_br}). Aguarda confirmação de agendamento."
                            ),
                            "destinatario": u["email"],
                            "ferias_id": registro["id"],
                            "criada_por": quem_lancou,
                        }
                    ).execute()
        except Exception as e:
            logger.warning(f"Não foi possível gerar notificações de férias: {e}")

        return registro
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro interno ao agendar férias")
        raise HTTPException(status_code=500, detail="Erro interno ao agendar férias") from None


@router.patch("/{ferias_id}/status")
def atualizar_status(
    ferias_id: int,
    status: str = Query(..., description="Novo status (ex: Gozadas, Cancelado, Agendado)"),
    db=Depends(get_supabase),
):
    """Atualiza manualmente o status de um registro de férias."""
    status = status.strip()
    if status not in STATUS_VALIDOS:
        raise HTTPException(
            status_code=400,
            detail=f"Status inválido. Valores permitidos: {', '.join(sorted(STATUS_VALIDOS))}.",
        )
    try:
        response = db.table("gestao_ferias").update({"status": status}).eq("id", ferias_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Registro de férias não encontrado.")
        return {"success": True, "message": f"Status atualizado para '{status}' com sucesso.", "data": response.data[0]}
    except Exception:
        logger.exception("Erro ao atualizar status")
        raise HTTPException(status_code=500, detail="Erro ao atualizar status") from None


@router.delete("/{ferias_id}")
def excluir_ferias(ferias_id: int, db=Depends(get_supabase)):
    """Deleta permanentemente o agendamento de férias pelo ID."""
    try:
        response = db.table("gestao_ferias").delete().eq("id", ferias_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Registro de férias não encontrado.")
        return {"success": True, "message": "Registro de férias excluído."}
    except Exception:
        logger.exception("Erro ao excluir férias")
        raise HTTPException(status_code=500, detail="Erro ao excluir férias") from None


@router.get("/alertas")
def obter_alertas(db=Depends(get_supabase)):
    """Retorna alertas de prazos de gozo de férias próximos do limite."""
    try:
        response = (
            db.table("gestao_ferias")
            .select("nome, data_limite, status")
            .neq("status", "Cancelado")
            .neq("status", "Concluído")
            .neq("status", "Programado")
            .execute()
        )
        hoje = datetime.now().date()

        alertas = []
        for r in response.data:
            try:
                dt_limite = datetime.strptime(r["data_limite"], "%Y-%m-%d").date()
                dias_restantes = (dt_limite - hoje).days

                if 10 < dias_restantes <= 30:
                    alertas.append(
                        {
                            "nome": r["nome"],
                            "data_limite": dt_limite.strftime("%d/%m/%Y"),
                            "dias_restantes": dias_restantes,
                            "gravidade": "warning",
                            "mensagem": (
                                f"Faltam {dias_restantes} dias para o limite de gozo de {r['nome']} "
                                f"({dt_limite.strftime('%d/%m/%Y')})."
                            ),
                        }
                    )
                elif 0 <= dias_restantes <= 10:
                    alertas.append(
                        {
                            "nome": r["nome"],
                            "data_limite": dt_limite.strftime("%d/%m/%Y"),
                            "dias_restantes": dias_restantes,
                            "gravidade": "danger",
                            "mensagem": (
                                f"URGENTE: {r['nome']} precisa tirar férias até {dt_limite.strftime('%d/%m/%Y')}!"
                            ),
                        }
                    )
                elif dias_restantes < 0:
                    alertas.append(
                        {
                            "nome": r["nome"],
                            "data_limite": dt_limite.strftime("%d/%m/%Y"),
                            "dias_restantes": dias_restantes,
                            "gravidade": "expired",
                            "mensagem": (
                                f"ATENÇÃO: Prazo limite vencido para {r['nome']} em {dt_limite.strftime('%d/%m/%Y')}!"
                            ),
                        }
                    )
            except Exception:
                continue
        return alertas
    except Exception:
        logger.exception("Erro ao buscar alertas de férias")
        raise HTTPException(status_code=500, detail="Erro ao buscar alertas de férias") from None
