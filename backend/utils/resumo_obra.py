"""Consolidação por Obra (Fase 1 da gestão consolidada por obra).

Agrega os lançamentos de serviços das O.S de uma obra separando por contrato
(tipo da O.S) e por serviço — base do endpoint de resumo da obra e dos
relatórios PDF. A quantidade já vem convertida para a unidade do contrato
(USC/ULV) no lançamento (`quantidade_usada` = peças x fator), então os totais
aqui já estão na unidade certa de cada contrato.

Regras de produto definidas para a Fase 1:
- "Em execução" NÃO inclui `rascunho`; "Encerradas" = concluída + cancelada;
- Rascunho só entra no filtro "Todas";
- O "total aplicado" da obra (cards/painel) considera Em execução + concluídas
  (rascunho não começou; cancelada não consome o contrato).
"""

from collections import defaultdict

from utils.tipos_os import ORDEM_CONTRATOS, unidade_contrato

# Grupos de status da gestão por obra (espelham a semântica do módulo O.S).
STATUS_EM_EXECUCAO = ("aberta", "em_andamento", "impedida")
STATUS_ENCERRADAS = ("concluida", "cancelada")

# Status que entram no total aplicado exibido nos cards/painel da obra.
STATUS_PARA_TOTAIS = (*STATUS_EM_EXECUCAO, "concluida")

# Ordem canônica dos status (por_status dos resumos).
ORDEM_STATUS = ("rascunho", *STATUS_EM_EXECUCAO, *STATUS_ENCERRADAS)


def _numero(valor) -> float:
    """Número tolerante a strings/Nones vindos do PostgREST (decimal como str)."""
    try:
        return float(valor or 0)
    except (TypeError, ValueError):
        return 0.0


def _consultar_lancamentos(db, os_ids: list[int]) -> list[dict]:
    """Única consulta em `os_materiais` para o conjunto de O.S."""
    if not os_ids:
        return []
    resp = (
        db.table("os_materiais")
        .select("os_id, produto_id, quantidade_usada, quantidade_pecas, fator_usc, tipo_usc, codigo_servico")
        .in_("os_id", os_ids)
        .execute()
    )
    return resp.data or []


def _consultar_catalogo(db, produto_ids: list[int]) -> dict[int, dict]:
    """Catálogo (produtos) em uma consulta — nome/unidade por produto."""
    produto_ids = list(dict.fromkeys(pid for pid in produto_ids if pid is not None))
    if not produto_ids:
        return {}
    resp = db.table("produtos").select("id, nome, unidade").in_("id", produto_ids).execute()
    return {p["id"]: p for p in (resp.data or [])}


def agregar_servicos(db, os_linhas: list[dict], lancamentos: list[dict] | None = None) -> list[dict]:
    """Agrega os serviços aplicados das O.S por contrato (tipo da O.S).

    - `os_linhas`: linhas das O.S com pelo menos `os_id` e `tipo` (contrato);
    - `lancamentos` (opcional): linhas de `os_materiais` já carregadas pelo
      chamador (evita a segunda consulta quando o endpoint já as tem);
    - retorna `[{tipo, unidade, total, itens}]`, ordenado pelos contratos
      canônicos; itens agrupados por serviço (produto + snapshot do código +
      desdobramento normal/especial) com `pecas`, `total` e `os_usadas`
      (nº de O.S distintas com aquele serviço).
    """
    os_por_id = {r["os_id"]: r for r in os_linhas}
    if not os_por_id:
        return []

    if lancamentos is None:
        lancamentos = _consultar_lancamentos(db, list(os_por_id))
    if not lancamentos:
        return []

    catalogo = _consultar_catalogo(db, [lanc.get("produto_id") for lanc in lancamentos])

    grupos: dict[tuple, dict] = {}
    for lanc in lancamentos:
        os_row = os_por_id.get(lanc.get("os_id"))
        if os_row is None:
            continue
        contrato = os_row.get("tipo") or "construcao"
        tipo_lanc = str(lanc.get("tipo_usc") or "normal").strip().lower() or "normal"
        codigo = str(lanc.get("codigo_servico") or "").strip() or None
        chave = (contrato, lanc.get("produto_id"), tipo_lanc, codigo)
        grupo = grupos.setdefault(chave, {"os_ids": set(), "pecas": 0.0, "total": 0.0})
        grupo["os_ids"].add(lanc.get("os_id"))
        grupo["pecas"] += _numero(lanc.get("quantidade_pecas"))
        grupo["total"] += _numero(lanc.get("quantidade_usada"))

    itens_por_contrato: dict[str, list[dict]] = defaultdict(list)
    for (contrato, produto_id, tipo_lanc, codigo), grupo in grupos.items():
        prod = catalogo.get(produto_id) or {} if produto_id else {}
        itens_por_contrato[contrato].append(
            {
                "produto_id": produto_id,
                "nome": prod.get("nome") or "Serviço",
                "unidade": prod.get("unidade") or "UN",
                "codigo_servico": codigo,
                "tipo": tipo_lanc,
                "pecas": round(grupo["pecas"], 3),
                "total": round(grupo["total"], 3),
                "os_usadas": len(grupo["os_ids"]),
            }
        )

    contratos: list[dict] = []
    ordens = list(ORDEM_CONTRATOS) + [t for t in itens_por_contrato if t not in ORDEM_CONTRATOS]
    for contrato in ordens:
        itens = itens_por_contrato.get(contrato)
        if not itens:
            continue
        itens.sort(
            key=lambda i: (
                i["tipo"] != "normal",
                (i["codigo_servico"] or "").upper(),
                (i["nome"] or "").upper(),
            )
        )
        contratos.append(
            {
                "tipo": contrato,
                "unidade": unidade_contrato(contrato),
                "total": round(sum(i["total"] for i in itens), 3),
                "itens": itens,
            }
        )
    return contratos
