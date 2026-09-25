"""Agenda de Desligamentos Celesc (acompanhamento das Solicitações de Desligamento).

O registro é criado/atualizado ao imprimir a O.S com a folha CELESC (ver
`routers/os.py`) e espelhado quando a O.S é editada, preservando o substituto e
as equipes de apoio. As equipes de apoio são definidas AQUI (painel da agenda)
e não saem na folha oficial.

Permissão: apenas gestor do módulo O.S ("os").
"""

import contextlib
import logging
import os
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from auth import require_permisao
from supabase_client import get_supabase

router = APIRouter(dependencies=[Depends(require_permisao("os"))])

logger = logging.getLogger(__name__)


class EquipeApoio(BaseModel):
    equipe_id: int
    equipe_numero: int | None = None
    equipe_nome: str | None = None


class DesligamentoResponse(BaseModel):
    id: int
    os_id: int
    obra_id: int | None = None
    agencia: str | None = None
    projeto_sap: str | None = None
    obra: str | None = None
    local: str | None = None
    municipio: str | None = None
    data: str | None = None
    hora_desligar: str | None = None
    hora_religar: str | None = None
    alimentador: str | None = None
    chave: str | None = None
    servico: str | None = None
    codigo_os: str | None = None
    equipe_numero: int | None = None
    equipe_nome: str | None = None
    encarregado: str | None = None
    substituto: str | None = None
    impresso_em: str | None = None
    impresso_por: str | None = None
    equipes_apoio: list[EquipeApoio] = Field(default_factory=list)


class EquipesApoioUpdate(BaseModel):
    equipe_ids: list[int] = Field(default_factory=list, description="Equipes de apoio do desligamento")


def _remover_arquivo(caminho: str) -> None:
    """Remove um arquivo temporário após o envio (background do FileResponse)."""
    with contextlib.suppress(OSError):
        os.remove(caminho)


def _rotulo_periodo(data_inicio: str | None, data_fim: str | None) -> str:
    def _br(valor: str | None) -> str:
        texto = str(valor or "")[:10]
        return f"{texto[8:10]}/{texto[5:7]}/{texto[0:4]}" if len(texto) == 10 else (valor or "")

    if data_inicio and data_fim:
        return f"de {_br(data_inicio)} a {_br(data_fim)}"
    if data_inicio:
        return f"a partir de {_br(data_inicio)}"
    if data_fim:
        return f"até {_br(data_fim)}"
    return "Todos os períodos"


def _carregar_equipes_apoio(db, desligamento_ids: list[int]) -> dict[int, list[dict]]:
    """Equipes de apoio agrupadas por desligamento (uma query para toda a lista)."""
    if not desligamento_ids:
        return {}
    linhas = (
        db.table("os_desligamento_equipes")
        .select("*")
        .in_("desligamento_id", desligamento_ids)
        .execute()
        .data
    )
    agrupado: dict[int, list[dict]] = {}
    for linha in linhas:
        agrupado.setdefault(linha["desligamento_id"], []).append(
            {
                "equipe_id": linha["equipe_id"],
                "equipe_numero": linha.get("equipe_numero"),
                "equipe_nome": linha.get("equipe_nome"),
            }
        )
    return agrupado


def _listar_desligamentos(
    db,
    *,
    data_inicio: str | None = None,
    data_fim: str | None = None,
    equipe_id: int | None = None,
    busca: str | None = None,
) -> list[dict]:
    """Lista os desligamentos com filtros e anexa as equipes de apoio."""
    try:
        query = db.table("os_desligamentos").select("*")

        if data_inicio:
            query = query.gte("data", data_inicio)
        if data_fim:
            query = query.lte("data", data_fim)

        if busca:
            # Remove caracteres que o PostgREST interpreta como sintaxe de filtro
            termo = re.sub(r"[%_*,()=;<>]", "", busca).strip()
            if termo:
                query = query.or_(
                    f"local.ilike.%{termo}%,municipio.ilike.%{termo}%,projeto_sap.ilike.%{termo}%,"
                    f"codigo_os.ilike.%{termo}%,equipe_nome.ilike.%{termo}%,obra.ilike.%{termo}%"
                )

        if equipe_id:
            vinculos = (
                db.table("os_desligamento_equipes")
                .select("desligamento_id")
                .eq("equipe_id", equipe_id)
                .execute()
                .data
            )
            ids = sorted({v["desligamento_id"] for v in vinculos})
            if not ids:
                return []
            query = query.in_("id", ids)

        registros = query.order("data").order("hora_desligar").execute().data

        apoios = _carregar_equipes_apoio(db, [r["id"] for r in registros])
        for registro in registros:
            registro["equipes_apoio"] = apoios.get(registro["id"], [])

        return registros
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao listar desligamentos")
        raise HTTPException(status_code=500, detail="Erro ao buscar desligamentos") from None


@router.get("/", response_model=list[DesligamentoResponse], summary="Lista os desligamentos da agenda")
def listar_desligamentos(
    data_inicio: str | None = Query(None, description="Data inicial (YYYY-MM-DD)"),
    data_fim: str | None = Query(None, description="Data final (YYYY-MM-DD)"),
    equipe_id: int | None = Query(None, description="Filtra por equipe (principal ou de apoio)"),
    busca: str | None = Query(None, description="Busca em local, município, Nota PS, O.S, obra ou equipe"),
    db=Depends(get_supabase),
):
    return _listar_desligamentos(
        db, data_inicio=data_inicio, data_fim=data_fim, equipe_id=equipe_id, busca=busca
    )


@router.get("/agenda", summary="Gera o PDF da agenda de desligamentos")
def imprimir_agenda(
    data_inicio: str | None = Query(None, description="Data inicial (YYYY-MM-DD)"),
    data_fim: str | None = Query(None, description="Data final (YYYY-MM-DD)"),
    equipe_id: int | None = Query(None, description="Filtra por equipe (principal ou de apoio)"),
    busca: str | None = Query(None, description="Busca em local, município, Nota PS, O.S, obra ou equipe"),
    db=Depends(get_supabase),
):
    """PDF consolidado com DATA, LOCAL, NOTA PS, MUNICÍPIO, EQUIPE e HORÁRIO."""
    try:
        registros = _listar_desligamentos(
            db, data_inicio=data_inicio, data_fim=data_fim, equipe_id=equipe_id, busca=busca
        )
        from utils.pdf_desligamentos import gerar_pdf_agenda_desligamentos

        caminho = gerar_pdf_agenda_desligamentos(registros, _rotulo_periodo(data_inicio, data_fim))
        return FileResponse(
            caminho,
            media_type="application/pdf",
            filename="agenda_desligamentos.pdf",
            background=BackgroundTask(_remover_arquivo, caminho),
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao gerar a agenda de desligamentos")
        raise HTTPException(status_code=500, detail="Erro ao gerar a agenda de desligamentos") from None


@router.put("/{desligamento_id}/equipes", response_model=DesligamentoResponse, summary="Define as equipes de apoio")
def definir_equipes_apoio(desligamento_id: int, payload: EquipesApoioUpdate, db=Depends(get_supabase)):
    """Substitui a lista de equipes de apoio do desligamento (gravando o snapshot do nome/número)."""
    try:
        check = db.table("os_desligamentos").select("id").eq("id", desligamento_id).execute().data
        if not check:
            raise HTTPException(status_code=404, detail="Desligamento não encontrado")

        ids = sorted({int(i) for i in payload.equipe_ids})
        equipes_por_id: dict[int, dict] = {}
        if ids:
            equipes = db.table("equipes").select("id, nome, numero").in_("id", ids).execute().data
            equipes_por_id = {e["id"]: e for e in equipes}
            faltantes = [i for i in ids if i not in equipes_por_id]
            if faltantes:
                raise HTTPException(
                    status_code=404,
                    detail=f"Equipe(s) não encontrada(s): {', '.join(str(i) for i in faltantes)}.",
                )

        db.table("os_desligamento_equipes").delete().eq("desligamento_id", desligamento_id).execute()
        if ids:
            db.table("os_desligamento_equipes").insert(
                [
                    {
                        "desligamento_id": desligamento_id,
                        "equipe_id": i,
                        "equipe_numero": equipes_por_id[i].get("numero"),
                        "equipe_nome": equipes_por_id[i].get("nome"),
                    }
                    for i in ids
                ]
            ).execute()

        registro = db.table("os_desligamentos").select("*").eq("id", desligamento_id).execute().data[0]
        registro["equipes_apoio"] = _carregar_equipes_apoio(db, [desligamento_id]).get(desligamento_id, [])
        return registro
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao salvar equipes de apoio do desligamento %s", desligamento_id)
        raise HTTPException(status_code=500, detail="Erro ao salvar equipes de apoio") from None


@router.delete("/{desligamento_id}", summary="Remove o desligamento da agenda")
def excluir_desligamento(desligamento_id: int, db=Depends(get_supabase)):
    """Remove apenas o registro da agenda (a O.S permanece intacta)."""
    try:
        check = db.table("os_desligamentos").select("id").eq("id", desligamento_id).execute().data
        if not check:
            raise HTTPException(status_code=404, detail="Desligamento não encontrado")

        db.table("os_desligamentos").delete().eq("id", desligamento_id).execute()
        return {"success": True, "message": "Desligamento removido da agenda."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao remover o desligamento %s da agenda", desligamento_id)
        raise HTTPException(status_code=500, detail="Erro ao remover desligamento da agenda") from None
