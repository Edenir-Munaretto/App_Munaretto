"""Módulo de Manutenção.

Controle da frota de veículos: cadastro (modelo e placa), acompanhamento
individual de manutenções (o que foi feito, data e oficina) e checklist de
equipamentos por veículo (macaco, estepe, triângulo, etc.).
"""
import logging
import re
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, Field

from supabase_client import get_supabase
from auth import require_permisao

router = APIRouter(dependencies=[Depends(require_permisao("manutencao"))])

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class VeiculoCreate(BaseModel):
    modelo: str = Field(..., min_length=2, description="Modelo do veículo")
    placa: str = Field(..., min_length=3, description="Placa do veículo")
    observacao: Optional[str] = None


class VeiculoResponse(VeiculoCreate):
    id: int
    ativo: bool = True
    created_at: Optional[str] = None


class ManutencaoCreate(BaseModel):
    veiculo_id: int
    tipo: str = Field(..., min_length=2, description="Tipo de serviço (Manutenção, Troca de pneus...)")
    descricao: Optional[str] = None
    data_servico: str = Field(..., description="Data em que o serviço foi realizado (YYYY-MM-DD)")
    oficina: Optional[str] = None
    valor: Optional[float] = 0.0
    km_odometro: Optional[int] = None
    observacao: Optional[str] = None


class ManutencaoResponse(ManutencaoCreate):
    id: int
    created_at: Optional[str] = None


class EquipamentoCreate(BaseModel):
    veiculo_id: int
    equipamento: str = Field(..., min_length=1, description="Nome do equipamento")
    quantidade: Optional[int] = 1
    observacao: Optional[str] = None


class EquipamentoResponse(EquipamentoCreate):
    id: int
    created_at: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _normalizar_placa(placa: str) -> str:
    """Remove máscara e normaliza a placa em maiúsculas (ex.: 'abc-1d23' -> 'ABC1D23')."""
    return re.sub(r"[^A-Za-z0-9]", "", placa).upper()


def _veiculo_existe(db, veiculo_id: int) -> bool:
    resp = db.table("veiculos").select("id").eq("id", veiculo_id).eq("ativo", True).execute()
    return bool(resp.data)


def _placa_duplicada(db, placa: str, ignorar_id: Optional[int] = None) -> bool:
    placa_norm = _normalizar_placa(placa)
    resp = db.table("veiculos").select("id", "placa").eq("ativo", True).execute()
    for v in resp.data:
        if v["id"] == ignorar_id:
            continue
        if _normalizar_placa(v.get("placa", "")) == placa_norm:
            return True
    return False


# ---------------------------------------------------------------------------
# Veículos
# ---------------------------------------------------------------------------
@router.get("/veiculos", response_model=List[VeiculoResponse])
def listar_veiculos(
    busca: Optional[str] = Query(None, description="Termo de busca (modelo ou placa)"),
    db=Depends(get_supabase),
):
    """Lista os veículos ativos. Filtra por modelo ou placa se houver busca."""
    try:
        dados = db.table("veiculos").select("*").eq("ativo", True).execute().data
        if busca:
            termo = busca.strip().lower()
            dados = [
                v for v in dados
                if termo in str(v.get("modelo", "")).lower()
                or termo in str(v.get("placa", "")).lower()
            ]
        dados.sort(key=lambda v: str(v.get("modelo", "")).lower())
        return dados
    except Exception:
        logger.exception("Erro ao listar veículos")
        raise HTTPException(status_code=500, detail="Erro ao listar veículos")


@router.get("/veiculos/{veiculo_id}", response_model=VeiculoResponse)
def buscar_veiculo(veiculo_id: int, db=Depends(get_supabase)):
    """Busca os detalhes de um veículo específico pelo ID."""
    try:
        resp = db.table("veiculos").select("*").eq("id", veiculo_id).execute()
        if not resp.data:
            raise HTTPException(status_code=404, detail="Veículo não encontrado")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao buscar veículo")
        raise HTTPException(status_code=500, detail="Erro ao buscar veículo")


@router.post("/veiculos", response_model=VeiculoResponse, status_code=201)
def cadastrar_veiculo(veiculo: VeiculoCreate, db=Depends(get_supabase)):
    """Cadastra um novo veículo. Retorna erro se a placa já existir."""
    try:
        if _placa_duplicada(db, veiculo.placa):
            raise HTTPException(status_code=400, detail="Esta placa já está cadastrada para um veículo ativo.")

        data = veiculo.model_dump()
        data["placa"] = _normalizar_placa(veiculo.placa)
        data["ativo"] = True

        # Reativa um veículo excluído (soft delete) com a mesma placa em vez de
        # inserir duplicado, pois a coluna `placa` tem constraint UNIQUE no banco.
        inativo = db.table("veiculos").select("id").eq("placa", data["placa"]).eq("ativo", False).execute()
        if inativo.data:
            vid = inativo.data[0]["id"]
            resp = db.table("veiculos").update(data).eq("id", vid).execute()
            if not resp.data:
                raise HTTPException(status_code=500, detail="Falha ao criar veículo.")
            return resp.data[0]

        resp = db.table("veiculos").insert(data).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao criar veículo.")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao cadastrar veículo")
        raise HTTPException(status_code=500, detail="Erro ao cadastrar veículo")


@router.put("/veiculos/{veiculo_id}", response_model=VeiculoResponse)
def atualizar_veiculo(veiculo_id: int, veiculo: VeiculoCreate, db=Depends(get_supabase)):
    """Atualiza as informações de um veículo existente."""
    try:
        check = db.table("veiculos").select("id").eq("id", veiculo_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Veículo não encontrado")

        if _placa_duplicada(db, veiculo.placa, ignorar_id=veiculo_id):
            raise HTTPException(status_code=400, detail="Esta placa já está cadastrada para outro veículo ativo.")

        data = veiculo.model_dump()
        data["placa"] = _normalizar_placa(veiculo.placa)
        resp = db.table("veiculos").update(data).eq("id", veiculo_id).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar veículo.")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao atualizar veículo")
        raise HTTPException(status_code=500, detail="Erro ao atualizar veículo")


@router.delete("/veiculos/{veiculo_id}")
def excluir_veiculo(veiculo_id: int, db=Depends(get_supabase)):
    """Realiza exclusão lógica (soft delete) do veículo, marcando 'ativo' como falso."""
    try:
        check = db.table("veiculos").select("id").eq("id", veiculo_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Veículo não encontrado")

        db.table("veiculos").update({"ativo": False}).eq("id", veiculo_id).execute()
        return {"success": True, "message": "Veículo excluído com sucesso."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao excluir veículo")
        raise HTTPException(status_code=500, detail="Erro ao excluir veículo")


# ---------------------------------------------------------------------------
# Manutenções
# ---------------------------------------------------------------------------
@router.get("/veiculos/{veiculo_id}/manutencoes", response_model=List[ManutencaoResponse])
def listar_manutencoes(veiculo_id: int, db=Depends(get_supabase)):
    """Lista o histórico de manutenções de um veículo (mais recentes primeiro)."""
    try:
        if not _veiculo_existe(db, veiculo_id):
            raise HTTPException(status_code=404, detail="Veículo não encontrado")
        dados = db.table("manutencoes").select("*").eq("veiculo_id", veiculo_id).execute().data
        dados.sort(key=lambda m: str(m.get("data_servico", "")), reverse=True)
        return dados
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao listar manutenções")
        raise HTTPException(status_code=500, detail="Erro ao listar manutenções")


@router.post("/manutencoes", response_model=ManutencaoResponse, status_code=201)
def cadastrar_manutencao(manut: ManutencaoCreate, db=Depends(get_supabase)):
    """Registra uma manutenção em um veículo."""
    try:
        if not _veiculo_existe(db, manut.veiculo_id):
            raise HTTPException(status_code=404, detail="Veículo não encontrado")
        data = manut.model_dump()
        resp = db.table("manutencoes").insert(data).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao registrar manutenção.")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao registrar manutenção")
        raise HTTPException(status_code=500, detail="Erro ao registrar manutenção")


@router.put("/manutencoes/{registro_id}", response_model=ManutencaoResponse)
def atualizar_manutencao(registro_id: int, manut: ManutencaoCreate, db=Depends(get_supabase)):
    """Atualiza uma manutenção existente."""
    try:
        check = db.table("manutencoes").select("id").eq("id", registro_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Manutenção não encontrada")
        if not _veiculo_existe(db, manut.veiculo_id):
            raise HTTPException(status_code=404, detail="Veículo não encontrado")

        data = manut.model_dump()
        resp = db.table("manutencoes").update(data).eq("id", registro_id).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar manutenção.")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao atualizar manutenção")
        raise HTTPException(status_code=500, detail="Erro ao atualizar manutenção")


@router.delete("/manutencoes/{registro_id}")
def excluir_manutencao(registro_id: int, db=Depends(get_supabase)):
    """Exclui uma manutenção."""
    try:
        check = db.table("manutencoes").select("id").eq("id", registro_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Manutenção não encontrada")
        db.table("manutencoes").delete().eq("id", registro_id).execute()
        return {"success": True, "message": "Manutenção excluída com sucesso."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao excluir manutenção")
        raise HTTPException(status_code=500, detail="Erro ao excluir manutenção")


# ---------------------------------------------------------------------------
# Equipamentos (checklist por veículo)
# ---------------------------------------------------------------------------
@router.get("/veiculos/{veiculo_id}/equipamentos", response_model=List[EquipamentoResponse])
def listar_equipamentos(veiculo_id: int, db=Depends(get_supabase)):
    """Lista os equipamentos/checklist de um veículo."""
    try:
        if not _veiculo_existe(db, veiculo_id):
            raise HTTPException(status_code=404, detail="Veículo não encontrado")
        dados = db.table("veiculo_equipamentos").select("*").eq("veiculo_id", veiculo_id).execute().data
        dados.sort(key=lambda e: str(e.get("equipamento", "")).lower())
        return dados
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao listar equipamentos")
        raise HTTPException(status_code=500, detail="Erro ao listar equipamentos")


@router.post("/equipamentos", response_model=EquipamentoResponse, status_code=201)
def cadastrar_equipamento(equip: EquipamentoCreate, db=Depends(get_supabase)):
    """Vincula um equipamento a um veículo."""
    try:
        if not _veiculo_existe(db, equip.veiculo_id):
            raise HTTPException(status_code=404, detail="Veículo não encontrado")
        data = equip.model_dump()
        resp = db.table("veiculo_equipamentos").insert(data).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao cadastrar equipamento.")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao cadastrar equipamento")
        raise HTTPException(status_code=500, detail="Erro ao cadastrar equipamento")


@router.put("/equipamentos/{registro_id}", response_model=EquipamentoResponse)
def atualizar_equipamento(registro_id: int, equip: EquipamentoCreate, db=Depends(get_supabase)):
    """Atualiza um equipamento de um veículo."""
    try:
        check = db.table("veiculo_equipamentos").select("id").eq("id", registro_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Equipamento não encontrado")
        if not _veiculo_existe(db, equip.veiculo_id):
            raise HTTPException(status_code=404, detail="Veículo não encontrado")

        data = equip.model_dump()
        resp = db.table("veiculo_equipamentos").update(data).eq("id", registro_id).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar equipamento.")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao atualizar equipamento")
        raise HTTPException(status_code=500, detail="Erro ao atualizar equipamento")


@router.delete("/equipamentos/{registro_id}")
def excluir_equipamento(registro_id: int, db=Depends(get_supabase)):
    """Exclui um equipamento do veículo."""
    try:
        check = db.table("veiculo_equipamentos").select("id").eq("id", registro_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Equipamento não encontrado")
        db.table("veiculo_equipamentos").delete().eq("id", registro_id).execute()
        return {"success": True, "message": "Equipamento excluído com sucesso."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao excluir equipamento")
        raise HTTPException(status_code=500, detail="Erro ao excluir equipamento")