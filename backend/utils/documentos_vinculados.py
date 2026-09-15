"""Documentos com vencimento derivado de outros registros do funcionário.

Centraliza a regra usada pelo módulo SST (lista de vencimentos e alertas) e
pelo Dashboard: um documento como a AUTORIZAÇÃO NR10 E NR35 vence junto com o
pré-requisito que vencer primeiro (cursos e/ou ASO) e fica "Sem validade"
(pendente) se algum deles faltar.

A configuração é fixa em código: a chave é o nome do documento no catálogo de
treinamentos (normalizado) e os nomes em "cursos" precisam existir no mesmo
catálogo.
"""

import unicodedata

from utils.date_helpers import STATUS_SEM_VALIDADE
from utils.date_helpers import parse_data as _parse_data
from utils.date_helpers import status_vencimento as _status_vencimento

DOCUMENTOS_VINCULADOS = {
    "AUTORIZACAO NR10 E NR35": {
        "cursos": ["NR-10 RECICLAGEM", "NR-35 TRABALHO EM ALTURA"],
        "usa_aso": True,
    },
}


def normalizar_nome(texto) -> str:
    """Normaliza um nome para comparação: maiúsculas, sem acento e espaços únicos."""
    if not texto:
        return ""
    sem_acento = "".join(
        c for c in unicodedata.normalize("NFD", str(texto)) if unicodedata.category(c) != "Mn"
    )
    return " ".join(sem_acento.upper().split())


def ultimo_por_validade(linhas: list, campos_chave: tuple) -> dict:
    """Mapeia chave -> registro de maior data_validade (mesma regra das pendências)."""
    resultado = {}
    for r in linhas:
        chave = tuple(r.get(c) for c in campos_chave)
        atual = resultado.get(chave)
        if atual is None or str(r.get("data_validade") or "") > str(atual.get("data_validade") or ""):
            resultado[chave] = r
    return resultado


def anotar_catalogo_vinculados(dados: list) -> None:
    """Marca no catálogo quais cursos são documentos de vencimento derivado."""
    for t in dados:
        config = DOCUMENTOS_VINCULADOS.get(normalizar_nome(t.get("nome")))
        if not config:
            t["vinculado"] = False
            continue
        nomes = list(config["cursos"])
        if config.get("usa_aso"):
            nomes.append("ASO")
        t["vinculado"] = True
        t["requisitos"] = nomes


def aplicar_documentos_vinculados(registros: list, catalogo: list, asos: list) -> None:
    """Aplica o vencimento derivado aos registros de documentos vinculados.

    Modifica os registros in-place: 'status' passa a ser o do pré-requisito que
    vencer primeiro e são acrescentados 'vinculado', 'requisitos',
    'data_validade_efetiva', 'faltando' e 'motivo'. Cursos comuns não são
    tocados: sem vínculo configurado, valem as regras de sempre.
    """
    if not DOCUMENTOS_VINCULADOS:
        return
    treino_por_nome = {normalizar_nome(t.get("nome")): t for t in catalogo}
    ultimos_cursos = ultimo_por_validade(registros, ("funcionario_id", "treinamento_id"))

    # ASO válido do funcionário: o de maior data_validade (ignora exames sem validade).
    ultimos_asos = {}
    for a in asos:
        d = _parse_data(a.get("data_validade"))
        if d is None:
            continue
        atual = ultimos_asos.get(a.get("funcionario_id"))
        if atual is None or d > atual[0]:
            ultimos_asos[a.get("funcionario_id")] = (d, a)

    for r in registros:
        config = DOCUMENTOS_VINCULADOS.get(normalizar_nome(r.get("treinamento_nome")))
        if not config:
            continue

        requisitos = []
        datas = []
        faltantes = []
        for nome_curso in config["cursos"]:
            treino = treino_por_nome.get(normalizar_nome(nome_curso))
            registro = (
                ultimos_cursos.get((r.get("funcionario_id"), treino["id"])) if treino else None
            )
            if registro is None:
                faltantes.append(nome_curso)
                requisitos.append(
                    {
                        "tipo": "curso",
                        "nome": nome_curso,
                        "data_validade": None,
                        "status": STATUS_SEM_VALIDADE,
                        "registrado": False,
                    }
                )
                continue
            d = _parse_data(registro.get("data_validade"))
            requisitos.append(
                {
                    "tipo": "curso",
                    "nome": nome_curso,
                    "data_validade": registro.get("data_validade"),
                    "status": _status_vencimento(registro.get("data_validade")),
                    "registrado": True,
                }
            )
            if d:
                datas.append((d, nome_curso))

        if config.get("usa_aso"):
            info = ultimos_asos.get(r.get("funcionario_id"))
            if info is None:
                faltantes.append("ASO")
                requisitos.append(
                    {
                        "tipo": "aso",
                        "nome": "ASO",
                        "data_validade": None,
                        "status": STATUS_SEM_VALIDADE,
                        "registrado": False,
                    }
                )
            else:
                d, aso = info
                requisitos.append(
                    {
                        "tipo": "aso",
                        "nome": "ASO",
                        "data_validade": aso.get("data_validade"),
                        "status": _status_vencimento(aso.get("data_validade")),
                        "registrado": True,
                    }
                )
                datas.append((d, "ASO"))

        d_propria = _parse_data(r.get("data_validade"))
        if d_propria:
            datas.append((d_propria, "validade própria"))

        primeiro = min(datas, key=lambda item: item[0]) if datas else None
        r["vinculado"] = True
        r["requisitos"] = requisitos
        r["data_validade_efetiva"] = primeiro[0].isoformat() if primeiro else None
        r["faltando"] = bool(faltantes)
        if faltantes:
            r["status"] = STATUS_SEM_VALIDADE
            r["motivo"] = f"falta: {', '.join(faltantes)}"
        else:
            r["status"] = _status_vencimento(primeiro[0] if primeiro else None)
            r["motivo"] = f"vence junto com {primeiro[1]}" if primeiro else "sem data de validade"
