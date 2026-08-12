"""Resumo agregado do Dashboard.

Endpoint único consumido pelo Dashboard do frontend. É liberado para quem
tiver a permissão de módulo "dashboard" (concedida pelo administrador na aba
Configurações) ou "configuracoes" (admin), garantindo acesso total aos dados
exibidos (funcionários, férias, ASOs e cursos).

Depende apenas de leitura sobre as tabelas compartilhadas dos demais módulos.
"""
import logging
from datetime import date, datetime

from fastapi import APIRouter, HTTPException, Depends

from supabase_client import get_supabase
from auth import require_qualquer_permisao

router = APIRouter(dependencies=[Depends(require_qualquer_permisao(["dashboard", "configuracoes"]))])

logger = logging.getLogger(__name__)

DIAS_AVISO = 30
STATUS_VIGENTE = "Vigente"
STATUS_PROXIMO = "Próximo ao Vencimento"
STATUS_VENCIDO = "Vencido"
STATUS_SEM_VALIDADE = "Sem validade"
STATUS_FERIAS_ATIVAS = {"Agendado", "Em Férias"}


def _hoje() -> date:
    return date.today()


def _parse_data(valor) -> date | None:
    try:
        return datetime.strptime(str(valor), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _status_vencimento(data_validade, dias_aviso: int = DIAS_AVISO) -> str:
    d = _parse_data(data_validade)
    if d is None:
        return STATUS_SEM_VALIDADE
    dias = (d - _hoje()).days
    if dias < 0:
        return STATUS_VENCIDO
    if dias <= dias_aviso:
        return STATUS_PROXIMO
    return STATUS_VIGENTE


def _contar_status(registros: list) -> dict:
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


def _status_ferias(data_inicio: str, data_retorno: str, status_atual: str) -> str:
    if status_atual in ("Cancelado", "Programado"):
        return status_atual
    inicio = _parse_data(data_inicio)
    retorno = _parse_data(data_retorno)
    if inicio is None or retorno is None:
        return status_atual
    hoje = _hoje()
    if hoje < inicio:
        return "Agendado"
    if inicio <= hoje < retorno:
        return "Em Férias"
    return "Concluído"


def _alertas_ferias(registros: list) -> list:
    """Mesma regra do endpoint /api/ferias/alertas (prazos de gozo)."""
    hoje = _hoje()
    alertas = []
    for r in registros:
        if r.get("status") in ("Cancelado", "Concluído", "Programado"):
            continue
        limite = _parse_data(r.get("data_limite"))
        if limite is None:
            continue
        dias = (limite - hoje).days
        nome = r.get("nome", "Colaborador")
        if 10 < dias <= 30:
            alertas.append({
                "nome": nome,
                "data_limite": limite.strftime("%d/%m/%Y"),
                "dias_restantes": dias,
                "gravidade": "warning",
                "mensagem": f"Faltam {dias} dias para o limite de gozo de {nome} ({limite.strftime('%d/%m/%Y')}).",
            })
        elif 0 <= dias <= 10:
            alertas.append({
                "nome": nome,
                "data_limite": limite.strftime("%d/%m/%Y"),
                "dias_restantes": dias,
                "gravidade": "danger",
                "mensagem": f"URGENTE: {nome} precisa tirar férias até {limite.strftime('%d/%m/%Y')}!",
            })
        elif dias < 0:
            alertas.append({
                "nome": nome,
                "data_limite": limite.strftime("%d/%m/%Y"),
                "dias_restantes": dias,
                "gravidade": "expired",
                "mensagem": f"ATENÇÃO: Prazo limite vencido para {nome} em {limite.strftime('%d/%m/%Y')}!",
            })
    return alertas


@router.get("/resumo")
def resumo_dashboard(db=Depends(get_supabase)):
    """Retorna todos os dados exibidos no Dashboard em uma única chamada."""
    try:
        # Funcionários: total sem excluídos (ativos + inativos)
        funcs = db.table("funcionarios").select("ativo", "excluido").eq("excluido", False).execute()
        total_funcionarios = len(funcs.data or [])

        # Férias: contagem de registros Agendado/Em Férias e alertas de prazo
        fer_data = db.table("gestao_ferias").select("nome, data_inicio, data_retorno, data_limite, status").execute()
        ferias = fer_data.data or []
        for f in ferias:
            f["status"] = _status_ferias(f.get("data_inicio"), f.get("data_retorno"), f.get("status"))
        ferias_ativas = sum(1 for f in ferias if f.get("status") in STATUS_FERIAS_ATIVAS)
        alertas_ferias = _alertas_ferias(ferias)

        # ASO: classificação por vencimento
        aso_data = db.table("aso").select("data_validade").execute()
        asos = aso_data.data or []
        for a in asos:
            a["status"] = _status_vencimento(a.get("data_validade"))
        aso_resumo = _contar_status(asos)

        # Cursos/treinamentos dos funcionários
        trei_data = db.table("funcionario_treinamentos").select("data_validade").execute()
        treinos = trei_data.data or []
        for t in treinos:
            t["status"] = _status_vencimento(t.get("data_validade"))
        cursos_resumo = _contar_status(treinos)

        return {
            "funcionarios": {"total": total_funcionarios},
            "ferias": {"ativas": ferias_ativas},
            "asos": aso_resumo,
            "cursos": cursos_resumo,
            "alertas_ferias": alertas_ferias,
        }
    except Exception as e:
        logger.exception("Erro ao buscar resumo do dashboard")
        raise HTTPException(status_code=500, detail="Erro ao buscar resumo do dashboard")