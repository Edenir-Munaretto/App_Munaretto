"""Limpeza dos catálogos de serviços (produtos) após a separação por contrato.

Contexto: os contratos (construcao/manutencao/linha_viva) passaram a ter
catálogos INDEPENDENTES. Importações antigas (catálogo único/família) deixaram
resíduos possíveis no banco:

  - Serviços LEGADOS (tipo NULL) — sobras da época de catálogo único;
  - DUPLICATAS dentro do MESMO contrato (mesmo código/contrato) — resíduo de
    migração/conversões anteriores (o cadastro atual impede criar isso);
  - Serviços de CONSTRUÇÃO cujo código também existe nos catálogos de
    manutenção E linha viva — provavelmente itens da família absorvidos como
    construção numa importação antiga (flag --limpar-construcao-suspeita).

Nada é apagado do histórico: os itens limpos são apenas INATIVADOS
(ativo = false), preservando O.S./lançamentos já gravados.

COMO USAR (a partir da pasta backend, com as envs do Supabase carregadas):
  python scripts/limpar_catalogos_produtos.py                         # relatório geral
  python scripts/limpar_catalogos_produtos.py --limpar-legados        # simula a limpeza
  python scripts/limpar_catalogos_produtos.py --limpar-legados --aplicar
  python scripts/limpar_catalogos_produtos.py --limpar-duplicados --aplicar
  python scripts/limpar_catalogos_produtos.py --limpar-construcao-suspeita --aplicar
  # combinar tudo:
  python scripts/limpar_catalogos_produtos.py \
      --limpar-legados --limpar-duplicados --limpar-construcao-suspeita --aplicar
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from supabase_client import get_supabase  # noqa: E402

TAMANHO_PAGINA = 1000
TIPOS = ("construcao", "manutencao", "linha_viva")


def _listar_todos(db):
    """Lê TODOS os produtos (ativos e inativos), paginando (PostgREST ~1000)."""
    dados = []
    offset = 0
    while True:
        pagina = (
            db.table("produtos")
            .select("id, nome, codigo, codigo_especial, tipo, ativo")
            .order("id")
            .range(offset, offset + TAMANHO_PAGINA - 1)
            .execute()
            .data
        )
        dados.extend(pagina)
        if len(pagina) < TAMANHO_PAGINA:
            break
        offset += TAMANHO_PAGINA
    return dados


def _relatorio_geral(registros):
    print("\n=== RELATÓRIO GERAL ===")
    contagem = {}
    for p in registros:
        chave = (p.get("tipo") or "legado (sem tipo)", bool(p.get("ativo")))
        contagem[chave] = contagem.get(chave, 0) + 1
    for (tipo, ativo), qtd in sorted(contagem.items()):
        print(f"  {tipo:<22} {'ativo' if ativo else 'inativo':<9} {qtd}")

    # Duplicidade entre contratos (esperado entre m/lv após reimportação — informativo).
    por_codigo = {}
    for p in registros:
        if p.get("codigo"):
            por_codigo.setdefault(p["codigo"], set()).add(p.get("tipo") or "legado")
    multi = {c: ts for c, ts in por_codigo.items() if len(ts) > 1}
    print(f"\nCódigos presentes em mais de um contrato: {len(multi)} (esperado para m/lv)")
    if multi:
        amostra = sorted(multi)[:15]
        for c in amostra:
            print(f"  {c}: {', '.join(sorted(multi[c]))}")
        if len(multi) > 15:
            print(f"  ... e mais {len(multi) - 15}.")

    # Construção com o mesmo código também em manutenção E linha viva (suspeitos).
    suspeitos = []
    codigos_manutencao = {p["codigo"] for p in registros if p.get("tipo") == "manutencao" and p.get("codigo")}
    codigos_linha_viva = {p["codigo"] for p in registros if p.get("tipo") == "linha_viva" and p.get("codigo")}
    for p in registros:
        if (
            p.get("ativo")
            and p.get("tipo") == "construcao"
            and p.get("codigo") in codigos_manutencao
            and p["codigo"] in codigos_linha_viva
        ):
            suspeitos.append(p)
    print(
        f"\nConstrução com código TAMBÉM em manutenção e linha viva (prováveis itens "
        f"da família absorvidos como construção): {len(suspeitos)} — revise antes de decidir"
    )
    for p in sorted(suspeitos, key=lambda x: x["id"])[:20]:
        print(f"  #{p['id']} [{p['codigo']}] {p['nome']}")
    if len(suspeitos) > 20:
        print(f"  ... e mais {len(suspeitos) - 20}.")
    return suspeitos


def _duplicados_mesmo_contrato(registros):
    """Duplicatas dentro do mesmo contrato (ou entre legados) por código."""
    grupos = {}
    for p in registros:
        if not p.get("codigo"):
            continue
        chave = (p.get("tipo"), p["codigo"])
        grupos.setdefault(chave, []).append(p)
    return {chave: linhas for chave, linhas in grupos.items() if len(linhas) > 1}


def _legados(registros):
    return [p for p in registros if p.get("tipo") is None and p.get("ativo")]


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--limpar-legados", action="store_true",
                        help="Inativa serviços sem contrato (tipo NULL) remanescentes.")
    parser.add_argument("--limpar-duplicados", action="store_true",
                        help="Inativa duplicatas dentro do MESMO contrato (mantém a mais recente).")
    parser.add_argument("--limpar-construcao-suspeita", action="store_true",
                        help="Inativa serviços de Construção cujo código também existe (ativo) "
                             "nos catálogos de manutenção E linha viva (resíduo da família absorvido).")
    parser.add_argument("--aplicar", action="store_true",
                        help="Grava as inativações (sem esta flag, apenas simula).")
    args = parser.parse_args()

    db = get_supabase()
    registros = _listar_todos(db)
    print(f"Produtos lidos (ativos e inativos): {len(registros)}")

    suspeitos = _relatorio_geral(registros)

    legados = _legados(registros)
    duplicados = _duplicados_mesmo_contrato(registros)

    acoes = [args.limpar_legados, args.limpar_duplicados, args.limpar_construcao_suspeita]
    if not any(acoes):
        print(
            "\nNenhuma ação solicitada (use --limpar-legados, --limpar-duplicados e/ou "
            "--limpar-construcao-suspeita). Use --aplicar para gravar. Nada foi alterado."
        )
        return

    plano = []
    if args.limpar_legados:
        for p in legados:
            plano.append(("inativar legado", p))
        print(f"\n[plano] Legados (tipo NULL) a inativar: {len(legados)}")
        for p in legados[:20]:
            print(f"  #{p['id']} [{p['codigo'] or p['codigo_especial'] or 'sem código'}] {p['nome']}")
        if len(legados) > 20:
            print(f"  ... e mais {len(legados) - 20}.")

    if args.limpar_duplicados:
        a_inativar = []
        for chave, linhas in duplicados.items():
            manter = max(linhas, key=lambda p: p["id"])
            for p in linhas:
                if p["id"] != manter["id"]:
                    a_inativar.append((chave, p))
        print(f"\n[plano] Duplicatas no mesmo contrato a inativar: {len(a_inativar)}")
        for chave, p in a_inativar[:20]:
            print(f"  #{p['id']} (contrato {chave[0]}, código {chave[1]}) {p['nome']}")
        if len(a_inativar) > 20:
            print(f"  ... e mais {len(a_inativar) - 20}.")
        plano.extend(("inativar duplicado", p) for _, p in a_inativar)

    if args.limpar_construcao_suspeita:
        print(f"\n[plano] Construção absorvida (código também em manutenção E linha viva) a inativar: {len(suspeitos)}")
        for p in suspeitos[:20]:
            print(f"  #{p['id']} [{p['codigo']}] {p['nome']}")
        if len(suspeitos) > 20:
            print(f"  ... e mais {len(suspeitos) - 20}.")
        plano.extend(("inativar construção suspeita", p) for p in suspeitos)

    if not args.aplicar:
        print("\nSimulação concluída — nada foi gravado. Rode com --aplicar para efetivar.")
        return

    executadas = 0
    for _, produto in plano:
        db.table("produtos").update({"ativo": False}).eq("id", produto["id"]).execute()
        executadas += 1
    print(f"\n{executadas} registro(s) inativado(s).")

    restantes = suspeitos if not args.limpar_construcao_suspeita else []
    if restantes:
        print(
            f"\nLEMBRETE: {len(restantes)} serviço(s) de CONSTRUÇÃO parecem ser itens da "
            "família manutenção/linha viva (mesmo código nos dois catálogos). NÃO foram "
            "tocados por segurança — revise a lista acima e decida manualmente, ou rode "
            "com --limpar-construcao-suspeita --aplicar."
        )


if __name__ == "__main__":
    main()
