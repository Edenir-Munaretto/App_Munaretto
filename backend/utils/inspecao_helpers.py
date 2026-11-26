"""Regras e acesso a dados do módulo Inspeções.

O checklist é um SNAPSHOT do modelo (grupos/itens) copiado para a inspeção no
momento em que o técnico toca em "Iniciar". Alterações posteriores no cadastro
do modelo não mudam inspeções antigas.

Formatos de resposta:
- conforme_nao_conforme_na: conforme | nao_conforme | na;
- sim_nao_na: sim | nao | na.
No primeiro, "Não Conforme" exige observação na finalização. No segundo, a
observação é geral da inspeção (sem observação por item).
Itens com `exige_foto` exigem ao menos uma foto (exceto quando N/A).
"""

import contextlib
import logging
from datetime import UTC, datetime

from fastapi import HTTPException

from auth import UsuarioAutenticado
from utils.date_helpers import agora_fuso_brasil, parse_data

logger = logging.getLogger(__name__)

TIPO_RESPOSTA_PADRAO = "conforme_nao_conforme_na"
TIPOS_RESPOSTA = {
    "conforme_nao_conforme_na": ("conforme", "nao_conforme", "na"),
    "sim_nao_na": ("sim", "nao", "na"),
}
RESPOSTAS_VALIDAS = tuple(
    dict.fromkeys(valor for valores in TIPOS_RESPOSTA.values() for valor in valores)
)
ROTULOS_RESPOSTA = {
    "conforme": "Conforme",
    "nao_conforme": "Não Conforme",
    "sim": "Sim",
    "nao": "Não",
    "na": "N/A",
}
ROTULOS_STATUS = {
    "rascunho": "Rascunho",
    "concluida": "Concluída",
    "cancelada": "Cancelada",
}

CAMPOS_ATUALIZAVEIS = (
    "local_inspecao",
    "observacoes",
    "encarregado",
    "veiculo",
    "setor",
    "tipo_servico",
)


def normalizar_tipo_resposta(valor) -> str:
    """Retorna um formato de resposta válido (padrão: C/NC/N/A)."""
    tipo = str(valor or "").strip()
    return tipo if tipo in TIPOS_RESPOSTA else TIPO_RESPOSTA_PADRAO


def respostas_do_tipo(tipo_resposta) -> tuple[str, ...]:
    return TIPOS_RESPOSTA[normalizar_tipo_resposta(tipo_resposta)]


def _emb(valor):
    """Normaliza embedded resource do PostgREST (to-one pode vir como lista)."""
    if isinstance(valor, list):
        return valor[0] if valor else {}
    return valor or {}


def eh_gestor(usuario: UsuarioAutenticado) -> bool:
    return "inspecoes" in (usuario.permissoes or [])


def garantir_acesso_inspecao(usuario: UsuarioAutenticado, inspecao: dict) -> None:
    """Gestor acessa tudo; técnico acessa apenas as inspeções que criou."""
    if eh_gestor(usuario):
        return
    if int(inspecao.get("usuario_id") or 0) != int(usuario.id):
        raise HTTPException(status_code=403, detail="Acesso negado a esta inspeção.")


def buscar_inspecao(db, inspecao_id: int) -> dict:
    resp = db.table("inspecoes").select("*").eq("id", inspecao_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Inspeção não encontrada.")
    return resp.data[0]


def gerar_codigo_inspecao(db) -> str:
    """Gera código no formato INS-<ANO>-<NNNN>, sequencial por ano."""
    ano = agora_fuso_brasil().year
    prefixo = f"INS-{ano}-"
    for _ in range(10):
        ultimo = (
            db.table("inspecoes")
            .select("codigo")
            .like("codigo", f"{prefixo}%")
            .order("codigo", desc=True)
            .limit(1)
            .execute()
            .data
        )
        maior = 0
        if ultimo:
            with contextlib.suppress(ValueError, IndexError):
                maior = int(str(ultimo[0]["codigo"]).rsplit("-", 1)[1])
        codigo = f"{prefixo}{maior + 1:04d}"
        duplicado = db.table("inspecoes").select("id").eq("codigo", codigo).limit(1).execute()
        if not duplicado.data:
            return codigo
        logger.warning("Código de inspeção %s já reservado; tentando o próximo.", codigo)
    raise HTTPException(status_code=500, detail="Não foi possível gerar o código da inspeção.")


def _cargo_do_funcionario(db, funcionario: dict) -> str | None:
    cargo_id = funcionario.get("cargo_id")
    if not cargo_id:
        return None
    resp = db.table("cargos").select("nome").eq("id", cargo_id).execute()
    if not resp.data:
        return None
    return resp.data[0].get("nome")


def snapshot_funcionario(db, funcionario_id: int | None) -> dict | None:
    if funcionario_id is None:
        return None
    resp = db.table("funcionarios").select("id, nome, ativo, desligado, excluido, cargo_id").eq(
        "id", funcionario_id
    ).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Funcionário não encontrado.")
    funcionario = resp.data[0]
    if not funcionario.get("ativo", True) or funcionario.get("desligado") or funcionario.get("excluido"):
        raise HTTPException(status_code=400, detail="Funcionário inativo ou desligado.")
    return {
        "funcionario_id": funcionario.get("id"),
        "funcionario_nome": funcionario.get("nome"),
        "funcionario_cargo": _cargo_do_funcionario(db, funcionario),
    }


def _membros_da_equipe(db, equipe_id: int) -> list[dict]:
    membros = (
        db.table("equipe_membros")
        .select("funcionario_id, lider")
        .eq("equipe_id", equipe_id)
        .execute()
        .data
        or []
    )
    ids = [m.get("funcionario_id") for m in membros if m.get("funcionario_id") is not None]
    if not ids:
        return []
    funcionarios = (
        db.table("funcionarios")
        .select("id, nome, cargo_id, ativo, desligado, excluido")
        .in_("id", ids)
        .execute()
        .data
        or []
    )
    por_id = {f.get("id"): f for f in funcionarios}
    cargos = {}
    cargo_ids = [f.get("cargo_id") for f in funcionarios if f.get("cargo_id")]
    if cargo_ids:
        for cargo in db.table("cargos").select("id, nome").in_("id", cargo_ids).execute().data or []:
            cargos[cargo.get("id")] = cargo.get("nome")
    resultado = []
    for membro in membros:
        funcionario = por_id.get(membro.get("funcionario_id"))
        if not funcionario:
            continue
        if not funcionario.get("ativo", True) or funcionario.get("desligado") or funcionario.get("excluido"):
            continue
        resultado.append(
            {
                "funcionario_id": funcionario.get("id"),
                "nome": funcionario.get("nome"),
                "cargo": cargos.get(funcionario.get("cargo_id")),
                "lider": bool(membro.get("lider")),
            }
        )
    return resultado


def snapshot_equipe(db, equipe_id: int | None) -> dict | None:
    if equipe_id is None:
        return None
    resp = db.table("equipes").select("id, nome, numero, ativa").eq("id", equipe_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Equipe não encontrada.")
    equipe = resp.data[0]
    if not equipe.get("ativa", True):
        raise HTTPException(status_code=400, detail="Equipe inativa.")
    membros = _membros_da_equipe(db, equipe_id)
    lider = next((m for m in membros if m.get("lider")), None)
    return {
        "equipe_id": equipe.get("id"),
        "equipe_nome": equipe.get("nome"),
        "equipe_numero": equipe.get("numero"),
        "membros": membros,
        "lider_nome": lider.get("nome") if lider else None,
    }


def validar_obra(db, obra_id: int | None) -> dict | None:
    if obra_id is None:
        return None
    resp = db.table("obras").select("id, nome, endereco, cidade, cliente_celesc, clientes(nome)").eq(
        "id", obra_id
    ).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Obra não encontrada.")
    return resp.data[0]


def modelo_completo(db, modelo_id: int, incluir_inativos: bool = False) -> dict:
    """Retorna modelo + grupos + itens (ordenados)."""
    resp = db.table("inspecao_modelos").select("*").eq("id", modelo_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Modelo de inspeção não encontrado.")
    modelo = resp.data[0]
    grupos = (
        db.table("inspecao_modelo_grupos")
        .select("*")
        .eq("modelo_id", modelo_id)
        .order("ordem")
        .execute()
        .data
        or []
    )
    grupos.sort(key=lambda g: (int(g.get("ordem") or 0), int(g.get("id") or 0)))
    por_id = {g.get("id"): g for g in grupos}
    query_itens = db.table("inspecao_modelo_itens").select("*").eq("modelo_id", modelo_id)
    if not incluir_inativos:
        query_itens = query_itens.eq("ativo", True)
    itens = query_itens.order("ordem").execute().data or []
    itens.sort(
        key=lambda i: (
            int((por_id.get(i.get("grupo_id")) or {}).get("ordem") or 0),
            int(i.get("ordem") or 0),
            int(i.get("id") or 0),
        )
    )
    for item in itens:
        grupo = por_id.get(item.get("grupo_id")) or {}
        item["grupo_ordem"] = grupo.get("ordem")
        item["grupo_nome"] = grupo.get("nome")
    return {"modelo": modelo, "grupos": grupos, "itens": itens}


def montar_itens_do_modelo(db, modelo_id: int) -> list[dict]:
    dados = modelo_completo(db, modelo_id)
    if not dados["modelo"].get("ativo", True):
        raise HTTPException(status_code=400, detail="Modelo de inspeção inativo.")
    itens = []
    for item in dados["itens"]:
        itens.append(
            {
                "modelo_item_id": item.get("id"),
                "grupo_ordem": int(item.get("grupo_ordem") or 1),
                "grupo_nome": item.get("grupo_nome") or "Checklist",
                "ordem": int(item.get("ordem") or 1),
                "classificacao": item.get("classificacao"),
                "pergunta": item.get("pergunta"),
                "exige_foto": bool(item.get("exige_foto")),
                "resposta": None,
                "observacao": None,
                "geolocalizacao": None,
            }
        )
    return itens


def _parse_resposta(item: dict, tipo_resposta: str = TIPO_RESPOSTA_PADRAO) -> tuple[str | None, str | None]:
    resposta = item.get("resposta")
    if not resposta:
        return None, (item.get("observacao") or "").strip() or None
    resposta = str(resposta).strip().lower()
    tipo = normalizar_tipo_resposta(tipo_resposta)
    if resposta not in TIPOS_RESPOSTA[tipo]:
        esperado = ", ".join(TIPOS_RESPOSTA[tipo])
        raise HTTPException(
            status_code=400,
            detail=(
                f"Resposta inválida para o item {item.get('classificacao')}. "
                f"Para este modelo use: {esperado}."
            ),
        )
    observacao = (item.get("observacao") or "").strip() or None
    return resposta, observacao


def _normalizar_itens(
    dados: dict,
    modelo_itens: list[dict],
    tipo_resposta: str = TIPO_RESPOSTA_PADRAO,
) -> list[dict]:
    itens = dados.get("itens") or modelo_itens
    if not isinstance(itens, list) or not itens:
        raise HTTPException(status_code=400, detail="A inspeção precisa ter itens de checklist.")
    por_classificacao = {i.get("classificacao"): i for i in modelo_itens}
    vistos: set[str] = set()
    normalizados = []
    for item in itens:
        classificacao = str(item.get("classificacao") or "").strip()
        pergunta = str(item.get("pergunta") or "").strip()
        if not classificacao or not pergunta:
            raise HTTPException(status_code=400, detail="Item do checklist sem classificação ou pergunta.")
        if classificacao in vistos:
            raise HTTPException(status_code=400, detail=f"Classificação repetida no checklist: {classificacao}.")
        vistos.add(classificacao)
        modelo_item = por_classificacao.get(classificacao) or {}
        resposta, observacao = _parse_resposta(item, tipo_resposta)
        normalizados.append(
            {
                "modelo_item_id": item.get("modelo_item_id") or modelo_item.get("modelo_item_id"),
                "origem_item_id": (item.get("item_local_id") or item.get("origem_item_id") or None),
                "grupo_ordem": int(item.get("grupo_ordem") or modelo_item.get("grupo_ordem") or 1),
                "grupo_nome": (
                    str(item.get("grupo_nome") or modelo_item.get("grupo_nome") or "Checklist").strip()
                ),
                "ordem": int(item.get("ordem") or modelo_item.get("ordem") or 1),
                "classificacao": classificacao,
                "pergunta": pergunta,
                "exige_foto": bool(item.get("exige_foto") or modelo_item.get("exige_foto")),
                "resposta": resposta,
                "observacao": observacao,
                "geolocalizacao": (item.get("geolocalizacao") or "").strip() or None,
            }
        )
    normalizados.sort(
        key=lambda i: (i["grupo_ordem"], i["ordem"], i["classificacao"]),
    )
    return normalizados


def _normalizar_assinantes(dados: dict, equipe: dict | None, usuario: UsuarioAutenticado) -> list[dict]:
    assinantes = dados.get("assinantes")
    if assinantes is not None:
        if not isinstance(assinantes, list):
            raise HTTPException(status_code=400, detail="Assinantes inválidos.")
        resultado = []
        for indice, assinante in enumerate(assinantes, start=1):
            nome = str(assinante.get("nome") or "").strip()
            if not nome:
                continue
            resultado.append(
                {
                    "funcionario_id": assinante.get("funcionario_id"),
                    "nome": nome[:255],
                    "cargo": (str(assinante.get("cargo") or "").strip() or None),
                    "ordem": int(assinante.get("ordem") or indice),
                }
            )
        if resultado:
            return resultado
    if equipe and equipe.get("membros"):
        return [
            {
                "funcionario_id": membro.get("funcionario_id"),
                "nome": membro.get("nome"),
                "cargo": membro.get("cargo"),
                "ordem": indice,
            }
            for indice, membro in enumerate(equipe["membros"], start=1)
        ]
    if usuario.nome:
        return [
            {
                "funcionario_id": usuario.funcionario_id,
                "nome": usuario.nome,
                "cargo": None,
                "ordem": 1,
            }
        ]
    return []


def _inserir_respostas(db, item_por_classificacao: dict, itens: list[dict], usuario_email: str) -> None:
    for item in itens:
        if not item.get("resposta"):
            continue
        item_id = item_por_classificacao.get(item["classificacao"])
        if item_id is None:
            continue
        db.table("inspecao_respostas").upsert(
            {
                "item_id": item_id,
                "resposta": item["resposta"],
                "observacao": item["observacao"],
                "respondido_por": usuario_email,
                "geolocalizacao": item.get("geolocalizacao"),
            },
            on_conflict="item_id",
        ).execute()


def criar_inspecao(
    db,
    usuario: UsuarioAutenticado,
    dados: dict,
    *,
    origem_dispositivo: str | None = None,
    origem_id_local: str | None = None,
) -> dict:
    """Cria a inspeção (rascunho) + snapshot + respostas + assinantes.

    Retorna `{inspecao_id, codigo, itens}` onde `itens` mapeia
    classificação -> id do item no servidor.
    """
    atividade_id = dados.get("atividade_id")
    atividade = (
        db.table("inspecao_atividades").select("*").eq("id", atividade_id).execute().data
        if atividade_id
        else []
    )
    if not atividade:
        raise HTTPException(status_code=404, detail="Atividade de inspeção não encontrada.")
    atividade = atividade[0]
    if not atividade.get("ativo", True):
        raise HTTPException(status_code=400, detail="Atividade de inspeção inativa.")

    modelo_id = dados.get("modelo_id")
    modelo_dados = modelo_completo(db, int(modelo_id))
    modelo = modelo_dados["modelo"]
    if int(modelo.get("atividade_id") or 0) != int(atividade_id):
        raise HTTPException(status_code=422, detail="O tipo de inspeção não pertence à atividade selecionada.")
    if not modelo.get("ativo", True):
        raise HTTPException(status_code=400, detail="Modelo de inspeção inativo.")

    tipo_resposta = normalizar_tipo_resposta(modelo.get("tipo_resposta"))
    tipo_payload = dados.get("tipo_resposta")
    if tipo_payload and normalizar_tipo_resposta(tipo_payload) != tipo_resposta:
        raise HTTPException(
            status_code=409,
            detail="O formato de resposta do modelo foi alterado. Sincronize a inspeção novamente.",
        )

    obra = validar_obra(db, dados.get("obra_id"))
    funcionario = snapshot_funcionario(db, dados.get("funcionario_id"))
    equipe = snapshot_equipe(db, dados.get("equipe_id"))

    itens = _normalizar_itens(
        dados,
        montar_itens_do_modelo(db, int(modelo_id)),
        tipo_resposta,
    )
    data_inspecao = parse_data(dados.get("data_inspecao")) or agora_fuso_brasil().date()
    inspetor_nome = (dados.get("inspetor_nome") or "").strip() or usuario.nome
    if not eh_gestor(usuario):
        inspetor_nome = usuario.nome
    tipo_servico = (
        str(dados.get("tipo_servico") or modelo.get("tipo_servico") or "").strip()[:255] or None
    )

    linha = {
        "codigo": gerar_codigo_inspecao(db),
        "atividade_id": atividade.get("id"),
        "atividade_nome": atividade.get("nome"),
        "modelo_id": modelo.get("id"),
        "modelo_nome": modelo.get("nome"),
        "tipo_resposta": tipo_resposta,
        "tipo_servico": tipo_servico,
        "obra_id": obra.get("id") if obra else None,
        "usuario_id": usuario.id,
        "inspetor_usuario_id": usuario.id,
        "inspetor_nome": inspetor_nome[:255],
        "funcionario_id": funcionario.get("funcionario_id") if funcionario else None,
        "funcionario_nome": funcionario.get("funcionario_nome") if funcionario else None,
        "funcionario_cargo": funcionario.get("funcionario_cargo") if funcionario else None,
        "equipe_id": equipe.get("equipe_id") if equipe else None,
        "equipe_nome": equipe.get("equipe_nome") if equipe else None,
        "equipe_numero": equipe.get("equipe_numero") if equipe else None,
        "encarregado": (str(dados.get("encarregado") or "").strip() or (equipe or {}).get("lider_nome") or None),
        "veiculo": (str(dados.get("veiculo") or "").strip() or None),
        "setor": (str(dados.get("setor") or "").strip() or None),
        "local_inspecao": str(dados.get("local_inspecao") or "").strip()[:2000] or None,
        "data_inspecao": data_inspecao.isoformat(),
        "iniciada_em": dados.get("iniciada_em") or datetime.now(UTC).isoformat(),
        "status": "rascunho",
        "observacoes": (str(dados.get("observacoes") or "").strip() or None),
        "origem_dispositivo": (origem_dispositivo or "")[:120] or None,
        "origem_id_local": (origem_id_local or "")[:120] or None,
        "sincronizada_em": datetime.now(UTC).isoformat() if origem_id_local else None,
    }
    if not linha["local_inspecao"]:
        raise HTTPException(status_code=400, detail="Informe o local da inspeção.")

    inspecao = None
    for _tentativa in range(3):
        try:
            resp = db.table("inspecoes").insert(linha).execute()
            if resp.data:
                inspecao = resp.data[0]
                break
        except Exception as exc:
            texto = str(exc).lower()
            if "duplicate" not in texto and "unique" not in texto and "23505" not in texto:
                raise
            linha["codigo"] = gerar_codigo_inspecao(db)
    if not inspecao:
        raise HTTPException(status_code=500, detail="Falha ao criar a inspeção.")

    inspecao_id = inspecao["id"]
    try:
        linhas_itens = [
            {
                "inspecao_id": inspecao_id,
                "modelo_item_id": item.get("modelo_item_id"),
                "origem_item_id": (item.get("origem_item_id") or "")[:120] or None,
                "grupo_ordem": item["grupo_ordem"],
                "grupo_nome": item["grupo_nome"],
                "ordem": item["ordem"],
                "classificacao": item["classificacao"],
                "pergunta": item["pergunta"],
                "exige_foto": item["exige_foto"],
            }
            for item in itens
        ]
        db.table("inspecao_itens").insert(linhas_itens).execute()
        criados = (
            db.table("inspecao_itens")
            .select("id, classificacao")
            .eq("inspecao_id", inspecao_id)
            .execute()
            .data
            or []
        )
        item_por_classificacao = {i["classificacao"]: i["id"] for i in criados}
        _inserir_respostas(db, item_por_classificacao, itens, usuario.email)

        assinantes = _normalizar_assinantes(dados, equipe, usuario)
        if assinantes:
            db.table("inspecao_assinantes").insert(
                [{**a, "inspecao_id": inspecao_id} for a in assinantes]
            ).execute()
    except Exception:
        with contextlib.suppress(Exception):
            db.table("inspecoes").delete().eq("id", inspecao_id).execute()
        raise

    return {
        "inspecao_id": inspecao_id,
        "codigo": inspecao.get("codigo") or linha["codigo"],
        "itens": item_por_classificacao,
    }


def itens_com_respostas(db, inspecao_id: int) -> list[dict]:
    itens = (
        db.table("inspecao_itens")
        .select("*")
        .eq("inspecao_id", inspecao_id)
        .execute()
        .data
        or []
    )
    if not itens:
        return []
    itens.sort(key=lambda i: (int(i.get("grupo_ordem") or 0), int(i.get("ordem") or 0), int(i.get("id") or 0)))
    ids = [i["id"] for i in itens]
    respostas = (
        db.table("inspecao_respostas").select("*").in_("item_id", ids).execute().data or []
    )
    fotos = (
        db.table("inspecao_fotos")
        .select("*")
        .in_("item_id", ids)
        .order("id")
        .execute()
        .data
        or []
    )
    por_resposta = {r["item_id"]: r for r in respostas}
    por_item_fotos: dict[int, list[dict]] = {}
    for foto in fotos:
        por_item_fotos.setdefault(foto.get("item_id"), []).append(foto)
    for item in itens:
        item["resposta"] = por_resposta.get(item["id"])
        item["fotos"] = por_item_fotos.get(item["id"], [])
    return itens


def resumo_inspecao(itens: list[dict]) -> dict:
    total = len(itens)
    respondidos = sum(1 for i in itens if i.get("resposta"))
    nao_conformes = sum(
        1 for i in itens if (i.get("resposta") or {}).get("resposta") == "nao_conforme"
    )
    respostas_nao = sum(
        1 for i in itens if (i.get("resposta") or {}).get("resposta") == "nao"
    )
    fotos = sum(len(i.get("fotos") or []) for i in itens)
    return {
        "total": total,
        "respondidos": respondidos,
        "nao_conformes": nao_conformes,
        "respostas_nao": respostas_nao,
        "fotos": fotos,
        "completo": total == 0 or respondidos == total,
    }


def pendencias_finalizacao(
    itens: list[dict],
    tipo_resposta: str = TIPO_RESPOSTA_PADRAO,
) -> list[str]:
    tipo = normalizar_tipo_resposta(tipo_resposta)
    pendencias = []
    for item in itens:
        rotulo = f"{item.get('classificacao', '')} {item.get('pergunta', '')}".strip()
        resposta = item.get("resposta") or {}
        valor = resposta.get("resposta")
        if not valor:
            pendencias.append(f"{rotulo}: sem resposta")
            continue
        if (
            tipo == "conforme_nao_conforme_na"
            and valor == "nao_conforme"
            and not (resposta.get("observacao") or "").strip()
        ):
            pendencias.append(f"{rotulo}: observação obrigatória para Não Conforme")
        if item.get("exige_foto") and valor != "na" and not item.get("fotos"):
            pendencias.append(f"{rotulo}: foto obrigatória")
    return pendencias


def atualizar_inspecao(db, usuario: UsuarioAutenticado, inspecao: dict, dados: dict) -> dict:
    """Atualiza metadados e respostas de uma inspeção em rascunho."""
    garantir_acesso_inspecao(usuario, inspecao)
    if inspecao.get("status") != "rascunho":
        raise HTTPException(status_code=409, detail="A inspeção já foi encerrada e não pode ser alterada.")

    campos = {}
    for campo in CAMPOS_ATUALIZAVEIS:
        if campo in dados:
            valor = dados.get(campo)
            campos[campo] = (str(valor).strip() or None) if valor is not None else None
    if "observacoes" in dados and dados.get("observacoes") is not None:
        campos["observacoes"] = str(dados.get("observacoes")).strip() or None
    if "local_inspecao" in dados and dados.get("local_inspecao") is not None:
        local = str(dados.get("local_inspecao") or "").strip()
        if not local:
            raise HTTPException(status_code=400, detail="Informe o local da inspeção.")
        campos["local_inspecao"] = local[:2000]
    if eh_gestor(usuario) and (dados.get("inspetor_nome") or "").strip():
        campos["inspetor_nome"] = str(dados["inspetor_nome"]).strip()[:255]
    if campos:
        db.table("inspecoes").update(campos).eq("id", inspecao["id"]).execute()

    itens_payload = dados.get("itens")
    if itens_payload:
        tipo_resposta = normalizar_tipo_resposta(inspecao.get("tipo_resposta"))
        itens_banco = {
            i["classificacao"]: i
            for i in itens_com_respostas(db, inspecao["id"])
        }
        for item in itens_payload:
            classificacao = str(item.get("classificacao") or "").strip()
            if not classificacao:
                continue
            item_banco = itens_banco.get(classificacao)
            if not item_banco:
                raise HTTPException(
                    status_code=409,
                    detail=f"O item {classificacao} não existe mais no checklist da inspeção.",
                )
            if not item.get("resposta"):
                continue
            resposta, observacao = _parse_resposta(item, tipo_resposta)
            db.table("inspecao_respostas").upsert(
                {
                    "item_id": item_banco["id"],
                    "resposta": resposta,
                    "observacao": observacao,
                    "respondido_por": usuario.email,
                    "geolocalizacao": (item.get("geolocalizacao") or "").strip() or None,
                },
                on_conflict="item_id",
            ).execute()
    return {"inspecao_id": inspecao["id"], "codigo": inspecao.get("codigo")}


def finalizar_inspecao(db, usuario: UsuarioAutenticado, inspecao: dict) -> dict:
    garantir_acesso_inspecao(usuario, inspecao)
    if inspecao.get("status") == "concluida":
        return {"inspecao_id": inspecao["id"], "codigo": inspecao.get("codigo"), "ja_concluida": True}
    if inspecao.get("status") == "cancelada":
        raise HTTPException(status_code=400, detail="Uma inspeção cancelada não pode ser finalizada.")
    itens = itens_com_respostas(db, inspecao["id"])
    pendencias = pendencias_finalizacao(itens, inspecao.get("tipo_resposta"))
    if pendencias:
        detalhe = "; ".join(pendencias[:6])
        if len(pendencias) > 6:
            detalhe += f"; e mais {len(pendencias) - 6} pendência(s)"
        raise HTTPException(status_code=400, detail=f"Checklist incompleto: {detalhe}.")
    db.table("inspecoes").update(
        {"status": "concluida", "finalizada_em": datetime.now(UTC).isoformat()}
    ).eq("id", inspecao["id"]).execute()
    return {"inspecao_id": inspecao["id"], "codigo": inspecao.get("codigo"), "ja_concluida": False}
