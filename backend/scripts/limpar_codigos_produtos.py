"""Corrige códigos de serviços (produtos) gravados com defeito por importação.

Histórico do problema:
- O catálogo era importado de planilhas onde células numéricas do Excel
  chegavam como float (ex.: 75012300000000.0) e eram gravadas com o sufixo
  ".0" (75012300000000.0), quebrando a busca/bipagem exata.
- Espaços nas bordas também podem ter sido gravados.

Este script normaliza codigo e codigo_especial (removendo ".0" e espaços) e
relata códigos apenas numéricos curtos, que podem ter perdido ZEROS À
ESQUERDA no Excel (ex.: "0412" virou "412") — esses NÃO podem ser corrigidos
automaticamente e precisam de conferência manual na planilha original.

COMO USAR (a partir da pasta backend, com as envs do Supabase carregadas):
  python scripts/limpar_codigos_produtos.py            # simulação (não grava)
  python scripts/limpar_codigos_produtos.py --aplicar  # grava as correções
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from supabase_client import get_supabase  # noqa: E402

TAMANHO_PAGINA = 1000


def _texto_normalizado(valor):
    """Mesma normalização da importação: numérico integral vira texto sem '.0'."""
    if valor is None:
        return None
    if isinstance(valor, float) and valor.is_integer():
        valor = int(valor)
    texto = str(valor).strip()
    return texto or None


def _listar_todos(db):
    """Pagina a leitura de todos os serviços ativos (PostgREST limita a ~1000)."""
    dados = []
    offset = 0
    while True:
        pagina = (
            db.table("produtos")
            .select("id, nome, codigo, codigo_especial")
            .eq("ativo", True)
            .order("nome")
            .range(offset, offset + TAMANHO_PAGINA - 1)
            .execute()
            .data
        )
        dados.extend(pagina)
        if len(pagina) < TAMANHO_PAGINA:
            break
        offset += TAMANHO_PAGINA
    return dados


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--aplicar",
        action="store_true",
        help="Grava as correções no banco (sem esta flag, apenas simula).",
    )
    args = parser.parse_args()

    db = get_supabase()
    registros = _listar_todos(db)
    print(f"Serviços ativos lidos: {len(registros)}")

    mudancas = []
    candidatos_zeros = []
    for p in registros:
        linha = {"id": p["id"], "nome": p.get("nome") or ""}
        campos = {}
        for campo in ("codigo", "codigo_especial"):
            atual = _texto_normalizado(p.get(campo))
            # Candidatos a zeros à esquerda perdidos: numéricos puros e curtos.
            if atual and atual.isdigit() and len(atual) <= 12:
                candidatos_zeros.append((p["id"], p.get("nome"), campo, atual))
            bruto = p.get(campo)
            if bruto != atual:
                campos[campo] = atual
        if campos:
            mudancas.append({**linha, **campos})

    if not mudancas:
        print("Nenhum código com '.0'/espaços encontrado.")
    else:
        print(f"\nCódigos a corrigir ('.0'/espaços): {len(mudancas)}")
        for m in mudancas[:40]:
            print(
                f"  #{m['id']} {m['nome'][:60]!r}: "
                + ", ".join(f"{c}='{m[c]}'" for c in ("codigo", "codigo_especial") if c in m)
            )
        if len(mudancas) > 40:
            print(f"  ... e mais {len(mudancas) - 40}.")

        if args.aplicar:
            for m in mudancas:
                payload = {c: v for c, v in m.items() if c in ("codigo", "codigo_especial")}
                db.table("produtos").update(payload).eq("id", m["id"]).execute()
            print(f"\n{len(mudancas)} registro(s) atualizado(s).")

    if candidatos_zeros:
        unicos = sorted({c for _, _, _, c in candidatos_zeros})
        print(
            f"\nATENÇÃO — {len(candidatos_zeros)} código(s) apenas numéricos (curtos) "
            "podem ter perdido zeros à esquerda no Excel e NÃO são corrigíveis "
            "automaticamente. Confira na planilha original (ex.: '0412' virou '412')."
        )
        print("Amostra (até 40):")
        for codigo in unicos[:40]:
            print(f"  - {codigo}")
    else:
        print("\nNenhum código numérico curto suspeito de zeros à esquerda.")


if __name__ == "__main__":
    main()
