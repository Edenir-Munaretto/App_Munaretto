"""Remove registros antigos da tabela `sync_ops` (idempotência do Modo Campo).

A tabela cresce a cada operação sincronizada e só é consultada na janela de
reenvio (o tablet sincroniza no mesmo dia). Manter os últimos N dias evita
crescimento indefinido no Supabase.

COMO USAR (a partir da pasta backend, com as envs do Supabase carregadas):
  python scripts/limpar_sync_ops.py                  # simulação (não apaga)
  python scripts/limpar_sync_ops.py --aplicar        # apaga os antigos
  python scripts/limpar_sync_ops.py --dias 60 --aplicar
"""

import argparse
import os
import sys
from datetime import UTC, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from supabase_client import get_supabase

TAMANHO_PAGINA = 1000
LOTE_DELETE = 200


def _ids_antigos(db, corte_iso: str) -> list[int]:
    """Ids com criado_servidor anterior ao corte (paginado)."""
    ids: list[int] = []
    offset = 0
    while True:
        pagina = (
            db.table("sync_ops")
            .select("id")
            .lt("criado_servidor", corte_iso)
            .order("id")
            .range(offset, offset + TAMANHO_PAGINA - 1)
            .execute()
            .data
        )
        ids.extend(r["id"] for r in pagina)
        if len(pagina) < TAMANHO_PAGINA:
            break
        offset += TAMANHO_PAGINA
    return ids


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dias", type=int, default=30, help="Retenção em dias (padrão: 30).")
    parser.add_argument("--aplicar", action="store_true", help="Apaga de verdade (sem a flag, apenas simula).")
    args = parser.parse_args()

    corte = datetime.now(UTC) - timedelta(days=max(1, args.dias))
    corte_iso = corte.isoformat()

    db = get_supabase()
    ids = _ids_antigos(db, corte_iso)
    print(f"sync_ops anteriores a {corte_iso}: {len(ids)}")
    if not ids:
        return
    if not args.aplicar:
        print("Simulação: rode com --aplicar para remover.")
        return

    removidos = 0
    for i in range(0, len(ids), LOTE_DELETE):
        lote = ids[i : i + LOTE_DELETE]
        db.table("sync_ops").delete().in_("id", lote).execute()
        removidos += len(lote)
    print(f"{removidos} registro(s) removido(s).")


if __name__ == "__main__":
    main()
