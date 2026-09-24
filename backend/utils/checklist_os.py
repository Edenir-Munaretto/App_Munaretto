"""Checklist de execução da O.S — regras e acesso a dados.

O checklist é um SNAPSHOT do catálogo (os_checklist_modelos) copiado para a
O.S (os_checklist_itens) no momento da criação. Assim, alterações futuras no
catálogo não mudam O.S antigas (histórico fiel).

Catálogo por contrato: se o tipo da O.S tem modelos ativos próprios (ex.:
linha_viva), eles SUBSTITUEM o catálogo `geral`; sem modelos do tipo, valem
os `geral` (construção/manutenção).

Regras de liberação:
  - INÍCIO (aberta -> em_andamento): grupos de liberação do tipo totalmente
    respondidos (padrão: grupo 1; linha viva: grupos 1 e 2).
  - CONCLUSÃO (-> concluida): todos os itens respondidos.
  - Resposta 'Não' não bloqueia; a justificativa é OPCIONAL (decisão de
    produto — modelos antigos podem vir com justificativa, mas não é exigida).
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

# Contratos com checklist próprio (catalogado em os_checklist_modelos) podem
# ter outra estrutura de etapas e outro momento de liberação da execução.
NOMES_GRUPOS_POR_TIPO = {
    "linha_viva": {
        1: "Preparação",
        2: "Bloqueio e Sinalização",
        3: "Execução",
        4: "Encerramento",
    },
}

RESPOSTAS_VALIDAS = ("sim", "nao", "na")

GRUPO_LIBERACAO_INICIO = 1

# Grupos que precisam estar completos para a O.S sair de 'aberta' para
# 'em_andamento'. Linha Viva libera após a sinalização (etapas 1 e 2).
GRUPOS_LIBERACAO_INICIO_POR_TIPO = {
    "linha_viva": (1, 2),
}

logger = logging.getLogger(__name__)


def nomes_grupos(tipo_os: str | None) -> dict[int, str]:
    """Nomes das etapas do checklist para o tipo da O.S (fallback: padrão)."""
    return NOMES_GRUPOS_POR_TIPO.get(tipo_os or "", NOMES_GRUPOS)


def grupos_liberacao(tipo_os: str | None) -> tuple[int, ...]:
    """Grupos exigidos para liberar o início da execução no tipo da O.S."""
    return GRUPOS_LIBERACAO_INICIO_POR_TIPO.get(tipo_os or "", (GRUPO_LIBERACAO_INICIO,))


def config_grupos_do_snapshot(db, tipo_os: str | None, itens: list[dict]) -> tuple[dict[int, str], tuple[int, ...]]:
    """Etapas e gate do tipo — só quando o snapshot veio do catálogo do tipo.

    O.S de linha viva criadas ANTES do catálogo próprio têm snapshot do
    'geral' (modelos do tipo geral): mantêm nomes e liberação padrão, para não
    mudar o que já está em campo. A config própria vale quando algum item do
    snapshot aponta para um modelo `tipo=linha_viva` etc.
    """
    if tipo_os not in NOMES_GRUPOS_POR_TIPO:
        return NOMES_GRUPOS, (GRUPO_LIBERACAO_INICIO,)
    modelo_ids = [i["modelo_id"] for i in itens if i.get("modelo_id")]
    if modelo_ids:
        tipos = db.table("os_checklist_modelos").select("tipo").in_("id", modelo_ids).execute().data or []
        if any(m.get("tipo") == tipo_os for m in tipos):
            return nomes_grupos(tipo_os), grupos_liberacao(tipo_os)
    return NOMES_GRUPOS, (GRUPO_LIBERACAO_INICIO,)


def _eh_violacao_unique(exc: Exception) -> bool:
    texto = str(getattr(exc, "message", "") or exc).lower()
    return any(marca in texto for marca in ("23505", "duplicate key", "já existe", "already exists"))


def _modelos_para_snapshot(db, tipo_os: str) -> list[dict]:
    """Catálogo ativo aplicável ao tipo da O.S.

    Se o contrato tem catálogo próprio (ex.: linha_viva), ele SUBSTITUI o
    catálogo padrão; contratos sem catálogo próprio (construção/manutenção)
    continuam usando os modelos `tipo='geral'`.
    """
    especificos = (
        db.table("os_checklist_modelos")
        .select("*")
        .eq("ativo", True)
        .eq("tipo", tipo_os)
        .order("grupo")
        .order("ordem")
        .execute()
        .data
    )
    if especificos:
        return especificos
    return (
        db.table("os_checklist_modelos")
        .select("*")
        .eq("ativo", True)
        .eq("tipo", "geral")
        .order("grupo")
        .order("ordem")
        .execute()
        .data
    )


def snapshot_checklist(db, os_id: int) -> None:
    """Copia o catálogo ativo aplicável à O.S (idempotente).

    Modelos com tipo específico (ex.: linha_viva) SUBSTITUEM o catálogo
    `geral` na O.S do MESMO tipo; sem catálogo específico, vale o `geral`.
    Em corrida (duas chamadas simultâneas), insere apenas os itens faltantes:
    o UNIQUE(os_id, classificacao) protege e a violação de unicidade é tratada
    como sucesso (o concorrente já gravou).

    O.S com `checklist_dispensado` (retroativa) NUNCA gera itens — inclusive
    nas leituras que chamam `garantir_snapshot`.
    """
    os_row = db.table("ordens_servico").select("tipo, checklist_dispensado").eq("id", os_id).execute().data
    if os_row and os_row[0].get("checklist_dispensado"):
        return
    tipo_os = (os_row[0].get("tipo") if os_row else None) or "construcao"
    if tipo_os not in TIPOS_OS:
        tipo_os = "construcao"

    modelos = _modelos_para_snapshot(db, tipo_os)
    if not modelos:
        return

    existentes = db.table("os_checklist_itens").select("classificacao").eq("os_id", os_id).execute().data or []
    presentes = {i["classificacao"] for i in existentes}

    # Uma linha por classificação (o catálogo não repete dentro do mesmo tipo;
    # entre iguais, vale o primeiro da ordenação grupo/ordem).
    linhas: list[dict] = []
    vistas: set[str] = set()
    for m in modelos:
        classificacao = m["classificacao"]
        if classificacao in presentes or classificacao in vistas:
            continue
        vistas.add(classificacao)
        linhas.append(
            {
                "os_id": os_id,
                "modelo_id": m["id"],
                "grupo": m["grupo"],
                "ordem": m["ordem"],
                "classificacao": classificacao,
                "pergunta": m["pergunta"],
                "exige_foto": bool(m.get("exige_foto", False)),
            }
        )
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


def _tipo_da_os(db, os_id: int) -> str:
    os_row = db.table("ordens_servico").select("tipo").eq("id", os_id).execute().data
    tipo_os = (os_row[0].get("tipo") if os_row else None) or "construcao"
    return tipo_os if tipo_os in TIPOS_OS else "construcao"


def resumo_checklist(db, os_id: int) -> dict:
    """Contagem de respondidos por grupo + flags de liberação."""
    tipo_os = _tipo_da_os(db, os_id)
    itens = itens_com_respostas(db, os_id)
    total = len(itens)
    respondidos = sum(1 for i in itens if i.get("resposta"))
    nomes, liberacao = config_grupos_do_snapshot(db, tipo_os, itens)

    grupos = []
    for g in sorted({i["grupo"] for i in itens}):
        do_grupo = [i for i in itens if i.get("grupo") == g]
        resp_grupo = [i for i in do_grupo if i.get("resposta")]
        grupos.append(
            {
                "grupo": g,
                "nome": nomes.get(g, f"Grupo {g}"),
                "total": len(do_grupo),
                "respondidos": len(resp_grupo),
                "completo": bool(do_grupo) and len(resp_grupo) == len(do_grupo),
            }
        )

    # Sem itens cadastrados = recurso não configurado: não bloqueia nada.
    de_liberacao = [g for g in grupos if g["grupo"] in liberacao]
    inicio_liberado = all(g["total"] == 0 or g["completo"] for g in de_liberacao)
    completo = total == 0 or respondidos == total

    return {
        "total": total,
        "respondidos": respondidos,
        "completo": completo,
        "inicio_liberado": inicio_liberado,
        "grupos_liberacao": list(liberacao),
        "grupos": grupos,
    }


def mensagem_gate_inicio(resumo: dict) -> str:
    """Mensagem do gate de início citando os grupos de liberação pendentes."""
    liberacao = set(resumo.get("grupos_liberacao") or (GRUPO_LIBERACAO_INICIO,))
    pendentes = [g for g in resumo["grupos"] if g["grupo"] in liberacao and not g["completo"]]
    detalhes = "; ".join(
        f"Grupo {g['grupo']} - {g['nome']}: {g['respondidos']}/{g['total']} respondidos" for g in pendentes
    )
    return f"O checklist de início precisa estar completo para liberar a execução. {detalhes}".strip()


def pendentes_para_conclusao(db, os_id: int) -> list[str]:
    """Descrição curta dos itens ainda não respondidos (para mensagens de erro)."""
    itens = itens_com_respostas(db, os_id)
    return [f"{i['classificacao']} {i['pergunta']}" for i in itens if not i.get("resposta")]
