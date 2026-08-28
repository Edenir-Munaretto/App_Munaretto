"""Mock do cliente Supabase para testes.

Simula a API encadeada do supabase-py (table/select/eq/neq/ilike/order/
insert/update/delete/limit/execute) sobre um dicionário em memória, de forma
que os routers da API possam ser testados sem conexão externa.
"""

from dataclasses import dataclass


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

    def select(self, *args, **kwargs):
        return self

    def eq(self, coluna, valor):
        self.filtros.append(("eq", coluna, valor))
        return self

    def neq(self, coluna, valor):
        self.filtros.append(("neq", coluna, valor))
        return self

    def not_(self, coluna, operador, valor):
        self.filtros.append(("not", coluna, operador, valor))
        return self

    def ilike(self, coluna, valor):
        self.filtros.append(("ilike", coluna, valor))
        return self

    def like(self, coluna, valor):
        self.filtros.append(("ilike", coluna, valor))
        return self

    def in_(self, coluna, valores):
        self.filtros.append(("in", coluna, list(valores)))
        return self

    def is_(self, coluna, valor):
        # No PostgREST o valor chega como string "null".
        if isinstance(valor, str) and valor.lower() == "null":
            self.filtros.append(("isnull", coluna, True))
        else:
            self.filtros.append(("eq", coluna, valor))
        return self

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

    def _aplica(self):
        linhas = self.dados[self.tabela]
        for filtro in self.filtros:
            if filtro[0] == "not":
                _, coluna, op_interno, val = filtro
                if op_interno == "is":
                    linhas = [r for r in linhas if r.get(coluna) is not val]
                elif op_interno == "eq":
                    linhas = [r for r in linhas if r.get(coluna) != val]
                elif op_interno == "neq":
                    linhas = [r for r in linhas if r.get(coluna) == val]
                continue
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
            elif op == "in":
                linhas = [r for r in linhas if r.get(coluna) in valor]
            elif op == "isnull":
                linhas = [r for r in linhas if r.get(coluna) is None]
        if self.ordenacao:
            coluna, desc = self.ordenacao
            linhas = sorted(linhas, key=lambda r: str(r.get(coluna, "")), reverse=desc)
        if self.limite is not None:
            linhas = linhas[: self.limite]
        if self.range_ is not None:
            inicio, fim = self.range_
            linhas = linhas[inicio : fim + 1]
        return list(linhas)

    def _aplica_or(self, linhas, valor):
        """Resolve o filtro `or` com suporte a caminhos aninhados
        (ex.: 'obras.clientes.nome.ilike.%termo%')."""
        termos = []
        for parte in str(valor).split(","):
            pedacos = parte.split(".")
            if len(pedacos) < 3:
                continue
            bruto = pedacos[-1]
            operador = pedacos[-2]
            coluna = ".".join(pedacos[:-2])
            termo = bruto.replace("%", "").lower()
            termos.append((coluna, operador, termo))
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
            return any(
                termo in _valor_aninhado(r, col).lower()
                for col, _, termo in termos
            )

        return [r for r in linhas if _casa_ou(r)]

    def insert(self, payload):
        if isinstance(payload, dict):
            payload = [payload]
        self.dados[self.tabela] = self.dados.get(self.tabela, [])
        criados = []
        for item in payload:
            novo = dict(item)
            novo["id"] = max((r["id"] for r in self.dados[self.tabela]), default=0) + 1
            self.dados[self.tabela].append(novo)
            criados.append(novo)
        return _Resposta(criados)

    def upsert(self, payload, on_conflict=None):
        """Insere ou atualiza linhas com base na chave de conflito."""
        if isinstance(payload, dict):
            payload = [payload]
        self.dados[self.tabela] = self.dados.get(self.tabela, [])
        atualizados = []
        for item in payload:
            alvo = None
            if on_conflict:
                for r in self.dados[self.tabela]:
                    if r.get(on_conflict) == item.get(on_conflict):
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

    def update(self, payload):
        self._update_payload = payload
        return self

    def delete(self):
        self._delete = True
        return self

    def execute(self):
        if self._update_payload is not None:
            alvo = self._aplica()
            for r in alvo:
                r.update(self._update_payload)
            return _Resposta(alvo)
        if self._delete:
            removidos = self._aplica()
            restante = [r for r in self.dados[self.tabela] if r not in removidos]
            self.dados[self.tabela] = restante
            return _Resposta(removidos)
        return _Resposta(self._aplica())


class SupabaseFake:
    def __init__(self, dados):
        self._dados = dados

    def table(self, tabela):
        return _Query(tabela, self._dados)
