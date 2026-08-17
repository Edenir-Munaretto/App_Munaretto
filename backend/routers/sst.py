"""Módulo de Segurança do Trabalho (SST).

Gerencia compliance das NRs: matriz de treinamentos por cargo, controle de
vencimentos de cursos, ASO (NR-7) e Ficha de EPI digital (NR-6).

Regras de vencimento consideradas:
  - Vigente: faltam mais de DIAS_AVISO para a validade.
  - Próximo ao Vencimento: faltam até DIAS_AVISO.
  - Vencido: a validade já passou.
"""
import logging
import os
import tempfile
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from supabase_client import get_supabase
from auth import require_permisao
from utils.date_helpers import (
    hoje as _hoje,
    parse_data as _parse_data,
    status_vencimento as _status_vencimento,
    STATUS_VIGENTE,
    STATUS_PROXIMO,
    STATUS_VENCIDO,
    STATUS_SEM_VALIDADE,
)

router = APIRouter(dependencies=[Depends(require_permisao("sst"))])

logger = logging.getLogger(__name__)

DIAS_AVISO = 30

STATUS_ASO_VALIDOS = {
    "admissional",
    "periodico",
    "retorno_trabalho",
    "mudanca_funcao",
    "demissional",
}
RESULTADO_ASO_VALIDOS = {"apto", "apto_com_restricao", "inapto"}

# ---------------------------------------------------------------------------
# Helpers (status de vencimento importados de utils.date_helpers)
# ---------------------------------------------------------------------------

def _status_ca(ca_validade) -> str:
    """Classifica a situação do Certificado de Aprovação (CA) de um EPI."""
    d = _parse_data(ca_validade)
    if d is None:
        return "Não informado"
    return "Válido" if d >= _hoje() else "CA Vencido"


def _somar_meses(data_base: str, meses: Optional[int]) -> Optional[str]:
    """Soma meses a uma data e retorna no formato YYYY-MM-DD."""
    if not meses or not data_base:
        return None
    dt = _parse_data(data_base)
    if dt is None:
        return None
    indice_mes = dt.month - 1 + int(meses)
    ano = dt.year + indice_mes // 12
    mes = indice_mes % 12 + 1
    dias_por_mes = [
        31, 29 if (ano % 4 == 0 and (ano % 100 != 0 or ano % 400 == 0)) else 28,
        31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ]
    dia = min(dt.day, dias_por_mes[mes - 1])
    return date(ano, mes, dia).isoformat()


def _contar_status(registros: list) -> dict:
    """Conta registros por status de vencimento."""
    resumo = {
        STATUS_VIGENTE: 0,
        STATUS_PROXIMO: 0,
        STATUS_VENCIDO: 0,
        STATUS_SEM_VALIDADE: 0,
    }
    for r in registros:
        status = r.get("status") or STATUS_SEM_VALIDADE
        if status in resumo:
            resumo[status] += 1
    return resumo


def _registro_vencimento(mensagem: str, gravidade: str) -> dict:
    return {"mensagem": mensagem, "gravidade": gravidade}


# ---------------------------------------------------------------------------
# Cargos
# ---------------------------------------------------------------------------
class CargoBase(BaseModel):
    nome: str = Field(..., min_length=2, description="Nome do cargo/função")
    descricao: Optional[str] = None


class CargoResponse(CargoBase):
    id: int
    ativo: bool = True
    created_at: Optional[str] = None


@router.get("/cargos", response_model=List[CargoResponse])
def listar_cargos(db=Depends(get_supabase)):
    """Lista os cargos/funções ativos."""
    try:
        dados = db.table("cargos").select("*").eq("ativo", True).order("nome").execute().data
        return dados
    except Exception as e:
        logger.exception("Erro ao listar cargos")
        raise HTTPException(status_code=500, detail="Erro ao listar cargos")


@router.post("/cargos", response_model=CargoResponse, status_code=201)
def cadastrar_cargo(cargo: CargoBase, db=Depends(get_supabase)):
    """Cadastra um novo cargo/função."""
    try:
        dup = db.table("cargos").select("id").eq("nome", cargo.nome).execute()
        if dup.data:
            raise HTTPException(status_code=400, detail="Já existe um cargo com este nome.")
        response = db.table("cargos").insert({**cargo.model_dump(), "ativo": True}).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao cadastrar cargo.")
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao cadastrar cargo")
        raise HTTPException(status_code=500, detail="Erro ao cadastrar cargo")


@router.put("/cargos/{cargo_id}", response_model=CargoResponse)
def atualizar_cargo(cargo_id: int, cargo: CargoBase, db=Depends(get_supabase)):
    """Atualiza um cargo existente."""
    try:
        check = db.table("cargos").select("id").eq("id", cargo_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Cargo não encontrado.")
        dup = db.table("cargos").select("id").eq("nome", cargo.nome).neq("id", cargo_id).execute()
        if dup.data:
            raise HTTPException(status_code=400, detail="Já existe outro cargo com este nome.")
        response = db.table("cargos").update({**cargo.model_dump(), "ativo": True}).eq("id", cargo_id).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar cargo.")
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao atualizar cargo")
        raise HTTPException(status_code=500, detail="Erro ao atualizar cargo")


@router.delete("/cargos/{cargo_id}")
def excluir_cargo(cargo_id: int, db=Depends(get_supabase)):
    """Exclusão lógica (soft delete) do cargo."""
    try:
        check = db.table("cargos").select("id").eq("id", cargo_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Cargo não encontrado.")
        db.table("cargos").update({"ativo": False}).eq("id", cargo_id).execute()
        return {"success": True, "message": "Cargo excluído com sucesso."}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao excluir cargo")
        raise HTTPException(status_code=500, detail="Erro ao excluir cargo")


# ---------------------------------------------------------------------------
# Treinamentos (catálogo de cursos obrigatórios)
# ---------------------------------------------------------------------------
class TreinamentoBase(BaseModel):
    nome: str = Field(..., min_length=2, description="Nome do curso (ex: NR-10 Básico)")
    norma: Optional[str] = Field(None, description="Norma regulamentadora (ex: NR-10)")
    tipo: Optional[str] = Field(None, description="Tipo (ex: Inicial, Reciclagem)")
    validade_meses: Optional[int] = Field(None, ge=1, description="Periodicidade de reciclagem em meses")
    carga_horaria: Optional[int] = Field(None, ge=0, description="Carga horária em horas")
    instituicao: Optional[str] = None
    ativo: bool = True


class TreinamentoResponse(TreinamentoBase):
    id: int
    created_at: Optional[str] = None


@router.get("/treinamentos", response_model=List[TreinamentoResponse])
def listar_treinamentos(
    incluir_inativos: Optional[bool] = Query(False),
    db=Depends(get_supabase),
):
    """Lista o catálogo de treinamentos. Por padrão retorna apenas ativos."""
    try:
        query = db.table("treinamentos").select("*")
        if not incluir_inativos:
            query = query.eq("ativo", True)
        return query.order("nome").execute().data
    except Exception as e:
        logger.exception("Erro ao listar treinamentos")
        raise HTTPException(status_code=500, detail="Erro ao listar treinamentos")


@router.post("/treinamentos", response_model=TreinamentoResponse, status_code=201)
def cadastrar_treinamento(treinamento: TreinamentoBase, db=Depends(get_supabase)):
    """Cadastra um curso no catálogo de treinamentos."""
    try:
        response = db.table("treinamentos").insert(treinamento.model_dump()).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao cadastrar treinamento.")
        return response.data[0]
    except Exception as e:
        logger.exception("Erro ao cadastrar treinamento")
        raise HTTPException(status_code=500, detail="Erro ao cadastrar treinamento")


@router.put("/treinamentos/{treinamento_id}", response_model=TreinamentoResponse)
def atualizar_treinamento(treinamento_id: int, treinamento: TreinamentoBase, db=Depends(get_supabase)):
    """Atualiza um curso do catálogo."""
    try:
        check = db.table("treinamentos").select("id").eq("id", treinamento_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Treinamento não encontrado.")
        response = db.table("treinamentos").update(treinamento.model_dump()).eq("id", treinamento_id).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar treinamento.")
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao atualizar treinamento")
        raise HTTPException(status_code=500, detail="Erro ao atualizar treinamento")


@router.delete("/treinamentos/{treinamento_id}")
def excluir_treinamento(treinamento_id: int, db=Depends(get_supabase)):
    """Exclusão lógica (soft delete) do treinamento."""
    try:
        check = db.table("treinamentos").select("id").eq("id", treinamento_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Treinamento não encontrado.")
        db.table("treinamentos").update({"ativo": False}).eq("id", treinamento_id).execute()
        return {"success": True, "message": "Treinamento excluído com sucesso."}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao excluir treinamento")
        raise HTTPException(status_code=500, detail="Erro ao excluir treinamento")


# ---------------------------------------------------------------------------
# Matriz de treinamentos (cargo x curso obrigatório)
# ---------------------------------------------------------------------------
class MatrizCreate(BaseModel):
    cargo_id: int = Field(..., description="ID do cargo")
    treinamento_id: int = Field(..., description="ID do treinamento")


class MatrizResponse(BaseModel):
    id: int
    cargo_id: int
    cargo_nome: str
    treinamento_id: int
    treinamento_nome: str
    norma: Optional[str]
    tipo: Optional[str]
    validade_meses: Optional[int]


@router.get("/matriz", response_model=List[MatrizResponse])
def listar_matriz(
    cargo_id: Optional[int] = Query(None, description="Filtra por cargo"),
    db=Depends(get_supabase),
):
    """Lista a matriz de treinamentos vinculada aos cargos."""
    try:
        cargos = db.table("cargos").select("*").eq("ativo", True).execute().data
        treinamentos = db.table("treinamentos").select("*").eq("ativo", True).execute().data
        query = db.table("matriz_treinamentos").select("*")
        if cargo_id:
            query = query.eq("cargo_id", cargo_id)
        linhas = query.execute().data

        cargo_map = {c["id"]: c for c in cargos}
        treino_map = {t["id"]: t for t in treinamentos}
        resultado = []
        for m in linhas:
            c = cargo_map.get(m["cargo_id"])
            t = treino_map.get(m["treinamento_id"])
            if not c or not t:
                continue
            resultado.append({
                "id": m["id"],
                "cargo_id": m["cargo_id"],
                "cargo_nome": c["nome"],
                "treinamento_id": m["treinamento_id"],
                "treinamento_nome": t["nome"],
                "norma": t.get("norma"),
                "tipo": t.get("tipo"),
                "validade_meses": t.get("validade_meses"),
            })
        return resultado
    except Exception as e:
        logger.exception("Erro ao listar matriz de treinamentos")
        raise HTTPException(status_code=500, detail="Erro ao listar matriz de treinamentos")


@router.post("/matriz", response_model=MatrizResponse, status_code=201)
def vincular_treinamento(matriz: MatrizCreate, db=Depends(get_supabase)):
    """Vincula um treinamento obrigatório a um cargo."""
    try:
        cargo = db.table("cargos").select("*").eq("id", matriz.cargo_id).eq("ativo", True).execute()
        treinamento = db.table("treinamentos").select("*").eq("id", matriz.treinamento_id).eq("ativo", True).execute()
        if not cargo.data:
            raise HTTPException(status_code=404, detail="Cargo não encontrado.")
        if not treinamento.data:
            raise HTTPException(status_code=404, detail="Treinamento não encontrado.")

        dup = db.table("matriz_treinamentos").select("id").eq("cargo_id", matriz.cargo_id).eq("treinamento_id", matriz.treinamento_id).execute()
        if dup.data:
            raise HTTPException(status_code=400, detail="Este treinamento já está vinculado ao cargo.")

        response = db.table("matriz_treinamentos").insert(matriz.model_dump()).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao vincular treinamento.")
        m = response.data[0]
        return {
            "id": m["id"],
            "cargo_id": m["cargo_id"],
            "cargo_nome": cargo.data[0]["nome"],
            "treinamento_id": m["treinamento_id"],
            "treinamento_nome": treinamento.data[0]["nome"],
            "norma": treinamento.data[0].get("norma"),
            "tipo": treinamento.data[0].get("tipo"),
            "validade_meses": treinamento.data[0].get("validade_meses"),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao vincular treinamento ao cargo")
        raise HTTPException(status_code=500, detail="Erro ao vincular treinamento ao cargo")


@router.delete("/matriz/{vinculo_id}")
def desvincular_treinamento(vinculo_id: int, db=Depends(get_supabase)):
    """Remove o vínculo cargo x treinamento."""
    try:
        response = db.table("matriz_treinamentos").delete().eq("id", vinculo_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Vínculo não encontrado.")
        return {"success": True, "message": "Treinamento desvinculado do cargo."}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao desvincular treinamento")
        raise HTTPException(status_code=500, detail="Erro ao desvincular treinamento")


# ---------------------------------------------------------------------------
# Funcionário x Treinamento (controle de vencimentos)
# ---------------------------------------------------------------------------
class FuncTreinamentoBase(BaseModel):
    funcionario_id: int = Field(..., description="ID do funcionário")
    treinamento_id: int = Field(..., description="ID do treinamento")
    data_realizacao: str = Field(..., description="Data de realização (YYYY-MM-DD)")
    data_validade: Optional[str] = Field(None, description="Validade (calculada automaticamente se ausente)")
    carga_horaria: Optional[int] = Field(None, ge=0)
    certificado_url: Optional[str] = None
    observacao: Optional[str] = None


class FuncTreinamentoResponse(FuncTreinamentoBase):
    id: int
    funcionario_nome: str
    treinamento_nome: str
    norma: Optional[str]
    status: str
    tem_certificado: bool = False
    certificado_nome: Optional[str] = None
    created_at: Optional[str] = None


@router.get("/funcionario-treinamentos", response_model=List[FuncTreinamentoResponse])
def listar_funcionario_treinamentos(
    busca: Optional[str] = Query(None, description="Filtra por nome do funcionário ou curso"),
    status: Optional[str] = Query(None, description="Filtra por status de vencimento"),
    db=Depends(get_supabase),
):
    """Lista os treinamentos realizados pelos funcionários com status de vencimento."""
    try:
        linhas = db.table("funcionario_treinamentos").select("*").order("funcionario_nome").execute().data
        certs = db.table("certificados").select("registro_id", "nome_original").eq("tipo_registro", "treinamento").execute().data
        cert_map = {c["registro_id"]: c for c in certs}
        resultado = []
        for r in linhas:
            r["status"] = _status_vencimento(r.get("data_validade"))
            cert = cert_map.get(r.get("id"))
            r["tem_certificado"] = cert is not None
            r["certificado_nome"] = cert.get("nome_original") if cert else None
            if status and r["status"] != status:
                continue
            if busca:
                termo = busca.lower()
                nome_func = str(r.get("funcionario_nome", "")).lower()
                nome_curso = str(r.get("treinamento_nome", "")).lower()
                if termo not in nome_func and termo not in nome_curso:
                    continue
            resultado.append(r)
        return resultado
    except Exception as e:
        logger.exception("Erro ao listar treinamentos dos funcionários")
        raise HTTPException(status_code=500, detail="Erro ao listar treinamentos dos funcionários")


@router.post("/funcionario-treinamentos", response_model=FuncTreinamentoResponse, status_code=201)
def cadastrar_funcionario_treinamento(item: FuncTreinamentoBase, db=Depends(get_supabase)):
    """Registra um treinamento realizado por um funcionário.

    Se a data de validade não for informada, ela é calculada a partir da
    periodicidade (validade_meses) cadastrada no treinamento.
    """
    try:
        func = db.table("funcionarios").select("*").eq("id", item.funcionario_id).eq("ativo", True).execute()
        treino = db.table("treinamentos").select("*").eq("id", item.treinamento_id).eq("ativo", True).execute()
        if not func.data:
            raise HTTPException(status_code=404, detail="Funcionário não encontrado.")
        if not treino.data:
            raise HTTPException(status_code=404, detail="Treinamento não encontrado.")

        if _parse_data(item.data_realizacao) is None:
            raise HTTPException(status_code=400, detail="Data de realização inválida. Use YYYY-MM-DD.")

        data_validade = item.data_validade
        if not data_validade:
            data_validade = _somar_meses(item.data_realizacao, treino.data[0].get("validade_meses"))

        payload = item.model_dump()
        payload["data_validade"] = data_validade
        payload["funcionario_nome"] = func.data[0]["nome"]
        payload["treinamento_nome"] = treino.data[0]["nome"]
        payload["norma"] = treino.data[0].get("norma")

        response = db.table("funcionario_treinamentos").insert(payload).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao registrar treinamento.")
        registro = response.data[0]
        registro["status"] = _status_vencimento(registro.get("data_validade"))
        return registro
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao registrar treinamento do funcionário")
        raise HTTPException(status_code=500, detail="Erro ao registrar treinamento do funcionário")


@router.put("/funcionario-treinamentos/{registro_id}", response_model=FuncTreinamentoResponse)
def atualizar_funcionario_treinamento(registro_id: int, item: FuncTreinamentoBase, db=Depends(get_supabase)):
    """Atualiza um registro de treinamento realizado."""
    try:
        check = db.table("funcionario_treinamentos").select("id").eq("id", registro_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Registro de treinamento não encontrado.")
        if _parse_data(item.data_realizacao) is None:
            raise HTTPException(status_code=400, detail="Data de realização inválida. Use YYYY-MM-DD.")

        func = db.table("funcionarios").select("*").eq("id", item.funcionario_id).eq("ativo", True).execute()
        treino = db.table("treinamentos").select("*").eq("id", item.treinamento_id).eq("ativo", True).execute()
        if not func.data:
            raise HTTPException(status_code=404, detail="Funcionário não encontrado.")
        if not treino.data:
            raise HTTPException(status_code=404, detail="Treinamento não encontrado.")

        payload = item.model_dump()
        if not payload.get("data_validade"):
            payload["data_validade"] = _somar_meses(item.data_realizacao, treino.data[0].get("validade_meses"))
        payload["funcionario_nome"] = func.data[0]["nome"]
        payload["treinamento_nome"] = treino.data[0]["nome"]
        payload["norma"] = treino.data[0].get("norma")

        response = db.table("funcionario_treinamentos").update(payload).eq("id", registro_id).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar registro.")
        registro = response.data[0]
        registro["status"] = _status_vencimento(registro.get("data_validade"))
        return registro
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao atualizar treinamento do funcionário")
        raise HTTPException(status_code=500, detail="Erro ao atualizar treinamento do funcionário")


@router.delete("/funcionario-treinamentos/{registro_id}")
def excluir_funcionario_treinamento(registro_id: int, db=Depends(get_supabase)):
    """Exclui um registro de treinamento realizado.

    Se houver certificado anexado, o arquivo no B2 também é removido para não
    deixar objeto órfão no bucket.
    """
    try:
        cert = db.table("certificados").select("bucket_key").eq("tipo_registro", "treinamento").eq("registro_id", registro_id).execute()
        response = db.table("funcionario_treinamentos").delete().eq("id", registro_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Registro de treinamento não encontrado.")
        if cert.data:
            try:
                from storage import bucket as b2_bucket, get_s3_client
                get_s3_client().delete_object(Bucket=b2_bucket(), Key=cert.data[0]["bucket_key"])
            except Exception:
                logger.warning("Não foi possível remover o certificado do B2 (registro %s)", registro_id)
            db.table("certificados").delete().eq("tipo_registro", "treinamento").eq("registro_id", registro_id).execute()
        return {"success": True, "message": "Registro de treinamento excluído."}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao excluir registro de treinamento")
        raise HTTPException(status_code=500, detail="Erro ao excluir registro de treinamento")


# ---------------------------------------------------------------------------
# ASO (Atestado de Saúde Ocupacional - NR-7)
# ---------------------------------------------------------------------------
class AsoBase(BaseModel):
    funcionario_id: int = Field(..., description="ID do funcionário")
    tipo_exame: str = Field(..., description="Tipo de exame (admissional, periodico, etc.)")
    data_exame: str = Field(..., description="Data do exame (YYYY-MM-DD)")
    data_validade: Optional[str] = Field(None, description="Validade (periódicos)")
    validade_meses: Optional[int] = Field(None, ge=1, description="Periodicidade em meses para periódicos")
    medico_responsavel: Optional[str] = None
    clinica: Optional[str] = None
    resultado: Optional[str] = Field(None, description="apto, apto_com_restricao ou inapto")
    observacao: Optional[str] = None


class AsoResponse(AsoBase):
    id: int
    funcionario_nome: str
    status: str
    tem_documento: bool = False
    documento_nome: Optional[str] = None
    created_at: Optional[str] = None


@router.get("/aso", response_model=List[AsoResponse])
def listar_asos(
    busca: Optional[str] = Query(None, description="Filtra por nome do funcionário"),
    status: Optional[str] = Query(None, description="Filtra por status de vencimento"),
    tipo: Optional[str] = Query(None, description="Filtra por tipo de exame"),
    db=Depends(get_supabase),
):
    """Lista os ASOs com status de vencimento."""
    try:
        linhas = db.table("aso").select("*").order("funcionario_nome").execute().data
        certs = db.table("certificados").select("registro_id", "nome_original").eq("tipo_registro", "aso").execute().data
        cert_map = {c["registro_id"]: c for c in certs}
        resultado = []
        for r in linhas:
            r["status"] = _status_vencimento(r.get("data_validade"))
            cert = cert_map.get(r.get("id"))
            r["tem_documento"] = cert is not None
            r["documento_nome"] = cert.get("nome_original") if cert else None
            if status and r["status"] != status:
                continue
            if tipo and r.get("tipo_exame") != tipo:
                continue
            if busca:
                termo = busca.lower()
                if termo not in str(r.get("funcionario_nome", "")).lower():
                    continue
            resultado.append(r)
        return resultado
    except Exception as e:
        logger.exception("Erro ao listar ASOs")
        raise HTTPException(status_code=500, detail="Erro ao listar ASOs")


@router.post("/aso", response_model=AsoResponse, status_code=201)
def cadastrar_aso(item: AsoBase, db=Depends(get_supabase)):
    """Cadastra um ASO. Calcula a validade para exames periódicos se informado."""
    try:
        if item.tipo_exame not in STATUS_ASO_VALIDOS:
            raise HTTPException(
                status_code=400,
                detail=f"Tipo de exame inválido. Valores: {', '.join(sorted(STATUS_ASO_VALIDOS))}.",
            )
        if item.resultado and item.resultado not in RESULTADO_ASO_VALIDOS:
            raise HTTPException(
                status_code=400,
                detail=f"Resultado inválido. Valores: {', '.join(sorted(RESULTADO_ASO_VALIDOS))}.",
            )
        if _parse_data(item.data_exame) is None:
            raise HTTPException(status_code=400, detail="Data do exame inválida. Use YYYY-MM-DD.")

        func = db.table("funcionarios").select("*").eq("id", item.funcionario_id).eq("ativo", True).execute()
        if not func.data:
            raise HTTPException(status_code=404, detail="Funcionário não encontrado.")

        payload = item.model_dump()
        if not payload.get("data_validade") and item.tipo_exame == "periodico" and item.validade_meses:
            payload["data_validade"] = _somar_meses(item.data_exame, item.validade_meses)
        payload["funcionario_nome"] = func.data[0]["nome"]

        response = db.table("aso").insert(payload).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao cadastrar ASO.")
        registro = response.data[0]
        registro["status"] = _status_vencimento(registro.get("data_validade"))
        return registro
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao cadastrar ASO")
        raise HTTPException(status_code=500, detail="Erro ao cadastrar ASO")


@router.put("/aso/{aso_id}", response_model=AsoResponse)
def atualizar_aso(aso_id: int, item: AsoBase, db=Depends(get_supabase)):
    """Atualiza um ASO existente."""
    try:
        check = db.table("aso").select("id").eq("id", aso_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="ASO não encontrado.")
        if item.tipo_exame not in STATUS_ASO_VALIDOS:
            raise HTTPException(status_code=400, detail="Tipo de exame inválido.")
        if _parse_data(item.data_exame) is None:
            raise HTTPException(status_code=400, detail="Data do exame inválida. Use YYYY-MM-DD.")

        func = db.table("funcionarios").select("*").eq("id", item.funcionario_id).eq("ativo", True).execute()
        if not func.data:
            raise HTTPException(status_code=404, detail="Funcionário não encontrado.")

        payload = item.model_dump()
        if not payload.get("data_validade") and item.tipo_exame == "periodico" and item.validade_meses:
            payload["data_validade"] = _somar_meses(item.data_exame, item.validade_meses)
        payload["funcionario_nome"] = func.data[0]["nome"]

        response = db.table("aso").update(payload).eq("id", aso_id).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar ASO.")
        registro = response.data[0]
        registro["status"] = _status_vencimento(registro.get("data_validade"))
        return registro
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao atualizar ASO")
        raise HTTPException(status_code=500, detail="Erro ao atualizar ASO")


@router.delete("/aso/{aso_id}")
def excluir_aso(aso_id: int, db=Depends(get_supabase)):
    """Exclui um ASO.

    Se houver documento anexado, o arquivo no B2 também é removido para não
    deixar objeto órfão no bucket.
    """
    try:
        cert = db.table("certificados").select("bucket_key").eq("tipo_registro", "aso").eq("registro_id", aso_id).execute()
        response = db.table("aso").delete().eq("id", aso_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="ASO não encontrado.")
        if cert.data:
            try:
                from storage import bucket as b2_bucket, get_s3_client
                get_s3_client().delete_object(Bucket=b2_bucket(), Key=cert.data[0]["bucket_key"])
            except Exception:
                logger.warning("Não foi possível remover o documento do ASO no B2 (registro %s)", aso_id)
            db.table("certificados").delete().eq("tipo_registro", "aso").eq("registro_id", aso_id).execute()
        return {"success": True, "message": "ASO excluído com sucesso."}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao excluir ASO")
        raise HTTPException(status_code=500, detail="Erro ao excluir ASO")


# ---------------------------------------------------------------------------
# EPIs (catálogo com controle de CA - NR-6)
# ---------------------------------------------------------------------------
class EpiBase(BaseModel):
    nome: str = Field(..., min_length=2, description="Nome do EPI (ex: Capacete de Segurança)")
    categoria: Optional[str] = Field(None, description="Categoria (ex: Proteção da cabeça)")
    ca_numero: Optional[str] = Field(None, description="Número do Certificado de Aprovação (CA)")
    fabricante: Optional[str] = None
    ca_validade: Optional[str] = Field(None, description="Validade do CA (YYYY-MM-DD)")
    ativo: bool = True


class EpiResponse(EpiBase):
    id: int
    ca_status: str
    created_at: Optional[str] = None


@router.get("/epis", response_model=List[EpiResponse])
def listar_epis(
    incluir_inativos: Optional[bool] = Query(False),
    db=Depends(get_supabase),
):
    """Lista o catálogo de EPIs com a situação do CA."""
    try:
        query = db.table("epis").select("*")
        if not incluir_inativos:
            query = query.eq("ativo", True)
        dados = query.order("nome").execute().data
        for e in dados:
            e["ca_status"] = _status_ca(e.get("ca_validade"))
        return dados
    except Exception as e:
        logger.exception("Erro ao listar EPIs")
        raise HTTPException(status_code=500, detail="Erro ao listar EPIs")


@router.post("/epis", response_model=EpiResponse, status_code=201)
def cadastrar_epi(epi: EpiBase, db=Depends(get_supabase)):
    """Cadastra um EPI no catálogo."""
    try:
        response = db.table("epis").insert(epi.model_dump()).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao cadastrar EPI.")
        registro = response.data[0]
        registro["ca_status"] = _status_ca(registro.get("ca_validade"))
        return registro
    except Exception as e:
        logger.exception("Erro ao cadastrar EPI")
        raise HTTPException(status_code=500, detail="Erro ao cadastrar EPI")


@router.put("/epis/{epi_id}", response_model=EpiResponse)
def atualizar_epi(epi_id: int, epi: EpiBase, db=Depends(get_supabase)):
    """Atualiza um EPI do catálogo."""
    try:
        check = db.table("epis").select("id").eq("id", epi_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="EPI não encontrado.")
        response = db.table("epis").update(epi.model_dump()).eq("id", epi_id).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar EPI.")
        registro = response.data[0]
        registro["ca_status"] = _status_ca(registro.get("ca_validade"))
        return registro
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao atualizar EPI")
        raise HTTPException(status_code=500, detail="Erro ao atualizar EPI")


@router.delete("/epis/{epi_id}")
def excluir_epi(epi_id: int, db=Depends(get_supabase)):
    """Exclusão lógica (soft delete) do EPI."""
    try:
        check = db.table("epis").select("id").eq("id", epi_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="EPI não encontrado.")
        db.table("epis").update({"ativo": False}).eq("id", epi_id).execute()
        return {"success": True, "message": "EPI excluído com sucesso."}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao excluir EPI")
        raise HTTPException(status_code=500, detail="Erro ao excluir EPI")


# ---------------------------------------------------------------------------
# Ficha de EPI digital (entrega de EPIs aos funcionários)
# ---------------------------------------------------------------------------
class FuncEpiBase(BaseModel):
    funcionario_id: int = Field(..., description="ID do funcionário")
    epi_id: int = Field(..., description="ID do EPI")
    data_entrega: str = Field(..., description="Data de entrega (YYYY-MM-DD)")
    data_devolucao: Optional[str] = Field(None, description="Data de devolução")
    quantidade: int = Field(1, ge=1, description="Quantidade entregue")
    observacao: Optional[str] = None


class FuncEpiResponse(FuncEpiBase):
    id: int
    funcionario_nome: str
    epi_nome: str
    ca_numero: Optional[str]
    ca_status: str
    status: str
    created_at: Optional[str] = None


@router.get("/funcionario-epis", response_model=List[FuncEpiResponse])
def listar_funcionario_epis(
    busca: Optional[str] = Query(None, description="Filtra por funcionário ou EPI"),
    status: Optional[str] = Query(None, description="Filtra por Em uso / Devolvido"),
    db=Depends(get_supabase),
):
    """Lista as fichas de entrega de EPI com a situação do CA."""
    try:
        linhas = db.table("funcionario_epis").select("*").order("data_entrega", desc=True).execute().data
        epis_cat = db.table("epis").select("*").eq("ativo", True).execute().data
        ca_map = {e["id"]: _status_ca(e.get("ca_validade")) for e in epis_cat}
        resultado = []
        for r in linhas:
            r["status"] = "Devolvido" if r.get("data_devolucao") else "Em uso"
            r["ca_status"] = ca_map.get(r.get("epi_id"), "Não informado")
            if status and r["status"] != status:
                continue
            if busca:
                termo = busca.lower()
                if termo not in str(r.get("funcionario_nome", "")).lower() and termo not in str(r.get("epi_nome", "")).lower():
                    continue
            resultado.append(r)
        return resultado
    except Exception as e:
        logger.exception("Erro ao listar fichas de EPI")
        raise HTTPException(status_code=500, detail="Erro ao listar fichas de EPI")


@router.post("/funcionario-epis", response_model=FuncEpiResponse, status_code=201)
def cadastrar_funcionario_epi(item: FuncEpiBase, db=Depends(get_supabase)):
    """Registra a entrega de um EPI (Ficha de EPI digital)."""
    try:
        if _parse_data(item.data_entrega) is None:
            raise HTTPException(status_code=400, detail="Data de entrega inválida. Use YYYY-MM-DD.")

        func = db.table("funcionarios").select("*").eq("id", item.funcionario_id).eq("ativo", True).execute()
        epi = db.table("epis").select("*").eq("id", item.epi_id).eq("ativo", True).execute()
        if not func.data:
            raise HTTPException(status_code=404, detail="Funcionário não encontrado.")
        if not epi.data:
            raise HTTPException(status_code=404, detail="EPI não encontrado.")

        epi_data = epi.data[0]
        payload = item.model_dump()
        payload["funcionario_nome"] = func.data[0]["nome"]
        payload["epi_nome"] = epi_data["nome"]
        payload["ca_numero"] = epi_data.get("ca_numero")

        response = db.table("funcionario_epis").insert(payload).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao registrar entrega de EPI.")
        registro = response.data[0]
        registro["status"] = "Devolvido" if registro.get("data_devolucao") else "Em uso"
        registro["ca_status"] = _status_ca(epi_data.get("ca_validade"))
        return registro
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao registrar entrega de EPI")
        raise HTTPException(status_code=500, detail="Erro ao registrar entrega de EPI")


@router.put("/funcionario-epis/{registro_id}", response_model=FuncEpiResponse)
def atualizar_funcionario_epi(registro_id: int, item: FuncEpiBase, db=Depends(get_supabase)):
    """Atualiza uma ficha de entrega de EPI."""
    try:
        check = db.table("funcionario_epis").select("id").eq("id", registro_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Ficha de EPI não encontrada.")
        if _parse_data(item.data_entrega) is None:
            raise HTTPException(status_code=400, detail="Data de entrega inválida. Use YYYY-MM-DD.")

        func = db.table("funcionarios").select("*").eq("id", item.funcionario_id).eq("ativo", True).execute()
        epi = db.table("epis").select("*").eq("id", item.epi_id).eq("ativo", True).execute()
        if not func.data:
            raise HTTPException(status_code=404, detail="Funcionário não encontrado.")
        if not epi.data:
            raise HTTPException(status_code=404, detail="EPI não encontrado.")

        epi_data = epi.data[0]
        payload = item.model_dump()
        payload["funcionario_nome"] = func.data[0]["nome"]
        payload["epi_nome"] = epi_data["nome"]
        payload["ca_numero"] = epi_data.get("ca_numero")

        response = db.table("funcionario_epis").update(payload).eq("id", registro_id).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar ficha de EPI.")
        registro = response.data[0]
        registro["status"] = "Devolvido" if registro.get("data_devolucao") else "Em uso"
        registro["ca_status"] = _status_ca(epi_data.get("ca_validade"))
        return registro
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao atualizar ficha de EPI")
        raise HTTPException(status_code=500, detail="Erro ao atualizar ficha de EPI")


@router.delete("/funcionario-epis/{registro_id}")
def excluir_funcionario_epi(registro_id: int, db=Depends(get_supabase)):
    """Exclui uma ficha de entrega de EPI."""
    try:
        response = db.table("funcionario_epis").delete().eq("id", registro_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Ficha de EPI não encontrada.")
        return {"success": True, "message": "Ficha de EPI excluída com sucesso."}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao excluir ficha de EPI")
        raise HTTPException(status_code=500, detail="Erro ao excluir ficha de EPI")


@router.get("/pendencias")
def listar_pendencias(
    busca: Optional[str] = Query(None, description="Filtra por funcionário ou curso"),
    db=Depends(get_supabase),
):
    """Lista os treinamentos obrigatórios (matriz) que estão pendentes ou vencidos por funcionário.

    Um treinamento é considerado:
      - Pendente: o funcionário nunca realizou o curso exigido pelo cargo;
      - Vencido: o funcionário realizou, mas a validade (reciclagem) já passou.
    """
    try:
        funcionarios = db.table("funcionarios").select("*").eq("ativo", True).execute().data
        cargos = db.table("cargos").select("*").eq("ativo", True).execute().data
        treinamentos = db.table("treinamentos").select("*").eq("ativo", True).execute().data
        matriz = db.table("matriz_treinamentos").select("*").execute().data
        realizados = db.table("funcionario_treinamentos").select("*").execute().data

        cargo_map = {c["id"]: c for c in cargos}
        treino_map = {t["id"]: t for t in treinamentos}

        # Mantém apenas a realização mais recente de cada funcionário x treinamento
        realizados_map = {}
        for r in realizados:
            chave = (r.get("funcionario_id"), r.get("treinamento_id"))
            atual = realizados_map.get(chave)
            if atual is None or str(r.get("data_validade") or "") > str(atual.get("data_validade") or ""):
                realizados_map[chave] = r

        pendencias = []
        for func in funcionarios:
            # Considera as duas funções do funcionário (cargo_id e cargo_id_2).
            cargos_do_func = {func.get("cargo_id"), func.get("cargo_id_2")}
            cargos_do_func = [cid for cid in cargos_do_func if cid and cid in cargo_map]
            if not cargos_do_func:
                continue
            # Um curso exigido por ambos os cargos aparece apenas uma vez na pendência.
            cursos_vistos = set()
            for cargo_id in cargos_do_func:
                for m in matriz:
                    if m.get("cargo_id") != cargo_id:
                        continue
                    treino = treino_map.get(m.get("treinamento_id"))
                    if not treino:
                        continue
                    if treino["id"] in cursos_vistos:
                        continue
                    cursos_vistos.add(treino["id"])
                    ultimo = realizados_map.get((func["id"], treino["id"]))
                    base = {
                        "funcionario_id": func["id"],
                        "funcionario_nome": func["nome"],
                        "cargo_id": cargo_id,
                        "cargo_nome": cargo_map[cargo_id]["nome"],
                        "treinamento_id": treino["id"],
                        "treinamento_nome": treino["nome"],
                        "norma": treino.get("norma"),
                        "tipo": treino.get("tipo"),
                        "validade_meses": treino.get("validade_meses"),
                    }
                    if ultimo is None:
                        pendencias.append({
                            **base,
                            "situacao": "Pendente",
                            "ultima_realizacao": None,
                            "ultima_validade": None,
                        })
                    elif _status_vencimento(ultimo.get("data_validade")) == STATUS_VENCIDO:
                        pendencias.append({
                            **base,
                            "situacao": "Vencido",
                            "ultima_realizacao": ultimo.get("data_realizacao"),
                            "ultima_validade": ultimo.get("data_validade"),
                        })

        if busca:
            termo = busca.lower()
            pendencias = [
                p for p in pendencias
                if termo in p["funcionario_nome"].lower() or termo in p["treinamento_nome"].lower()
            ]

        pendencias.sort(key=lambda p: (p["funcionario_nome"], p["treinamento_nome"]))
        return pendencias
    except Exception as e:
        logger.exception("Erro ao listar pendências de treinamentos")
        raise HTTPException(status_code=500, detail="Erro ao listar pendências de treinamentos")


# ---------------------------------------------------------------------------
# PDF da Ficha de EPI (NR-6)
# ---------------------------------------------------------------------------
def _formatar_data_br(valor) -> str:
    d = _parse_data(valor)
    return d.strftime("%d/%m/%Y") if d else "-"


def _gerar_pdf_ficha_epi(ficha: dict, epi: dict):
    """Gera o PDF da Ficha de Entrega de EPI com os campos exigidos pela NR-6."""
    from fpdf import FPDF
    from fpdf.enums import XPos, YPos

    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()

    # Cabeçalho
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "FICHA DE ENTREGA DE EPI", align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, "Equipamento de Proteção Individual - NR-6", align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.cell(0, 6, f"Emitida em: {_hoje().strftime('%d/%m/%Y')}", align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(6)

    def _linha(larg_rotulo, rotulo, valor):
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(larg_rotulo, 8, rotulo, new_x=XPos.RIGHT, new_y=YPos.TOP)
        pdf.set_font("Helvetica", "", 10)
        pdf.cell(0, 8, str(valor) if valor not in (None, "") else "-", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    _linha(55, "Funcionário:", ficha.get("funcionario_nome", ""))
    _linha(55, "EPI:", ficha.get("epi_nome", ""))
    _linha(55, "Número do CA:", ficha.get("ca_numero") or epi.get("ca_numero") or "-")
    _linha(55, "Validade do CA:", _formatar_data_br(epi.get("ca_validade")))
    _linha(55, "Fabricante:", epi.get("fabricante") or "-")
    _linha(55, "Quantidade:", str(ficha.get("quantidade") or 1))
    _linha(55, "Data de Entrega:", _formatar_data_br(ficha.get("data_entrega")))
    _linha(55, "Data de Devolução:", _formatar_data_br(ficha.get("data_devolucao")))

    observacao = ficha.get("observacao")
    if observacao:
        pdf.ln(2)
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(0, 8, "Observações:", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_font("Helvetica", "", 10)
        pdf.multi_cell(0, 6, str(observacao))

    # Aviso legal NR-6
    pdf.ln(4)
    pdf.set_font("Helvetica", "I", 8)
    pdf.multi_cell(
        0, 4,
        "Conforme a NR-6, o empregador é obrigado a fornecer ao trabalhador, gratuitamente, EPI adequado ao risco, "
        "em perfeito estado de conservação e funcionamento, com Certificado de Aprovação (CA) válido. "
        "O trabalhador deve assinar o recebimento do equipamento.",
        align="J",
    )

    # Assinaturas
    pdf.ln(12)
    largura = 80
    y_linha = pdf.get_y()
    pdf.line(pdf.l_margin, y_linha, pdf.l_margin + largura, y_linha)
    pdf.line(pdf.l_margin + 90, y_linha, pdf.l_margin + 90 + largura, y_linha)
    pdf.set_y(y_linha + 2)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(largura + 10, 8, "Responsável pela entrega", new_x=XPos.RIGHT, new_y=YPos.TOP)
    pdf.cell(0, 8, "Funcionário (recebedor)", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    return pdf


@router.get("/funcionario-epis/{registro_id}/pdf")
def gerar_pdf_ficha_epi(registro_id: int, db=Depends(get_supabase)):
    """Gera e baixa a Ficha de Entrega de EPI em PDF."""
    try:
        ficha_resp = db.table("funcionario_epis").select("*").eq("id", registro_id).execute()
        if not ficha_resp.data:
            raise HTTPException(status_code=404, detail="Ficha de EPI não encontrada.")
        ficha = ficha_resp.data[0]

        epi = {}
        if ficha.get("epi_id"):
            epi_resp = db.table("epis").select("*").eq("id", ficha["epi_id"]).execute()
            if epi_resp.data:
                epi = epi_resp.data[0]

        pdf = _gerar_pdf_ficha_epi(ficha, epi)
        nome_base = "".join(
            c for c in str(ficha.get("funcionario_nome") or "funcionario")
            if c.isalnum() or c in (" ", "-", "_")
        ).strip() or "funcionario"
        nome_arquivo = f"Ficha_EPI_{nome_base}_{registro_id}.pdf"

        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            pdf.output(tmp.name)
            caminho = tmp.name

        return FileResponse(caminho, media_type="application/pdf", filename=nome_arquivo)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao gerar PDF da ficha de EPI")
        raise HTTPException(status_code=500, detail="Erro ao gerar PDF da ficha de EPI")


# ---------------------------------------------------------------------------
# Alertas de SST (para a central de notificações)
# ---------------------------------------------------------------------------
@router.get("/alertas")
def obter_alertas(db=Depends(get_supabase)):
    """Resumo de conformidade e alertas de vencimentos de treinamentos, ASOs e CAs de EPI."""
    try:
        treinos = db.table("funcionario_treinamentos").select("*").execute().data
        asos = db.table("aso").select("*").execute().data
        epis = db.table("epis").select("*").eq("ativo", True).execute().data

        for t in treinos:
            t["status"] = _status_vencimento(t.get("data_validade"))
        for a in asos:
            a["status"] = _status_vencimento(a.get("data_validade"))

        resumo = {
            "treinamentos": _contar_status(treinos),
            "asos": _contar_status(asos),
            "epis_ca_vencido": sum(1 for e in epis if _status_ca(e.get("ca_validade")) == "CA Vencido"),
            "epis_total": len(epis),
        }

        alertas = []
        hoje = _hoje()

        for t in treinos:
            if t["status"] == STATUS_VENCIDO:
                alertas.append(_registro_vencimento(
                    f"Treinamento VENCIDO: {t.get('funcionario_nome')} - {t.get('treinamento_nome')} (validade {t.get('data_validade')}).",
                    "danger",
                ))
            elif t["status"] == STATUS_PROXIMO:
                d = _parse_data(t.get("data_validade"))
                dias = (d - hoje).days if d else 0
                alertas.append(_registro_vencimento(
                    f"{t.get('funcionario_nome')} - {t.get('treinamento_nome')} vence em {dias} dia(s) ({t.get('data_validade')}).",
                    "warning",
                ))

        for a in asos:
            if a["status"] == STATUS_VENCIDO and a.get("tipo_exame") == "periodico":
                alertas.append(_registro_vencimento(
                    f"ASO periódico VENCIDO: {a.get('funcionario_nome')} (exame {a.get('data_exame')}).",
                    "danger",
                ))
            elif a["status"] == STATUS_PROXIMO:
                d = _parse_data(a.get("data_validade"))
                dias = (d - hoje).days if d else 0
                alertas.append(_registro_vencimento(
                    f"ASO de {a.get('funcionario_nome')} vence em {dias} dia(s) ({a.get('data_validade')}).",
                    "warning",
                ))

        for e in epis:
            if _status_ca(e.get("ca_validade")) == "CA Vencido":
                alertas.append(_registro_vencimento(
                    f"CA vencido para o EPI: {e.get('nome')} (CA {e.get('ca_numero')}).",
                    "warning",
                ))

        alertas.sort(key=lambda x: 0 if x["gravidade"] == "danger" else 1)
        return {"resumo": resumo, "alertas": alertas}
    except Exception as e:
        logger.exception("Erro ao buscar alertas de SST")
        raise HTTPException(status_code=500, detail="Erro ao buscar alertas de SST")
