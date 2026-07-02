from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, Field
from datetime import datetime, date, timedelta
from typing import List, Optional
from supabase_client import get_supabase

router = APIRouter()

class FeriasCreate(BaseModel):
    nome: str = Field(..., description="Nome do colaborador")
    data_inicio: str = Field(..., description="Data de início no formato YYYY-MM-DD")
    dias_abono: int = Field(0, ge=0, le=10, description="Dias de abono pecuniário (máximo 10)")
    dias_gozo: Optional[int] = Field(None, ge=1, le=30, description="Dias de gozo (opcional - padrão: 30 - abono)")
    data_limite: Optional[str] = Field(None, description="Data limite para gozo no formato YYYY-MM-DD")
    departamento: Optional[str] = None
    saldo_anterior: Optional[int] = 0
    dias_utilizados: Optional[int] = 0
    motivo_cancelamento: Optional[str] = None

class FeriasResponse(BaseModel):
    id: int
    nome: str
    data_inicio: str
    dias_abono: int
    dias_gozo: int
    data_retorno: str
    data_limite: str
    departamento: Optional[str]
    saldo_anterior: Optional[int]
    dias_utilizados: Optional[int]
    motivo_cancelamento: Optional[str]
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
    if status_atual == "Cancelado":
        return "Cancelado"
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

@router.get("/", response_model=List[FeriasResponse])
def listar_ferias(
    busca: Optional[str] = Query(None, description="Nome do colaborador para buscar"),
    proximo_mes: Optional[bool] = Query(False, description="Filtrar apenas férias do próximo mês"),
    db = Depends(get_supabase)
):
    """Lista o histórico de férias. Permite busca por nome e filtro para férias no próximo mês."""
    try:
        query = db.table("gestao_ferias").select("*")
        
        if busca:
            query = query.ilike("nome", f"%{busca}%")
            
        if proximo_mes:
            hoje = datetime.now()
            primeiro_dia_prox_mes = (hoje.replace(day=1) + timedelta(days=32)).replace(day=1)
            ultimo_dia_prox_mes = (primeiro_dia_prox_mes + timedelta(days=32)).replace(day=1) - timedelta(days=1)
            
            query = query.gte("data_inicio", primeiro_dia_prox_mes.strftime("%Y-%m-%d"))
            query = query.lte("data_inicio", ultimo_dia_prox_mes.strftime("%Y-%m-%d"))
            
        response = query.order("data_inicio", desc=True).execute()
        
        # Atualiza status dinamicamente antes de retornar
        result = []
        for r in response.data:
            r["status"] = calculate_current_status(r["data_inicio"], r["data_retorno"], r["status"])
            result.append(r)
            
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao buscar férias: {str(e)}")

@router.post("/", response_model=FeriasResponse, status_code=201)
def agendar_ferias(ferias: FeriasCreate, db = Depends(get_supabase)):
    """Calcula prazos, valida conflitos e agenda férias de um colaborador."""
    try:
        # 1. Valida data de início
        try:
            dt_inicio = datetime.strptime(ferias.data_inicio, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Data de início com formato inválido. Use YYYY-MM-DD.")

        # 2. Calcula dias de gozo e retorno (dias corridos)
        if ferias.dias_gozo is not None:
            dias_gozo = ferias.dias_gozo
        else:
            dias_gozo = 30 - ferias.dias_abono
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
                raise HTTPException(status_code=400, detail="Data limite com formato inválido. Use YYYY-MM-DD.")

        # 4. Verifica conflitos de data para o mesmo colaborador
        conflitos = db.table("gestao_ferias").select("data_inicio, data_retorno").eq("nome", ferias.nome).neq("status", "Cancelado").execute()
        for c in conflitos.data:
            exist_start = datetime.strptime(c["data_inicio"], "%Y-%m-%d").date()
            exist_return = datetime.strptime(c["data_retorno"], "%Y-%m-%d").date()
            
            # Se sobrepõe
            if dt_inicio <= exist_return and dt_retorno >= exist_start:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Conflito com férias já agendadas para este colaborador no período: {exist_start.strftime('%d/%m/%Y')} a {exist_return.strftime('%d/%m/%Y')}."
                )

        # 5. Salva no banco de dados
        payload = ferias.model_dump()
        payload["dias_gozo"] = dias_gozo
        payload["data_retorno"] = data_retorno_str
        payload["data_limite"] = data_limite_str
        payload["status"] = "Agendado"

        response = db.table("gestao_ferias").insert(payload).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Erro ao salvar registro de férias.")

        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro interno ao agendar férias: {str(e)}")

@router.patch("/{ferias_id}/status")
def atualizar_status(ferias_id: int, status: str = Query(..., description="Novo status (ex: Gozadas, Cancelado, Agendado)"), db = Depends(get_supabase)):
    """Atualiza manualmente o status de um registro de férias."""
    try:
        response = db.table("gestao_ferias").update({"status": status}).eq("id", ferias_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Registro de férias não encontrado.")
        return {"success": True, "message": f"Status atualizado para '{status}' com sucesso.", "data": response.data[0]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar status: {str(e)}")

@router.delete("/{ferias_id}")
def excluir_ferias(ferias_id: int, db = Depends(get_supabase)):
    """Deleta permanentemente o agendamento de férias pelo ID."""
    try:
        response = db.table("gestao_ferias").delete().eq("id", ferias_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Registro de férias não encontrado.")
        return {"success": True, "message": "Registro de férias excluído."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao excluir férias: {str(e)}")

@router.get("/alertas")
def obter_alertas(db = Depends(get_supabase)):
    """Retorna alertas de prazos de gozo de férias próximos do limite."""
    try:
        response = db.table("gestao_ferias").select("nome, data_limite, status").neq("status", "Cancelado").neq("status", "Concluído").execute()
        hoje = datetime.now().date()
        
        alertas = []
        for r in response.data:
            try:
                dt_limite = datetime.strptime(r["data_limite"], "%Y-%m-%d").date()
                dias_restantes = (dt_limite - hoje).days
                
                if 10 < dias_restantes <= 30:
                    alertas.append({
                        "nome": r["nome"],
                        "data_limite": dt_limite.strftime("%d/%m/%Y"),
                        "dias_restantes": dias_restantes,
                        "gravidade": "warning",
                        "mensagem": f"Faltam {dias_restantes} dias para o limite de gozo de {r['nome']} ({dt_limite.strftime('%d/%m/%Y')})."
                    })
                elif 0 <= dias_restantes <= 10:
                    alertas.append({
                        "nome": r["nome"],
                        "data_limite": dt_limite.strftime("%d/%m/%Y"),
                        "dias_restantes": dias_restantes,
                        "gravidade": "danger",
                        "mensagem": f"URGENTE: {r['nome']} precisa tirar férias até {dt_limite.strftime('%d/%m/%Y')}!"
                    })
                elif dias_restantes < 0:
                    alertas.append({
                        "nome": r["nome"],
                        "data_limite": dt_limite.strftime("%d/%m/%Y"),
                        "dias_restantes": dias_restantes,
                        "gravidade": "expired",
                        "mensagem": f"ATENÇÃO: Prazo limite vencido para {r['nome']} em {dt_limite.strftime('%d/%m/%Y')}!"
                    })
            except Exception:
                continue
        return alertas
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao buscar alertas de férias: {str(e)}")
