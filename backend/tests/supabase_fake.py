"""Mock do cliente Supabase para testes.

Simula a API encadeada do supabase-py (table/select/eq/neq/ilike/order/
insert/update/delete/limit/execute) sobre um dicionário em memória, de forma
que os routers da API possam ser testados sem conexão externa.
"""

from dataclasses import dataclass

# Relógio monotônico do fake: emula o trigger `updated_at` da tabela produtos,
# usado pelo endpoint de versão do catálogo do Modo Campo.
_TIMESTAMP_FAKE = [0]


def _proximo_timestamp() -> str:
    _TIMESTAMP_FAKE[0] += 1
    return f"2026-01-01T00:00:{_TIMESTAMP_FAKE[0] % 60:02d}.{_TIMESTAMP_FAKE[0]:04d}Z"


@dataclass
class _Resposta:
    data: list
    count: int = 0

    def execute(self):
        return self

    def __iter__(self):
        return iter(self.data)


class _Query:
    def __init__(self, tabela, dados, filtros=None, ordenacao=None, limite=None, range_=None):
        self.tabela = tabela
        self.dados = dados
        self.filtros = filtros or []
        self.ordenacao = ordenacao
        self.limite = limite
        self.range_ = range_
        self._update_payload = None
        self._delete = False
        self._negar_proximo = False  # postgrest: not_ é property que nega o PRÓXIMO filtro
        self._count_exact = False  # select(..., count="exact") -> header Prefer count=exact

    def select(self, *args, **kwargs):
        # PostgREST: select(..., count="exact") conta TODAS as linhas do filtro
        # (sem aplicar range/limit), devolvendo o total no campo `count`.
        if kwargs.get("count") == "exact":
            self._count_exact = True
        return self

    @property
    def not_(self):
        """Nega o próximo filtro aplicado (API do supabase-py atual)."""
        self._negar_proximo = True
        return self

    def _registrar(self, op, coluna, valor):
        if self._negar_proximo:
            self._negar_proximo = False
            op = {"eq": "neq", "neq": "eq", "ilike": "not_ilike", "isnull": "isnotnull", "in": "not_in"}.get(op, op)
        self.filtros.append((op, coluna, valor))
        return self

    def eq(self, coluna, valor):
        return self._registrar("eq", coluna, valor)

    def neq(self, coluna, valor):
        return self._registrar("neq", coluna, valor)

    def ilike(self, coluna, valor):
        return self._registrar("ilike", coluna, valor)

    def like(self, coluna, valor):
        return self._registrar("ilike", coluna, valor)

    def gte(self, coluna, valor):
        return self._registrar("gte", coluna, valor)

    def lte(self, coluna, valor):
        return self._registrar("lte", coluna, valor)

    def in_(self, coluna, valores):
        return self._registrar("in", coluna, list(valores))

    def is_(self, coluna, valor):
        # No PostgREST o valor chega como string "null"; valor None também
        # significa "is null".
        if valor is None or (isinstance(valor, str) and valor.lower() == "null"):
            return self._registrar("isnull", coluna, True)
        return self._registrar("eq", coluna, valor)

    def or_(self, expressao):
        """Suporta o formato usado pelos routers: 'col.op.valor,col.op.valor'
        com operadores ilike/eq (ex.: busca de clientes e de O.S)."""
        self.filtros.append(("or", expressao))
        return self

    def limit(self, n):
        self.limite = n
        return self

    def range(self, inicio, fim):
        self.range_ = (inicio, fim)
        return self

    def order(self, coluna, **kwargs):
        self.ordenacao = (coluna, kwargs.get("desc", False))
        return self

    def _aplica(self, com_paginacao=True):
        linhas = self.dados[self.tabela]
        for filtro in self.filtros:
            if filtro[0] == "or":
                linhas = self._aplica_or(linhas, filtro[1])
                continue
            op, coluna, valor = filtro
            if op == "eq":
                linhas = [r for r in linhas if r.get(coluna) == valor]
            elif op == "neq":
                linhas = [r for r in linhas if r.get(coluna) != valor]
            elif op == "ilike":
                termo = str(valor).replace("%", "").lower()
                linhas = [r for r in linhas if termo in str(r.get(coluna, "")).lower()]
            elif op == "not_ilike":
                termo = str(valor).replace("%", "").lower()
                linhas = [r for r in linhas if termo not in str(r.get(coluna, "")).lower()]
            elif op == "in":
                linhas = [r for r in linhas if r.get(coluna) in valor]
            elif op == "not_in":
                linhas = [r for r in linhas if r.get(coluna) not in valor]
            elif op == "isnull":
                linhas = [r for r in linhas if r.get(coluna) is None]
            elif op == "isnotnull":
                linhas = [r for r in linhas if r.get(coluna) is not None]
            elif op == "gte":
                # Comparação lexicográfica de ISO (AAAA-MM-DD...): NULL fica fora,
                # como no SQL.
                linhas = [r for r in linhas if r.get(coluna) is not None and str(r.get(coluna)) >= str(valor)]
            elif op == "lte":
                linhas = [r for r in linhas if r.get(coluna) is not None and str(r.get(coluna)) <= str(valor)]
        if self.ordenacao:
            coluna, desc = self.ordenacao
            linhas = sorted(linhas, key=lambda r: str(r.get(coluna, "")), reverse=desc)
        if not com_paginacao:
            return list(linhas)
        if self.limite is not None:
            linhas = linhas[: self.limite]
        if self.range_ is not None:
            inicio, fim = self.range_
            linhas = linhas[inicio : fim + 1]
        return list(linhas)

    def _aplica_or(self, linhas, valor):
        """Resolve o filtro `or` com suporte a caminhos aninhados
        (ex.: 'obras.clientes.nome.ilike.%termo%') e ao operador `in`
        (ex.: 'obra_id.in.(1,2,3)')."""
        termos = []
        for parte in self._dividir_virgulas(str(valor)):
            pedacos = parte.split(".")
            if len(pedacos) < 3:
                continue
            bruto = pedacos[-1]
            operador = pedacos[-2]
            coluna = ".".join(pedacos[:-2])
            termos.append((coluna, operador, bruto))
        if not termos:
            return linhas

        def _valor_aninhado(linha, caminho):
            atual = linha
            for parte in caminho.split("."):
                if not isinstance(atual, dict) or parte not in atual:
                    return ""
                atual = atual[parte]
            return str(atual)

        def _casa_ou(r, termos=termos):
            for col, operador, bruto in termos:
                valor_campo = _valor_aninhado(r, col).lower()
                if operador == "in":
                    itens = [i.strip() for i in bruto.strip("()").split(",")]
                    if any(v in valor_campo for v in itens):
                        return True
                else:
                    termo = bruto.replace("%", "").lower()
                    if termo in valor_campo:
                        return True
            return False

        return [r for r in linhas if _casa_ou(r)]

    @staticmethod
    def _dividir_virgulas(texto):
        """Divide por vírgulas ignorando as que estão dentro de parênteses
        (ex.: 'obra_id.in.(1,2)' permanece como um único termo)."""
        partes = []
        atual = ""
        profundidade = 0
        for ch in texto:
            if ch == "(":
                profundidade += 1
            elif ch == ")":
                profundidade -= 1
            if ch == "," and profundidade == 0:
                partes.append(atual)
                atual = ""
            else:
                atual += ch
        if atual:
            partes.append(atual)
        return partes

    def insert(self, payload, **kwargs):
        if isinstance(payload, dict):
            payload = [payload]
        self.dados[self.tabela] = self.dados.get(self.tabela, [])
        criados = []
        for item in payload:
            novo = dict(item)
            novo["id"] = max((r["id"] for r in self.dados[self.tabela]), default=0) + 1
            if self.tabela == "produtos" and not novo.get("updated_at"):
                novo["updated_at"] = _proximo_timestamp()
            self.dados[self.tabela].append(novo)
            criados.append(novo)
        return _Resposta(criados)

    def upsert(self, payload, on_conflict=None, **kwargs):
        """Insere ou atualiza linhas com base na chave de conflito.

        `on_conflict` aceita uma coluna ou várias separadas por vírgula
        (ex.: 'dispositivo,id_local' — UNIQUE composta, como na sync_ops)."""
        if isinstance(payload, dict):
            payload = [payload]
        self.dados[self.tabela] = self.dados.get(self.tabela, [])
        chaves = [c.strip() for c in on_conflict.split(",")] if on_conflict else None
        atualizados = []
        for item in payload:
            alvo = None
            if chaves:
                for r in self.dados[self.tabela]:
                    if all(r.get(k) == item.get(k) for k in chaves):
                        alvo = r
                        break
            if alvo is not None:
                alvo.update(item)
                atualizados.append(alvo)
            else:
                novo = dict(item)
                novo["id"] = max((r["id"] for r in self.dados[self.tabela]), default=0) + 1
                self.dados[self.tabela].append(novo)
                atualizados.append(novo)
        return _Resposta(atualizados)

    def update(self, payload, **kwargs):
        self._update_payload = payload
        return self

    def delete(self, **kwargs):
        self._delete = True
        return self

    def execute(self):
        if self._update_payload is not None:
            alvo = self._aplica()
            for r in alvo:
                r.update(self._update_payload)
                if self.tabela == "produtos":
                    r["updated_at"] = _proximo_timestamp()
            return _Resposta(alvo)
        if self._delete:
            removidos = self._aplica()
            restante = [r for r in self.dados[self.tabela] if r not in removidos]
            self.dados[self.tabela] = restante
            return _Resposta(removidos)
        if self._count_exact:
            # count=exact: total considera TODAS as linhas do filtro (a
            # paginação afeta apenas o corpo da resposta).
            total = len(self._aplica(com_paginacao=False))
            return _Resposta(self._aplica(), count=total)
        return _Resposta(self._aplica())


class _RpcQuery:
    """Simula as funções RPC usadas pelo backend (agregações do schema.sql)."""

    def __init__(self, funcao, parametros, dados):
        self.funcao = funcao
        self.parametros = parametros or {}
        self.dados = dados

    def execute(self):
        if self.funcao == "os_contadores":
            return _Resposta(self._os_contadores())
        if self.funcao == "obras_contadores":
            return _Resposta(self._obras_contadores())
        raise Exception(f"RPC desconhecida no fake: {self.funcao}")

    def _os_contadores(self):
        ids = [int(i) for i in self.parametros.get("p_os_ids") or []]
        fotos = {}
        for f in self.dados.get("os_fotos", []):
            if f.get("os_id") in ids:
                fotos[f["os_id"]] = fotos.get(f["os_id"], 0) + 1
        materiais = {}
        for m in self.dados.get("os_materiais", []):
            if m.get("os_id") in ids:
                materiais[m["os_id"]] = materiais.get(m["os_id"], 0) + float(m.get("quantidade_usada") or 0)
        return [{"os_id": i, "fotos": fotos.get(i, 0), "materiais": materiais.get(i, 0)} for i in ids]

    def _obras_contadores(self):
        ids = [int(i) for i in self.parametros.get("p_obra_ids") or []]
        status_ativas = ("aberta", "em_andamento")
        status_encerradas = ("concluida", "cancelada")
        status_totais = ("aberta", "em_andamento", "concluida")

        materiais = {}
        for m in self.dados.get("os_materiais", []):
            materiais[m.get("os_id")] = materiais.get(m.get("os_id"), 0) + float(m.get("quantidade_usada") or 0)

        agregados = {}
        for os_row in self.dados.get("ordens_servico", []):
            obra_id = os_row.get("obra_id")
            if obra_id not in ids:
                continue
            reg = agregados.setdefault(
                obra_id,
                {
                    "os_total": 0,
                    "os_ativas": 0,
                    "os_encerradas": 0,
                    "total_construcao": 0.0,
                    "total_manutencao": 0.0,
                    "total_linha_viva": 0.0,
                },
            )
            reg["os_total"] += 1
            if os_row.get("status") in status_ativas:
                reg["os_ativas"] += 1
            if os_row.get("status") in status_encerradas:
                reg["os_encerradas"] += 1
            if os_row.get("status") in status_totais:
                tipo = os_row.get("tipo") or "construcao"
                chave = f"total_{tipo}"
                if chave in reg:
                    reg[chave] += materiais.get(os_row.get("id"), 0.0)
        return [{"obra_id": oid, **reg} for oid, reg in agregados.items()]


class SupabaseFake:
    def __init__(self, dados):
        self._dados = dados

    def table(self, tabela):
        return _Query(tabela, self._dados)

    def rpc(self, funcao, parametros=None):
        return _RpcQuery(funcao, parametros, self._dados)
