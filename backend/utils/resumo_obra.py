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
STATUS_EM_EXECUCAO = ("aberta", "em_andamento")
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


# PostgREST/Supabase devolvem no máximo ~1000 linhas por requisição; os IDs vão
# em lotes para não estourar o tamanho da URL do filtro `in.()`.
TAMANHO_PAGINA = 1000
TAMANHO_LOTE_IDS = 200


def _em_lotes(itens: list, tamanho: int = TAMANHO_LOTE_IDS):
    """Fatia uma lista em lotes (usado nos filtros `in_` do PostgREST)."""
    for inicio in range(0, len(itens), tamanho):
        yield itens[inicio : inicio + tamanho]


def _ler_paginado(base, tamanho: int = TAMANHO_PAGINA) -> list[dict]:
    """Lê TODAS as linhas de uma query, paginando pelo teto do PostgREST."""
    dados: list[dict] = []
    offset = 0
    while True:
        pagina = base.range(offset, offset + tamanho - 1).execute().data or []
        dados.extend(pagina)
        if len(pagina) < tamanho:
            break
        offset += tamanho
    return dados


def _consultar_lancamentos(db, os_ids: list[int]) -> list[dict]:
    """Consulta em `os_materiais` para o conjunto de O.S (lotes + paginação)."""
    ids = list(dict.fromkeys(os_ids))
    if not ids:
        return []
    lancamentos: list[dict] = []
    for lote in _em_lotes(ids):
        base = (
            db.table("os_materiais")
            .select("os_id, produto_id, quantidade_usada, quantidade_pecas, fator_usc, tipo_usc, codigo_servico")
            .in_("os_id", lote)
        )
        lancamentos.extend(_ler_paginado(base))
    return lancamentos


def contar_fotos_por_os(db, os_ids: list[int]) -> dict[int, int]:
    """Quantidade de fotos por O.S (lotes + paginação)."""
    ids = list(dict.fromkeys(os_ids))
    if not ids:
        return {}
    contagem: dict[int, int] = {}
    for lote in _em_lotes(ids):
        base = db.table("os_fotos").select("os_id").in_("os_id", lote)
        for foto in _ler_paginado(base):
            contagem[foto["os_id"]] = contagem.get(foto["os_id"], 0) + 1
    return contagem


def _consultar_catalogo(db, produto_ids: list[int]) -> dict[int, dict]:
    """Catálogo (produtos) por produto — lotes + paginação (nome/unidade)."""
    ids = list(dict.fromkeys(pid for pid in produto_ids if pid is not None))
    if not ids:
        return {}
    catalogo: dict[int, dict] = {}
    for lote in _em_lotes(ids):
        base = db.table("produtos").select("id, nome, unidade").in_("id", lote)
        for produto in _ler_paginado(base):
            catalogo[produto["id"]] = produto
    return catalogo


def agregar_servicos(
    db,
    os_linhas: list[dict],
    lancamentos: list[dict] | None = None,
) -> list[dict]:
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
        grupo = grupos.setdefault(chave, {"os_ids": set(), "pecas": 0.0, "total": 0.0, "fatores": set()})
        grupo["os_ids"].add(lanc.get("os_id"))
        grupo["pecas"] += _numero(lanc.get("quantidade_pecas"))
        grupo["total"] += _numero(lanc.get("quantidade_usada"))
        if _numero(lanc.get("fator_usc")) > 0:
            grupo["fatores"].add(round(_numero(lanc.get("fator_usc")), 3))

    itens_por_contrato: dict[str, list[dict]] = defaultdict(list)
    for (contrato, produto_id, tipo_lanc, codigo), grupo in grupos.items():
        prod = catalogo.get(produto_id) or {} if produto_id else {}
        # Fator exibível (ex.: "USC unit."): só quando TODOS os lançamentos do
        # grupo usam o mesmo fator — caso contrário o valor agregado é misto.
        fatores = grupo["fatores"]
        fator = next(iter(fatores)) if len(fatores) == 1 else None
        itens_por_contrato[contrato].append(
            {
                "produto_id": produto_id,
                "nome": prod.get("nome") or "Serviço",
                "unidade": prod.get("unidade") or "UN",
                "codigo_servico": codigo,
                "tipo": tipo_lanc,
                "pecas": round(grupo["pecas"], 3),
                "fator": fator,
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
