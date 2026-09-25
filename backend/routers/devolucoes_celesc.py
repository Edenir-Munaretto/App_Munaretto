import logging
import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth import require_permisao
from supabase_client import get_supabase

router = APIRouter(dependencies=[Depends(require_permisao("devolucoes_celesc"))])

logger = logging.getLogger(__name__)

STATUS_VALIDOS = {"Aberto", "Fechado"}


class DevolucaoCreate(BaseModel):
    consumidor: str = Field(..., min_length=2, description="Nome do consumidor")
    nota_ps: str | None = None
    data_entrega: str | None = Field(None, description="Data de entrega no formato YYYY-MM-DD")
    data_devolucao: str | None = Field(None, description="Data de devolução no formato YYYY-MM-DD")


class DevolucaoUpdate(BaseModel):
    """Atualização parcial: apenas os campos enviados são alterados.

    Os dados chegam em etapas (cadastro, entrega e devolução), então o corpo
    pode conter só a data de entrega, só a de devolução, ou qualquer combinação.
    """

    consumidor: str | None = Field(None, min_length=2, description="Nome do consumidor")
    nota_ps: str | None = None
    data_entrega: str | None = Field(None, description="Data de entrega no formato YYYY-MM-DD")
    data_devolucao: str | None = Field(None, description="Data de devolução no formato YYYY-MM-DD")


class DevolucaoResponse(BaseModel):
    id: int
    consumidor: str
    nota_ps: str | None
    data_entrega: str | None
    data_devolucao: str | None
    status: str
    created_at: str | None = None


def calcular_status(data_devolucao: str | None) -> str:
    """Status derivado: sem data de devolução o registro fica Aberto; com data, Fechado."""
    return "Fechado" if data_devolucao else "Aberto"


def validar_datas(data_entrega: str | None, data_devolucao: str | None) -> None:
    """Valida o formato das datas informadas (quando houver) e impede devolução anterior à entrega."""
    entrega = None
    if data_entrega:
        try:
            entrega = date.fromisoformat(data_entrega)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Data de entrega inválida. Use o formato AAAA-MM-DD.") from None

    if not data_devolucao:
        return

    try:
        devolucao = date.fromisoformat(data_devolucao)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Data de devolução inválida. Use o formato AAAA-MM-DD.") from None

    if entrega is not None and devolucao < entrega:
        raise HTTPException(status_code=400, detail="A data de devolução não pode ser anterior à data de entrega.")


@router.get("/", response_model=list[DevolucaoResponse])
def listar_devolucoes(
    busca: str | None = Query(None, description="Termo de busca (consumidor ou Nota PS)"),
    status: str | None = Query(None, description="Filtrar por status: Aberto ou Fechado"),
    db=Depends(get_supabase),
):
    """Lista as devoluções ativas. Permite busca por consumidor/Nota PS e filtro por status."""
    try:
        query = db.table("devolucoes_celesc").select("*").eq("ativo", True)

        if busca:
            # Remove caracteres que o PostgREST interpreta como sintaxe de filtro
            termo = re.sub(r"[%_*,()=;<>]", "", busca)
            query = query.or_(f"consumidor.ilike.%{termo}%,nota_ps.ilike.%{termo}%")

        if status:
            valor = status.strip().capitalize()
            if valor not in STATUS_VALIDOS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Status inválido. Valores permitidos: {', '.join(sorted(STATUS_VALIDOS))}.",
                )
            if valor == "Fechado":
                query = query.not_.is_("data_devolucao", "null")
            else:
                query = query.is_("data_devolucao", "null")

        response = query.order("created_at", desc=True).order("id", desc=True).execute()

        # Status calculado em tempo de leitura (não é coluna do banco)
        result = []
        for r in response.data:
            r["status"] = calcular_status(r.get("data_devolucao"))
            result.append(r)

        return result
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao buscar devoluções Celesc")
        raise HTTPException(status_code=500, detail="Erro ao buscar devoluções Celesc") from None


@router.get("/{devolucao_id}", response_model=DevolucaoResponse)
def buscar_devolucao(devolucao_id: int, db=Depends(get_supabase)):
    """Busca os detalhes de uma devolução específica pelo ID."""
    try:
        response = db.table("devolucoes_celesc").select("*").eq("id", devolucao_id).eq("ativo", True).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Devolução não encontrada")
        registro = response.data[0]
        registro["status"] = calcular_status(registro.get("data_devolucao"))
        return registro
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao buscar devolução Celesc")
        raise HTTPException(status_code=500, detail="Erro ao buscar devolução Celesc") from None


@router.post("/", response_model=DevolucaoResponse, status_code=201)
def cadastrar_devolucao(devolucao: DevolucaoCreate, db=Depends(get_supabase)):
    """Cadastra uma nova devolução.

    Apenas consumidor é obrigatório: a entrega e a devolução podem ser
    preenchidas depois. Sem data de devolução o registro nasce Aberto.
    """
    try:
        data = devolucao.model_dump()
        data["consumidor"] = data["consumidor"].strip()
        data["nota_ps"] = (data["nota_ps"] or "").strip() or None
        data["data_entrega"] = data["data_entrega"] or None
        data["data_devolucao"] = data["data_devolucao"] or None
        data["ativo"] = True

        validar_datas(data["data_entrega"], data["data_devolucao"])

        response = db.table("devolucoes_celesc").insert(data).execute()

        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao criar devolução.")

        registro = response.data[0]
        registro["status"] = calcular_status(registro.get("data_devolucao"))
        return registro
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao cadastrar devolução Celesc")
        raise HTTPException(status_code=500, detail="Erro ao cadastrar devolução Celesc") from None


@router.put("/{devolucao_id}", response_model=DevolucaoResponse)
def atualizar_devolucao(devolucao_id: int, devolucao: DevolucaoUpdate, db=Depends(get_supabase)):
    """Atualiza parcialmente uma devolução existente.

    Somente os campos enviados são alterados, permitindo registrar o cadastro,
    a entrega e a devolução em momentos diferentes. Preencher a data de
    devolução fecha o registro; enviá-la como null reabre.
    """
    try:
        check = db.table("devolucoes_celesc").select("*").eq("id", devolucao_id).eq("ativo", True).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Devolução não encontrada")

        atual = check.data[0]
        data = devolucao.model_dump(exclude_unset=True)

        if not data:
            raise HTTPException(status_code=400, detail="Nenhum campo para atualizar foi informado.")

        if "consumidor" in data:
            if not (data["consumidor"] or "").strip():
                raise HTTPException(status_code=400, detail="O consumidor não pode ficar em branco.")
            data["consumidor"] = data["consumidor"].strip()
        if "nota_ps" in data:
            data["nota_ps"] = (data["nota_ps"] or "").strip() or None
        if "data_entrega" in data:
            data["data_entrega"] = data["data_entrega"] or None
        if "data_devolucao" in data:
            data["data_devolucao"] = data["data_devolucao"] or None

        # Valida as datas efetivas (o que foi enviado + o que já estava salvo)
        validar_datas(
            data.get("data_entrega", atual.get("data_entrega")),
            data.get("data_devolucao", atual.get("data_devolucao")),
        )

        response = db.table("devolucoes_celesc").update(data).eq("id", devolucao_id).execute()

        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar devolução.")

        registro = response.data[0]
        registro["status"] = calcular_status(registro.get("data_devolucao"))
        return registro
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao atualizar devolução Celesc")
        raise HTTPException(status_code=500, detail="Erro ao atualizar devolução Celesc") from None


@router.delete("/{devolucao_id}")
def excluir_devolucao(devolucao_id: int, db=Depends(get_supabase)):
    """Realiza exclusão lógica (soft delete) da devolução, marcando 'ativo' como falso."""
    try:
        check = db.table("devolucoes_celesc").select("id").eq("id", devolucao_id).eq("ativo", True).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Devolução não encontrada")

        db.table("devolucoes_celesc").update({"ativo": False}).eq("id", devolucao_id).execute()
        return {"success": True, "message": "Devolução excluída com sucesso."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao excluir devolução Celesc")
        raise HTTPException(status_code=500, detail="Erro ao excluir devolução Celesc") from None
