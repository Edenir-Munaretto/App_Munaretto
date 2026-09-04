"""Checklist de execução da O.S — regras e acesso a dados.

O checklist é um SNAPSHOT do catálogo (os_checklist_modelos) copiado para a
O.S (os_checklist_itens) no momento da criação. Assim, alterações futuras no
catálogo não mudam O.S antigas (histórico fiel).

Regras de liberação:
  - INÍCIO (aberta -> em_andamento): grupo 1 (Preparação) totalmente respondido.
  - CONCLUSÃO (-> concluida): todos os itens respondidos.
  - Resposta 'Não' não bloqueia, mas exige justificativa.
  - O.S sem itens (catálogo vazio/legada) não é bloqueada por este módulo.
"""

import logging

from utils.tipos_os import TIPOS_OS

NOMES_GRUPOS = {
    1: "Preparação (base)",
    2: "Chegada ao Local",
    3: "Liberação da Execução",
    4: "Durante a Execução",
    5: "Encerramento",
}

RESPOSTAS_VALIDAS = ("sim", "nao", "na")

GRUPO_LIBERACAO_INICIO = 1

logger = logging.getLogger(__name__)


def _eh_violacao_unique(exc: Exception) -> bool:
    texto = str(getattr(exc, "message", "") or exc).lower()
    return any(marca in texto for marca in ("23505", "duplicate key", "já existe", "already exists"))


def snapshot_checklist(db, os_id: int) -> None:
    """Copia o catálogo ativo aplicável à O.S (idempotente).

    Modelos `tipo='geral'` valem para qualquer O.S; modelos com tipo específico
    (construcao/manutencao/linha_viva) só entram na O.S do MESMO tipo.
    Em corrida (duas chamadas simultâneas), insere apenas os itens faltantes:
    o UNIQUE(os_id, classificacao) protege e a violação de unicidade é tratada
    como sucesso (o concorrente já gravou).
    """
    os_row = db.table("ordens_servico").select("tipo").eq("id", os_id).execute().data
    tipo_os = (os_row[0].get("tipo") if os_row else None) or "construcao"
    if tipo_os not in TIPOS_OS:
        tipo_os = "construcao"

    modelos = (
        db.table("os_checklist_modelos")
        .select("*")
        .eq("ativo", True)
        .in_("tipo", ("geral", tipo_os))
        .order("grupo")
        .order("ordem")
        .execute()
        .data
    )
    if not modelos:
        return

    existentes = db.table("os_checklist_itens").select("classificacao").eq("os_id", os_id).execute().data or []
    presentes = {i["classificacao"] for i in existentes}

    linhas = [
        {
            "os_id": os_id,
            "modelo_id": m["id"],
            "grupo": m["grupo"],
            "ordem": m["ordem"],
            "classificacao": m["classificacao"],
            "pergunta": m["pergunta"],
            "exige_foto": bool(m.get("exige_foto", False)),
        }
        for m in modelos
        if m["classificacao"] not in presentes
    ]
    if not linhas:
        return
    try:
        db.table("os_checklist_itens").insert(linhas).execute()
    except Exception as exc:
        if _eh_violacao_unique(exc):
            # Corrida: o concorrente gravou os itens entre a leitura e o insert.
            logger.warning("Snapshot da O.S %s colidiu com outra requisição; itens já aplicados.", os_id)
            return
        raise


def garantir_snapshot(db, os_id: int) -> None:
    """Garante o snapshot para O.S criadas antes do recurso existir."""
    existe = db.table("os_checklist_itens").select("id").eq("os_id", os_id).limit(1).execute().data
    if not existe:
        snapshot_checklist(db, os_id)


def _fotos_por_item(db, item_ids: list[int]) -> dict[int, list[dict]]:
    """Fotos vinculadas a itens do checklist (os_fotos.checklist_item_id)."""
    if not item_ids:
        return {}
    fotos = (
        db.table("os_fotos")
        .select("*")
        .in_("checklist_item_id", item_ids)
        .order("created_at")
        .execute()
        .data
    )
    por_item: dict[int, list[dict]] = {}
    for f in fotos or []:
        por_item.setdefault(f["checklist_item_id"], []).append(f)
    return por_item


def itens_com_respostas(db, os_id: int) -> list[dict]:
    """Itens do checklist da O.S com a resposta e as fotos de cada item."""
    garantir_snapshot(db, os_id)
    itens = (
        db.table("os_checklist_itens")
        .select("*")
        .eq("os_id", os_id)
        .order("grupo")
        .order("ordem")
        .execute()
        .data
    )
    if not itens:
        return []

    ids = [i["id"] for i in itens]
    respostas = db.table("os_checklist_respostas").select("*").in_("item_id", ids).execute().data or []
    por_item_resp = {r["item_id"]: r for r in respostas}
    fotos = _fotos_por_item(db, ids)

    for i in itens:
        i["resposta"] = por_item_resp.get(i["id"])
        i["fotos"] = fotos.get(i["id"], [])
    return itens


def resumo_checklist(db, os_id: int) -> dict:
    """Contagem de respondidos por grupo + flags de liberação."""
    itens = itens_com_respostas(db, os_id)
    total = len(itens)
    respondidos = sum(1 for i in itens if i.get("resposta"))

    grupos = []
    for g in range(1, len(NOMES_GRUPOS) + 1):
        do_grupo = [i for i in itens if i.get("grupo") == g]
        resp_grupo = [i for i in do_grupo if i.get("resposta")]
        grupos.append(
            {
                "grupo": g,
                "nome": NOMES_GRUPOS[g],
                "total": len(do_grupo),
                "respondidos": len(resp_grupo),
                "completo": bool(do_grupo) and len(resp_grupo) == len(do_grupo),
            }
        )

    inicio = next((g for g in grupos if g["grupo"] == GRUPO_LIBERACAO_INICIO), None)
    # Sem itens cadastrados = recurso não configurado: não bloqueia nada.
    inicio_liberado = inicio is None or inicio["total"] == 0 or inicio["completo"]
    completo = total == 0 or respondidos == total

    return {
        "total": total,
        "respondidos": respondidos,
        "completo": completo,
        "inicio_liberado": inicio_liberado,
        "grupos": grupos,
    }


def pendentes_para_conclusao(db, os_id: int) -> list[str]:
    """Descrição curta dos itens ainda não respondidos (para mensagens de erro)."""
    itens = itens_com_respostas(db, os_id)
    return [f"{i['classificacao']} {i['pergunta']}" for i in itens if not i.get("resposta")]
