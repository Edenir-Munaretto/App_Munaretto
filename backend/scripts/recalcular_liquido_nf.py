"""Recalcula o Valor Líquido das Notas Fiscais (Valor Total - INSS - ISS).

COMO USAR (a partir da pasta backend, com as envs do Supabase carregadas):
  python scripts/recalcular_liquido_nf.py              # simulação (não grava)
  python scripts/recalcular_liquido_nf.py --aplicar    # grava as diferenças
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from supabase_client import get_supabase

TAMANHO_PAGINA = 1000


def _numero(valor) -> float:
    return float(valor or 0)


def _calcular_liquido(nf: dict) -> float:
    return round(
        _numero(nf.get("valor_total")) - _numero(nf.get("valor_inss")) - _numero(nf.get("valor_iss")),
        2,
    )


def _notas_fiscais(db):
    offset = 0
    while True:
        pagina = (
            db.table("comprovantes")
            .select("id,numero_nf,nome,valor_total,valor_inss,valor_iss,valor_liquido")
            .eq("tipo_documento", "Nota Fiscal")
            .order("id")
            .range(offset, offset + TAMANHO_PAGINA - 1)
            .execute()
            .data
        )
        yield from pagina
        if len(pagina) < TAMANHO_PAGINA:
            break
        offset += TAMANHO_PAGINA


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--aplicar", action="store_true", help="Grava as diferenças (sem a flag, apenas simula).")
    args = parser.parse_args()

    db = get_supabase()
    divergentes = []

    for nf in _notas_fiscais(db):
        calculado = _calcular_liquido(nf)
        atual = nf.get("valor_liquido")
        if atual is None or abs(_numero(atual) - calculado) > 0.005:
            divergentes.append((nf, calculado))

    print(f"Notas Fiscais com líquido divergente: {len(divergentes)}")
    for nf, calculado in divergentes[:20]:
        identificacao = nf.get("numero_nf") or nf.get("nome") or "-"
        print(
            f"  id={nf['id']} nf={identificacao} "
            f"atual={_numero(nf.get('valor_liquido')):.2f} calculado={calculado:.2f}"
        )
    if len(divergentes) > 20:
        print(f"  ... e mais {len(divergentes) - 20} registro(s).")

    if not divergentes:
        return
    if not args.aplicar:
        print("Simulação: rode com --aplicar para gravar as diferenças.")
        return

    for nf, calculado in divergentes:
        db.table("comprovantes").update({"valor_liquido": calculado}).eq("id", nf["id"]).execute()
    print(f"{len(divergentes)} registro(s) atualizado(s).")


if __name__ == "__main__":
    main()
