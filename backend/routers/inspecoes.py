"""Módulo Inspeções: checklists configuráveis, campo offline e PDF.

Permissões:
- ``inspecoes``     — gestor: cadastros, todas as inspeções, cancelamento e PDF;
- ``inspecoes_campo`` — técnico: cria/preenche e acessa apenas as próprias.

O fluxo de campo é local-first: a inspeção é criada no dispositivo (rascunho
rascunho local) e enviada por ``POST /inspecoes/sincronizar`` quando houver
Wi-Fi. O servidor revalida o snapshot e as respostas na finalização.
"""

import contextlib
import logging
import os
import re
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field, field_validator
from starlette.background import BackgroundTask

from auth import UsuarioAutenticado, get_current_user, require_permisao, require_qualquer_permisao
from storage import bucket, get_s3_client
from supabase_client import get_supabase
from utils.date_helpers import parse_data
from utils.inspecao_helpers import (
    RESPOSTAS_VALIDAS,
    ROTULOS_RESPOSTA,
    atualizar_inspecao,
    buscar_inspecao,
    criar_inspecao,
    eh_gestor,
    finalizar_inspecao,
    garantir_acesso_inspecao,
    itens_com_respostas,
    modelo_completo,
    resumo_inspecao,
)
from utils.uploads import ler_upload_limitado_async, nome_arquivo_seguro, validar_magia_documento

router = APIRouter(dependencies=[Depends(require_qualquer_permisao(["inspecoes", "inspecoes_campo"]))])
GESTOR_ONLY = [Depends(require_permisao("inspecoes"))]

logger = logging.getLogger(__name__)

MIMES_FOTO_PERMITIDOS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
TAMANHO_MAXIMO_FOTO_BYTES = 15 * 1024 * 1024
VALIDADE_PRESIGNED_SEGUNDOS = 15 * 60
TETO_FOTOS_PDF_BYTES = 60 * 1024 * 1024
STATUS_VALIDOS = {"rascunho", "concluida", "cancelada"}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class AtividadeIn(BaseModel):
    nome: str = Field(..., min_length=2, max_length=120)
    ativo: bool = True

    @field_validator("nome")
    @classmethod
    def _normalizar(cls, valor):
        valor = str(valor or "").strip()
        if not valor:
            raise ValueError("Informe o nome da atividade.")
        return valor


class ModeloItemIn(BaseModel):
    grupo_ordem: int = Field(1, ge=1)
    grupo_nome: str = Field("Checklist", min_length=1, max_length=255)
    ordem: int = Field(1, ge=1)
    classificacao: str = Field(..., min_length=1, max_length=20)
    pergunta: str = Field(..., min_length=2)
    exige_foto: bool = False

    @field_validator("grupo_nome", "classificacao", "pergunta")
    @classmethod
    def _normalizar(cls, valor):
        valor = str(valor or "").strip()
        if not valor:
            raise ValueError("Campo obrigatório.")
        return valor


class ModeloGrupoIn(BaseModel):
    ordem: int = Field(1, ge=1)
    nome: str = Field(..., min_length=1, max_length=255)
    itens: list[ModeloItemIn] = Field(default_factory=list)

    @field_validator("nome")
    @classmethod
    def _normalizar(cls, valor):
        valor = str(valor or "").strip()
        if not valor:
            raise ValueError("Informe o nome do grupo.")
        return valor


class ModeloIn(BaseModel):
    atividade_id: int
    nome: str = Field(..., min_length=2, max_length=255)
    descricao: str | None = None
    ativo: bool = True
    grupos: list[ModeloGrupoIn] = Field(default_factory=list)

    @field_validator("nome")
    @classmethod
    def _normalizar(cls, valor):
        valor = str(valor or "").strip()
        if not valor:
            raise ValueError("Informe o nome do modelo.")
        return valor


class AssinanteIn(BaseModel):
    funcionario_id: int | None = None
    nome: str = Field(..., min_length=2, max_length=255)
    cargo: str | None = Field(None, max_length=255)
    ordem: int = Field(1, ge=1)


class ItemInspecaoIn(BaseModel):
    item_local_id: str | None = Field(None, max_length=120)
    modelo_item_id: int | None = None
    grupo_ordem: int = Field(1, ge=1)
    grupo_nome: str = Field("Checklist", max_length=255)
    ordem: int = Field(1, ge=1)
    classificacao: str = Field(..., min_length=1, max_length=20)
    pergunta: str = Field(..., min_length=2)
    exige_foto: bool = False
    resposta: str | None = None
    observacao: str | None = None
    geolocalizacao: str | None = Field(None, max_length=100)


class InspecaoIn(BaseModel):
    atividade_id: int
    modelo_id: int
    obra_id: int | None = None
    funcionario_id: int | None = None
    equipe_id: int | None = None
    encarregado: str | None = Field(None, max_length=255)
    veiculo: str | None = Field(None, max_length=255)
    setor: str | None = Field(None, max_length=255)
    local_inspecao: str = Field(..., min_length=2, max_length=2000)
    data_inspecao: str | None = None
    iniciada_em: str | None = None
    inspetor_nome: str | None = Field(None, max_length=255)
    observacoes: str | None = None
    itens: list[ItemInspecaoIn] = Field(default_factory=list)
    assinantes: list[AssinanteIn] = Field(default_factory=list)

    @field_validator("local_inspecao")
    @classmethod
    def _local_obrigatorio(cls, valor):
        valor = str(valor or "").strip()
        if not valor:
            raise ValueError("Informe o local da inspeção.")
        return valor


class ItemSalvarIn(BaseModel):
    classificacao: str = Field(..., min_length=1, max_length=20)
    resposta: str
    observacao: str | None = None
    geolocalizacao: str | None = Field(None, max_length=100)


class SalvarInspecaoIn(BaseModel):
    local_inspecao: str | None = Field(None, max_length=2000)
    observacoes: str | None = None
    encarregado: str | None = Field(None, max_length=255)
    veiculo: str | None = Field(None, max_length=255)
    setor: str | None = Field(None, max_length=255)
    inspetor_nome: str | None = Field(None, max_length=255)
    itens: list[ItemSalvarIn] = Field(default_factory=list)


class RespostaIn(BaseModel):
    resposta: str
    observacao: str | None = None
    geolocalizacao: str | None = Field(None, max_length=100)


class CancelamentoIn(BaseModel):
    motivo: str = Field(..., min_length=5, description="Motivo do cancelamento")

    @field_validator("motivo")
    @classmethod
    def _normalizar_motivo(cls, valor):
        valor = str(valor or "").strip()
        if len(valor) < 5:
            raise ValueError("Informe o motivo do cancelamento (mínimo 5 caracteres).")
        return valor


class OperacaoSyncIn(BaseModel):
    id_local: str = Field(..., min_length=1, max_length=120)
    seq: int | None = None
    tipo: str = Field(..., max_length=40)
    inspecao_id: int | None = None
    criado_em: str | None = None
    payload: dict = Field(default_factory=dict)


class SincronizarIn(BaseModel):
    operacoes: list[OperacaoSyncIn] = Field(..., min_length=1, max_length=200)
    dispositivo: str | None = Field(None, max_length=120)
    mapa_fotos: dict = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Helpers gerais
# ---------------------------------------------------------------------------


def _remover_arquivo(caminho: str) -> None:
    with contextlib.suppress(OSError):
        os.remove(caminho)


def _remover_objeto(s3, chave: str) -> None:
    try:
        s3.delete_object(Bucket=bucket(), Key=chave)
    except Exception:
        logger.exception("Erro ao remover objeto %s do B2", chave)


def _emb(valor):
    if isinstance(valor, list):
        return valor[0] if valor else {}
    return valor or {}


def _termo_busca_seguro(termo: str | None) -> str:
    if not termo:
        return ""
    return re.sub(r"[(),.%:;\"\\\[\]]", "", str(termo)).strip()


def _ref_sync(dispositivo: str | None, id_local: str | None) -> str | None:
    if not dispositivo or not id_local:
        return None
    return re.sub(r"[^A-Za-z0-9_-]", "", f"{dispositivo[:40]}_{id_local[:60]}")


def _capturado_em_ou_none(valor: str | None) -> str | None:
    if not valor:
        return None
    try:
        data = datetime.fromisoformat(str(valor).replace("Z", "+00:00"))
        if data.tzinfo is None:
            data = data.replace(tzinfo=UTC)
        return data.isoformat()
    except (TypeError, ValueError):
        return None


def _presigned(s3, foto: dict) -> str | None:
    try:
        return s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket(), "Key": foto["bucket_key"]},
            ExpiresIn=VALIDADE_PRESIGNED_SEGUNDOS,
        )
    except Exception:
        logger.exception("Erro ao gerar URL da foto %s", foto.get("id"))
        return None


def _foto_publica(s3, foto: dict) -> dict:
    return {
        "id": foto.get("id"),
        "inspecao_id": foto.get("inspecao_id"),
        "item_id": foto.get("item_id"),
        "nome_original": foto.get("nome_original"),
        "tamanho_bytes": foto.get("tamanho_bytes"),
        "mime_type": foto.get("mime_type"),
        "enviado_por": foto.get("enviado_por"),
        "capturado_em": foto.get("capturado_em"),
        "created_at": foto.get("created_at"),
        "geolocalizacao": foto.get("geolocalizacao"),
        "url_temporaria": _presigned(s3, foto),
    }


def _obra_da_inspecao(db, obra_id) -> dict | None:
    if obra_id is None:
        return None
    resp = (
        db.table("obras")
        .select("id, nome, endereco, cidade, cliente_celesc, clientes(nome)")
        .eq("id", obra_id)
        .execute()
    )
    if not resp.data:
        return None
    obra = resp.data[0]
    cliente = _emb(obra.get("clientes")).get("nome") or obra.get("cliente_celesc")
    return {
        "id": obra.get("id"),
        "nome": obra.get("nome"),
        "endereco": obra.get("endereco"),
        "cidade": obra.get("cidade"),
        "cliente": cliente,
    }


def _detalhe(db, inspecao: dict) -> dict:
    itens = itens_com_respostas(db, inspecao["id"])
    tem_fotos = any(item.get("fotos") for item in itens)
    s3 = get_s3_client() if tem_fotos else None
    for item in itens:
        item["fotos"] = [_foto_publica(s3, foto) for foto in item.get("fotos") or []]
    assinantes = (
        db.table("inspecao_assinantes")
        .select("*")
        .eq("inspecao_id", inspecao["id"])
        .order("ordem")
        .execute()
        .data
        or []
    )
    obra = _obra_da_inspecao(db, inspecao.get("obra_id"))
    inspecao = dict(inspecao)
    if obra:
        inspecao["obra_nome"] = obra.get("nome")
        inspecao["obra_cliente"] = obra.get("cliente")
        inspecao["obra_endereco"] = obra.get("endereco")
        inspecao["obra_cidade"] = obra.get("cidade")
    return {
        "inspecao": inspecao,
        "itens": itens,
        "resumo": resumo_inspecao(itens),
        "assinantes": assinantes,
        "obra": obra,
    }


def _lista_com_obras(db, linhas: list[dict]) -> list[dict]:
    ids = sorted({r.get("obra_id") for r in linhas if r.get("obra_id") is not None})
    obras: dict[int, dict] = {}
    if ids:
        for obra in (
            db.table("obras")
            .select("id, nome, endereco, cidade, cliente_celesc, clientes(nome)")
            .in_("id", ids)
            .execute()
            .data
            or []
        ):
            obras[obra["id"]] = obra
    resultado = []
    for linha in linhas:
        obra = obras.get(linha.get("obra_id"))
        if obra:
            linha = {
                **linha,
                "obra_nome": obra.get("nome"),
                "obra_cliente": _emb(obra.get("clientes")).get("nome") or obra.get("cliente_celesc"),
                "obra_cidade": obra.get("cidade"),
            }
        resultado.append(linha)
    return resultado


def _modelos_com_itens(db, incluir_inativos: bool = False, atividade_id: int | None = None) -> list[dict]:
    query = db.table("inspecao_modelos").select("*")
    if not incluir_inativos:
        query = query.eq("ativo", True)
    if atividade_id is not None:
        query = query.eq("atividade_id", atividade_id)
    modelos = query.order("nome").execute().data or []
    if not modelos:
        return []
    ids = [m["id"] for m in modelos]
    grupos = (
        db.table("inspecao_modelo_grupos")
        .select("*")
        .in_("modelo_id", ids)
        .order("ordem")
        .execute()
        .data
        or []
    )
    itens_query = db.table("inspecao_modelo_itens").select("*").in_("modelo_id", ids)
    if not incluir_inativos:
        itens_query = itens_query.eq("ativo", True)
    itens = itens_query.order("ordem").execute().data or []
    grupos_por_modelo: dict[int, list[dict]] = {}
    for grupo in grupos:
        grupos_por_modelo.setdefault(grupo["modelo_id"], []).append(grupo)
    itens_por_modelo: dict[int, list[dict]] = {}
    grupo_por_id = {g["id"]: g for g in grupos}
    for item in itens:
        grupo = grupo_por_id.get(item.get("grupo_id")) or {}
        item["grupo_ordem"] = grupo.get("ordem")
        item["grupo_nome"] = grupo.get("nome")
        itens_por_modelo.setdefault(item["modelo_id"], []).append(item)
    for modelo in modelos:
        modelo["grupos"] = grupos_por_modelo.get(modelo["id"], [])
        modelo["itens"] = itens_por_modelo.get(modelo["id"], [])
    return modelos


def _resposta_da_operacao(ok: bool, **campos) -> dict:
    return {"ok": ok, **campos}


# ---------------------------------------------------------------------------
# Opções / cadastros
# ---------------------------------------------------------------------------


@router.get("/opcoes", summary="Opções do formulário de inspeção (e pacote offline)")
def listar_opcoes(db=Depends(get_supabase)):
    """Atividades, modelos, obras, funcionários e equipes para iniciar uma inspeção."""
    try:
        atividades = (
            db.table("inspecao_atividades").select("*").eq("ativo", True).order("nome").execute().data
            or []
        )
        modelos = _modelos_com_itens(db)
        obras = _lista_com_obras(
            db,
            db.table("obras")
            .select("id, nome, endereco, cidade, cliente_celesc, clientes(nome)")
            .eq("ativo", True)
            .order("nome")
            .execute()
            .data
            or [],
        )
        funcionarios_raw = (
            db.table("funcionarios")
            .select("id, nome, cargo_id")
            .eq("ativo", True)
            .execute()
            .data
            or []
        )
        # O PostgREST não tem um "OR" simples para desligado/excluído nulos em
        # todos os SDKs; filtra também no Python para bases antigas.
        funcionarios_raw = [
            f
            for f in funcionarios_raw
            if not f.get("desligado") and not f.get("excluido")
        ]
        cargos = {}
        cargo_ids = sorted({f.get("cargo_id") for f in funcionarios_raw if f.get("cargo_id")})
        if cargo_ids:
            cargos = {
                c["id"]: c.get("nome")
                for c in db.table("cargos").select("id, nome").in_("id", cargo_ids).execute().data or []
            }
        funcionarios = [
            {
                "id": f.get("id"),
                "nome": f.get("nome"),
                "cargo": cargos.get(f.get("cargo_id")),
            }
            for f in funcionarios_raw
        ]
        equipes_raw = (
            db.table("equipes").select("id, nome, numero, ativa").eq("ativa", True).order("nome").execute().data
            or []
        )
        equipe_ids = [e["id"] for e in equipes_raw]
        membros_por_equipe: dict[int, list[dict]] = {}
        if equipe_ids:
            membros = (
                db.table("equipe_membros")
                .select("equipe_id, funcionario_id, lider")
                .in_("equipe_id", equipe_ids)
                .execute()
                .data
                or []
            )
            func_por_id = {f["id"]: f for f in funcionarios}
            for membro in membros:
                funcionario = func_por_id.get(membro.get("funcionario_id"))
                if not funcionario:
                    continue
                membros_por_equipe.setdefault(membro["equipe_id"], []).append(
                    {
                        "funcionario_id": funcionario["id"],
                        "nome": funcionario["nome"],
                        "cargo": funcionario.get("cargo"),
                        "lider": bool(membro.get("lider")),
                    }
                )
        equipes = [
            {
                "id": e.get("id"),
                "nome": e.get("nome"),
                "numero": e.get("numero"),
                "membros": membros_por_equipe.get(e.get("id"), []),
            }
            for e in equipes_raw
        ]
        return {
            "atividades": atividades,
            "modelos": modelos,
            "obras": obras,
            "funcionarios": funcionarios,
            "equipes": equipes,
            "respostas": [{"valor": valor, "rotulo": ROTULOS_RESPOSTA[valor]} for valor in RESPOSTAS_VALIDAS],
        }
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao carregar opções de inspeção")
        raise HTTPException(status_code=500, detail="Erro ao carregar as opções de inspeção.") from None


@router.get("/atividades", summary="Lista atividades de inspeção")
def listar_atividades(
    incluir_inativas: bool = False,
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    query = db.table("inspecao_atividades").select("*")
    if not (incluir_inativas and eh_gestor(usuario)):
        query = query.eq("ativo", True)
    return query.order("nome").execute().data or []


@router.post("/atividades", status_code=201, dependencies=GESTOR_ONLY, summary="Cria atividade")
def criar_atividade(payload: AtividadeIn, db=Depends(get_supabase)):
    try:
        existente = db.table("inspecao_atividades").select("id").eq("nome", payload.nome).limit(1).execute()
        if existente.data:
            raise HTTPException(status_code=409, detail="Já existe uma atividade com esse nome.")
        resp = db.table("inspecao_atividades").insert(payload.model_dump()).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao criar a atividade.")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao criar atividade de inspeção")
        raise HTTPException(status_code=500, detail="Erro ao criar a atividade.") from None


@router.put("/atividades/{atividade_id}", dependencies=GESTOR_ONLY, summary="Edita atividade")
def atualizar_atividade(atividade_id: int, payload: AtividadeIn, db=Depends(get_supabase)):
    try:
        if not db.table("inspecao_atividades").select("id").eq("id", atividade_id).execute().data:
            raise HTTPException(status_code=404, detail="Atividade não encontrada.")
        resp = db.table("inspecao_atividades").update(payload.model_dump()).eq("id", atividade_id).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar a atividade.")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao atualizar atividade %s", atividade_id)
        raise HTTPException(status_code=500, detail="Erro ao atualizar a atividade.") from None


@router.delete("/atividades/{atividade_id}", dependencies=GESTOR_ONLY, summary="Exclui/inativa atividade")
def excluir_atividade(atividade_id: int, db=Depends(get_supabase)):
    try:
        if not db.table("inspecao_atividades").select("id").eq("id", atividade_id).execute().data:
            raise HTTPException(status_code=404, detail="Atividade não encontrada.")
        usada = (
            db.table("inspecao_modelos")
            .select("id")
            .eq("atividade_id", atividade_id)
            .limit(1)
            .execute()
        )
        if usada.data:
            db.table("inspecao_atividades").update({"ativo": False}).eq("id", atividade_id).execute()
            return {"success": True, "message": "Atividade possui modelos e foi apenas inativada."}
        db.table("inspecao_atividades").delete().eq("id", atividade_id).execute()
        return {"success": True, "message": "Atividade excluída."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao excluir atividade %s", atividade_id)
        raise HTTPException(status_code=500, detail="Erro ao excluir a atividade.") from None


@router.get("/modelos", summary="Lista modelos de checklist de inspeção")
def listar_modelos(
    incluir_inativos: bool = False,
    atividade_id: int | None = None,
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    try:
        return _modelos_com_itens(
            db,
            incluir_inativos=bool(incluir_inativos and eh_gestor(usuario)),
            atividade_id=atividade_id,
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao listar modelos de inspeção")
        raise HTTPException(status_code=500, detail="Erro ao listar os modelos de inspeção.") from None


@router.get("/modelos/{modelo_id}", summary="Detalhe do modelo de inspeção")
def obter_modelo(modelo_id: int, db=Depends(get_supabase)):
    try:
        return modelo_completo(db, modelo_id, incluir_inativos=True)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao obter modelo de inspeção %s", modelo_id)
        raise HTTPException(status_code=500, detail="Erro ao obter o modelo de inspeção.") from None


def _validar_modelo(db, payload: ModeloIn) -> None:
    if not db.table("inspecao_atividades").select("id").eq("id", payload.atividade_id).execute().data:
        raise HTTPException(status_code=404, detail="Atividade não encontrada.")
    if not payload.grupos:
        raise HTTPException(status_code=400, detail="O modelo precisa ter pelo menos um grupo.")
    classificacoes: set[str] = set()
    tem_item = False
    for grupo in payload.grupos:
        if not grupo.itens:
            raise HTTPException(status_code=400, detail=f"O grupo '{grupo.nome}' está sem itens.")
        for item in grupo.itens:
            if item.classificacao in classificacoes:
                raise HTTPException(
                    status_code=400,
                    detail=f"Classificação repetida no modelo: {item.classificacao}.",
                )
            classificacoes.add(item.classificacao)
            tem_item = True
    if not tem_item:
        raise HTTPException(status_code=400, detail="O modelo precisa ter pelo menos um item.")


def _gravar_grupos_itens(db, modelo_id: int, grupos: list[ModeloGrupoIn]) -> None:
    for grupo in grupos:
        resp_grupo = db.table("inspecao_modelo_grupos").insert(
            {"modelo_id": modelo_id, "ordem": grupo.ordem, "nome": grupo.nome}
        ).execute()
        if not resp_grupo.data:
            raise HTTPException(status_code=500, detail="Falha ao salvar os grupos do modelo.")
        grupo_id = resp_grupo.data[0]["id"]
        linhas = [
            {
                "modelo_id": modelo_id,
                "grupo_id": grupo_id,
                "ordem": item.ordem,
                "classificacao": item.classificacao,
                "pergunta": item.pergunta,
                "exige_foto": item.exige_foto,
                "ativo": True,
            }
            for item in grupo.itens
        ]
        db.table("inspecao_modelo_itens").insert(linhas).execute()


@router.post("/modelos", status_code=201, dependencies=GESTOR_ONLY, summary="Cria modelo de inspeção")
def criar_modelo(payload: ModeloIn, db=Depends(get_supabase)):
    _validar_modelo(db, payload)
    try:
        resp = db.table("inspecao_modelos").insert(
            {
                "atividade_id": payload.atividade_id,
                "nome": payload.nome,
                "descricao": payload.descricao,
                "ativo": payload.ativo,
            }
        ).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao criar o modelo.")
        modelo_id = resp.data[0]["id"]
        try:
            _gravar_grupos_itens(db, modelo_id, payload.grupos)
        except Exception:
            with contextlib.suppress(Exception):
                db.table("inspecao_modelos").delete().eq("id", modelo_id).execute()
            raise
        return modelo_completo(db, modelo_id, incluir_inativos=True)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao criar modelo de inspeção")
        raise HTTPException(status_code=500, detail="Erro ao criar o modelo de inspeção.") from None


@router.put("/modelos/{modelo_id}", dependencies=GESTOR_ONLY, summary="Edita modelo de inspeção")
def atualizar_modelo(modelo_id: int, payload: ModeloIn, db=Depends(get_supabase)):
    _validar_modelo(db, payload)
    try:
        if not db.table("inspecao_modelos").select("id").eq("id", modelo_id).execute().data:
            raise HTTPException(status_code=404, detail="Modelo não encontrado.")
        db.table("inspecao_modelos").update(
            {
                "atividade_id": payload.atividade_id,
                "nome": payload.nome,
                "descricao": payload.descricao,
                "ativo": payload.ativo,
            }
        ).eq("id", modelo_id).execute()
        # O histórico das inspeções é o snapshot; podemos substituir o catálogo.
        db.table("inspecao_modelo_grupos").delete().eq("modelo_id", modelo_id).execute()
        _gravar_grupos_itens(db, modelo_id, payload.grupos)
        return modelo_completo(db, modelo_id, incluir_inativos=True)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao atualizar modelo de inspeção %s", modelo_id)
        raise HTTPException(status_code=500, detail="Erro ao atualizar o modelo de inspeção.") from None


@router.delete("/modelos/{modelo_id}", dependencies=GESTOR_ONLY, summary="Exclui/inativa modelo")
def excluir_modelo(modelo_id: int, db=Depends(get_supabase)):
    try:
        if not db.table("inspecao_modelos").select("id").eq("id", modelo_id).execute().data:
            raise HTTPException(status_code=404, detail="Modelo não encontrado.")
        usada = db.table("inspecoes").select("id").eq("modelo_id", modelo_id).limit(1).execute()
        if usada.data:
            db.table("inspecao_modelos").update({"ativo": False}).eq("id", modelo_id).execute()
            return {"success": True, "message": "Modelo possui inspeções e foi apenas inativado."}
        db.table("inspecao_modelos").delete().eq("id", modelo_id).execute()
        return {"success": True, "message": "Modelo excluído."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao excluir modelo %s", modelo_id)
        raise HTTPException(status_code=500, detail="Erro ao excluir o modelo.") from None


# ---------------------------------------------------------------------------
# Inspeções
# ---------------------------------------------------------------------------


@router.get("/", summary="Lista inspeções")
def listar_inspecoes(
    busca: str | None = Query(None),
    obra_id: int | None = None,
    atividade_id: int | None = None,
    modelo_id: int | None = None,
    status: str | None = None,
    data_inicio: str | None = None,
    data_fim: str | None = None,
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    try:
        query = db.table("inspecoes").select("*")
        if not eh_gestor(usuario):
            query = query.eq("usuario_id", usuario.id)
        if obra_id is not None:
            query = query.eq("obra_id", obra_id)
        if atividade_id is not None:
            query = query.eq("atividade_id", atividade_id)
        if modelo_id is not None:
            query = query.eq("modelo_id", modelo_id)
        if status:
            if status not in STATUS_VALIDOS:
                raise HTTPException(status_code=400, detail="Status inválido.")
            query = query.eq("status", status)
        termo = _termo_busca_seguro(busca)
        if termo:
            query = query.or_(
                f"codigo.ilike.%{termo}%,local_inspecao.ilike.%{termo}%,inspetor_nome.ilike.%{termo}%,"
                f"atividade_nome.ilike.%{termo}%,modelo_nome.ilike.%{termo}%"
            )
        inicio = parse_data(data_inicio) if data_inicio else None
        fim = parse_data(data_fim) if data_fim else None
        if inicio:
            query = query.gte("data_inspecao", inicio.isoformat())
        if fim:
            query = query.lte("data_inspecao", fim.isoformat())
        linhas = query.order("id", desc=True).limit(500).execute().data or []
        return _lista_com_obras(db, linhas)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao listar inspeções")
        raise HTTPException(status_code=500, detail="Erro ao listar as inspeções.") from None


@router.post("/", status_code=201, summary="Cria inspeção (rascunho)")
def criar_inspecao_online(
    payload: InspecaoIn,
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    try:
        resultado = criar_inspecao(db, usuario, payload.model_dump())
        inspecao = buscar_inspecao(db, resultado["inspecao_id"])
        return _detalhe(db, inspecao)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao criar inspeção")
        raise HTTPException(status_code=500, detail="Erro ao criar a inspeção.") from None


@router.post("/sincronizar", summary="Sincroniza inspeções feitas offline")
def sincronizar(
    payload: SincronizarIn,
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    """Aplica em ordem as operações do dispositivo e devolve um resultado por id_local.

    ``criar_inspecao`` é idempotente por (dispositivo, id_local) e também
    confere a chave gravada em ``inspecoes.origem_*``.
    """
    dispositivo = (payload.dispositivo or "")[:120]
    resultados = []

    def _op_existente(id_local: str):
        resp = (
            db.table("inspecao_sync_ops")
            .select("*")
            .eq("dispositivo", dispositivo)
            .eq("id_local", id_local)
            .limit(1)
            .execute()
        )
        if not resp.data:
            return None
        existente = resp.data[0]
        if existente.get("usuario_id") not in (None, usuario.id):
            raise HTTPException(status_code=403, detail="Esta operação pertence a outro usuário.")
        return existente

    def _gravar_resultado(op, ok, resposta, status="ok", erro=None, inspecao_id=None):
        registro = {
            "dispositivo": dispositivo,
            "id_local": op.id_local[:120],
            "inspecao_id": inspecao_id,
            "tipo": op.tipo[:40],
            "criado_em": op.criado_em,
            "payload": op.payload,
            "status": status,
            "resposta": resposta,
            "erro": erro,
            "usuario_id": usuario.id,
        }
        existente = _op_existente(op.id_local)
        if existente:
            if existente.get("status") == "ok":
                return existente
            db.table("inspecao_sync_ops").update(registro).eq("id", existente["id"]).execute()
        else:
            try:
                db.table("inspecao_sync_ops").insert(registro).execute()
            except Exception:
                # Corrida entre duas sincronizações do mesmo lote: a primeira
                # grava; a segunda apenas relê.
                logger.warning("Corrida ao registrar sync de inspeção %s", op.id_local)
        return registro

    for op in payload.operacoes:
        try:
            existente = _op_existente(op.id_local)
            if existente and existente.get("status") == "ok":
                resposta = existente.get("resposta") or {}
                resultados.append(
                    _resposta_da_operacao(
                        True,
                        id_local=op.id_local,
                        duplicada=True,
                        inspecao_id=resposta.get("inspecao_id"),
                        codigo=resposta.get("codigo"),
                    )
                )
                continue

            if op.tipo == "criar_inspecao":
                origem = (
                    db.table("inspecoes")
                    .select("*")
                    .eq("origem_dispositivo", dispositivo)
                    .eq("origem_id_local", op.id_local)
                    .limit(1)
                    .execute()
                    .data
                )
                if origem:
                    inspecao = origem[0]
                    if not eh_gestor(usuario) and int(inspecao.get("usuario_id") or 0) != int(usuario.id):
                        raise HTTPException(status_code=403, detail="Acesso negado a esta inspeção.")
                    resposta = {
                        "inspecao_id": inspecao["id"],
                        "codigo": inspecao.get("codigo"),
                    }
                    _gravar_resultado(op, True, resposta, inspecao_id=inspecao["id"])
                    resultados.append(
                        _resposta_da_operacao(
                            True,
                            id_local=op.id_local,
                            duplicada=True,
                            inspecao_id=inspecao["id"],
                            codigo=inspecao.get("codigo"),
                        )
                    )
                    continue
                dados = InspecaoIn.model_validate(op.payload)
                criada = criar_inspecao(
                    db,
                    usuario,
                    dados.model_dump(),
                    origem_dispositivo=dispositivo,
                    origem_id_local=op.id_local,
                )
                resposta = {
                    "inspecao_id": criada["inspecao_id"],
                    "codigo": criada["codigo"],
                    "itens": criada.get("itens") or {},
                }
                _gravar_resultado(op, True, resposta, inspecao_id=criada["inspecao_id"])
                resultados.append(
                    _resposta_da_operacao(
                        True,
                        id_local=op.id_local,
                        inspecao_id=criada["inspecao_id"],
                        codigo=criada["codigo"],
                        itens=criada.get("itens") or {},
                    )
                )
            elif op.tipo == "salvar_inspecao":
                if not op.inspecao_id:
                    raise HTTPException(status_code=400, detail="Operação sem inspecao_id.")
                inspecao = buscar_inspecao(db, op.inspecao_id)
                dados = SalvarInspecaoIn.model_validate(op.payload)
                atualizar_inspecao(db, usuario, inspecao, dados.model_dump(exclude_unset=True))
                resposta = {"inspecao_id": inspecao["id"], "codigo": inspecao.get("codigo")}
                _gravar_resultado(op, True, resposta, inspecao_id=inspecao["id"])
                resultados.append(
                    _resposta_da_operacao(
                        True,
                        id_local=op.id_local,
                        inspecao_id=inspecao["id"],
                        codigo=inspecao.get("codigo"),
                    )
                )
            elif op.tipo == "finalizar_inspecao":
                if not op.inspecao_id:
                    raise HTTPException(status_code=400, detail="Operação sem inspecao_id.")
                inspecao = buscar_inspecao(db, op.inspecao_id)
                resposta = finalizar_inspecao(db, usuario, inspecao)
                _gravar_resultado(op, True, resposta, inspecao_id=inspecao["id"])
                resultados.append(
                    _resposta_da_operacao(
                        True,
                        id_local=op.id_local,
                        inspecao_id=inspecao["id"],
                        codigo=inspecao.get("codigo"),
                        ja_concluida=resposta.get("ja_concluida"),
                    )
                )
            else:
                raise HTTPException(status_code=400, detail=f"Tipo de operação desconhecido: {op.tipo}.")
        except HTTPException as exc:
            erro = str(exc.detail)
            # A operação pode pertencer a outro usuário do mesmo dispositivo:
            # nesse caso o registro de sync não é sobrescrito (o erro 403 já é
            # devolvido ao dispositivo atual).
            with contextlib.suppress(HTTPException):
                _gravar_resultado(
                    op,
                    False,
                    {"ok": False, "status": exc.status_code, "erro": erro},
                    status="erro",
                    erro=erro,
                    inspecao_id=op.inspecao_id,
                )
            resultados.append(
                _resposta_da_operacao(False, id_local=op.id_local, status=exc.status_code, erro=erro)
            )
        except Exception as exc:
            logger.exception("Erro ao processar operação offline de inspeção %s", op.id_local)
            erro = str(exc) or "Erro ao processar a operação."
            _gravar_resultado(
                op,
                False,
                {"ok": False, "status": 500, "erro": erro},
                status="erro",
                erro=erro,
                inspecao_id=op.inspecao_id,
            )
            resultados.append(_resposta_da_operacao(False, id_local=op.id_local, status=500, erro=erro))

    return {"resultados": resultados}


@router.get("/{inspecao_id}", summary="Detalhe da inspeção")
def obter_inspecao(
    inspecao_id: int,
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    try:
        inspecao = buscar_inspecao(db, inspecao_id)
        garantir_acesso_inspecao(usuario, inspecao)
        return _detalhe(db, inspecao)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao obter inspeção %s", inspecao_id)
        raise HTTPException(status_code=500, detail="Erro ao obter a inspeção.") from None


@router.put("/{inspecao_id}/respostas/{item_id}", summary="Responde um item da inspeção")
def responder_item(
    inspecao_id: int,
    item_id: int,
    payload: RespostaIn,
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    try:
        inspecao = buscar_inspecao(db, inspecao_id)
        garantir_acesso_inspecao(usuario, inspecao)
        if inspecao.get("status") != "rascunho":
            raise HTTPException(status_code=409, detail="A inspeção já foi encerrada e não pode ser alterada.")
        item = (
            db.table("inspecao_itens")
            .select("id, inspecao_id, classificacao")
            .eq("id", item_id)
            .eq("inspecao_id", inspecao_id)
            .limit(1)
            .execute()
            .data
        )
        if not item:
            raise HTTPException(status_code=404, detail="Item da inspeção não encontrado.")
        resposta = payload.resposta.strip().lower()
        if resposta not in RESPOSTAS_VALIDAS:
            raise HTTPException(status_code=400, detail="Resposta inválida. Use conforme, nao_conforme ou na.")
        db.table("inspecao_respostas").upsert(
            {
                "item_id": item_id,
                "resposta": resposta,
                "observacao": (payload.observacao or "").strip() or None,
                "respondido_por": usuario.email,
                "geolocalizacao": payload.geolocalizacao,
            },
            on_conflict="item_id",
        ).execute()
        return _detalhe(db, buscar_inspecao(db, inspecao_id))
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao responder item %s da inspeção %s", item_id, inspecao_id)
        raise HTTPException(status_code=500, detail="Erro ao salvar a resposta da inspeção.") from None


@router.post("/{inspecao_id}/fotos", status_code=201, summary="Anexa foto a um item")
async def enviar_foto(
    inspecao_id: int,
    arquivo: UploadFile = File(...),
    classificacao: str = Form(...),
    id_local: str | None = Form(None, max_length=120),
    dispositivo: str | None = Form(None, max_length=120),
    capturado_em: str | None = Form(None, max_length=40),
    geolocalizacao: str | None = Form(None, max_length=100),
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    try:
        inspecao = buscar_inspecao(db, inspecao_id)
        garantir_acesso_inspecao(usuario, inspecao)
        if inspecao.get("status") != "rascunho":
            raise HTTPException(status_code=409, detail="Evidências não podem ser alteradas após a finalização.")
        item = (
            db.table("inspecao_itens")
            .select("id, classificacao")
            .eq("inspecao_id", inspecao_id)
            .eq("classificacao", str(classificacao or "").strip())
            .limit(1)
            .execute()
            .data
        )
        if not item:
            raise HTTPException(status_code=404, detail="Item da inspeção não encontrado.")
        mime = (arquivo.content_type or "").lower()
        extensao = MIMES_FOTO_PERMITIDOS.get(mime)
        if not extensao:
            raise HTTPException(status_code=400, detail="Tipo de arquivo não permitido. Envie JPG, PNG ou WEBP.")
        conteudo = await ler_upload_limitado_async(
            arquivo,
            TAMANHO_MAXIMO_FOTO_BYTES,
            mensagem_limite="Arquivo excede o limite de 15 MB.",
        )
        validar_magia_documento(mime, conteudo)
        ref = _ref_sync(dispositivo, id_local)
        sufixo = f"s_{ref}" if ref else uuid.uuid4().hex
        bucket_key = f"inspecao_fotos/{inspecao_id}/item_{item[0]['id']}_{sufixo}{extensao}"
        if ref:
            existente = (
                db.table("inspecao_fotos")
                .select("*")
                .eq("bucket_key", bucket_key)
                .limit(1)
                .execute()
                .data
            )
            if existente:
                return _foto_publica(get_s3_client(), existente[0])
        s3 = get_s3_client()
        s3.put_object(Bucket=bucket(), Key=bucket_key, Body=conteudo, ContentType=mime)
        nome_original = nome_arquivo_seguro(arquivo.filename or f"item_{item[0]['id']}.jpg")
        resp = db.table("inspecao_fotos").insert(
            {
                "inspecao_id": inspecao_id,
                "item_id": item[0]["id"],
                "nome_original": nome_original,
                "tamanho_bytes": len(conteudo),
                "mime_type": mime,
                "bucket_key": bucket_key,
                "enviado_por": usuario.email,
                "geolocalizacao": geolocalizacao or None,
                "capturado_em": _capturado_em_ou_none(capturado_em),
            }
        ).execute()
        if not resp.data:
            _remover_objeto(s3, bucket_key)
            raise HTTPException(status_code=500, detail="Falha ao salvar a foto.")
        return _foto_publica(s3, resp.data[0])
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao enviar foto da inspeção %s", inspecao_id)
        raise HTTPException(status_code=500, detail="Erro ao enviar a foto.") from None


@router.get("/{inspecao_id}/fotos/{foto_id}/arquivo", summary="Baixa o arquivo de uma foto")
def baixar_foto(
    inspecao_id: int,
    foto_id: int,
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    try:
        inspecao = buscar_inspecao(db, inspecao_id)
        garantir_acesso_inspecao(usuario, inspecao)
        foto = (
            db.table("inspecao_fotos")
            .select("*")
            .eq("id", foto_id)
            .eq("inspecao_id", inspecao_id)
            .limit(1)
            .execute()
            .data
        )
        if not foto:
            raise HTTPException(status_code=404, detail="Foto não encontrada.")
        corpo = get_s3_client().get_object(Bucket=bucket(), Key=foto[0]["bucket_key"])["Body"].read()
        return Response(content=corpo, media_type=foto[0].get("mime_type") or "application/octet-stream")
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao baixar foto %s da inspeção %s", foto_id, inspecao_id)
        raise HTTPException(status_code=500, detail="Erro ao baixar a foto.") from None


@router.delete("/{inspecao_id}/fotos/{foto_id}", summary="Remove uma foto do rascunho")
def excluir_foto(
    inspecao_id: int,
    foto_id: int,
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    try:
        inspecao = buscar_inspecao(db, inspecao_id)
        garantir_acesso_inspecao(usuario, inspecao)
        if inspecao.get("status") != "rascunho":
            raise HTTPException(status_code=409, detail="Evidências não podem ser alteradas após a finalização.")
        foto = (
            db.table("inspecao_fotos")
            .select("*")
            .eq("id", foto_id)
            .eq("inspecao_id", inspecao_id)
            .limit(1)
            .execute()
            .data
        )
        if not foto:
            raise HTTPException(status_code=404, detail="Foto não encontrada.")
        db.table("inspecao_fotos").delete().eq("id", foto_id).execute()
        _remover_objeto(get_s3_client(), foto[0]["bucket_key"])
        return {"success": True, "message": "Foto removida."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao excluir foto %s da inspeção %s", foto_id, inspecao_id)
        raise HTTPException(status_code=500, detail="Erro ao excluir a foto.") from None


@router.post("/{inspecao_id}/finalizar", summary="Finaliza a inspeção")
def finalizar(
    inspecao_id: int,
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    try:
        inspecao = buscar_inspecao(db, inspecao_id)
        finalizar_inspecao(db, usuario, inspecao)
        return _detalhe(db, buscar_inspecao(db, inspecao_id))
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao finalizar inspeção %s", inspecao_id)
        raise HTTPException(status_code=500, detail="Erro ao finalizar a inspeção.") from None


@router.post("/{inspecao_id}/cancelar", dependencies=GESTOR_ONLY, summary="Cancela a inspeção")
def cancelar(
    inspecao_id: int,
    payload: CancelamentoIn,
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    """Cancelamento com motivo (gestor)."""
    try:
        inspecao = buscar_inspecao(db, inspecao_id)
        if inspecao.get("status") == "cancelada":
            return _detalhe(db, inspecao)
        motivo = payload.motivo.strip()
        db.table("inspecoes").update(
            {
                "status": "cancelada",
                "cancelada_por": usuario.email,
                "cancelada_em": datetime.now(UTC).isoformat(),
                "motivo_cancelamento": motivo,
            }
        ).eq("id", inspecao_id).execute()
        return _detalhe(db, buscar_inspecao(db, inspecao_id))
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao cancelar inspeção %s", inspecao_id)
        raise HTTPException(status_code=500, detail="Erro ao cancelar a inspeção.") from None


@router.delete("/{inspecao_id}", summary="Exclui a inspeção")
def excluir_inspecao(
    inspecao_id: int,
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    try:
        inspecao = buscar_inspecao(db, inspecao_id)
        garantir_acesso_inspecao(usuario, inspecao)
        if not eh_gestor(usuario) and inspecao.get("status") != "rascunho":
            raise HTTPException(status_code=403, detail="Somente o gestor pode excluir inspeções encerradas.")
        fotos = (
            db.table("inspecao_fotos").select("bucket_key").eq("inspecao_id", inspecao_id).execute().data
            or []
        )
        db.table("inspecoes").delete().eq("id", inspecao_id).execute()
        s3 = get_s3_client()
        for foto in fotos:
            _remover_objeto(s3, foto.get("bucket_key"))
        return {"success": True, "message": "Inspeção excluída."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao excluir inspeção %s", inspecao_id)
        raise HTTPException(status_code=500, detail="Erro ao excluir a inspeção.") from None


@router.get("/{inspecao_id}/pdf", summary="Gera o PDF da inspeção")
def gerar_pdf(
    inspecao_id: int,
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    try:
        inspecao = buscar_inspecao(db, inspecao_id)
        garantir_acesso_inspecao(usuario, inspecao)
        detalhe = _detalhe(db, inspecao)
        obra = detalhe.get("obra") or {}
        caminho = None

        # As fotos do PDF são baixadas novamente, sem as URLs temporárias.
        itens_pdf = itens_com_respostas(db, inspecao_id)
        s3 = get_s3_client() if any(i.get("fotos") for i in itens_pdf) else None
        total_bytes = {"valor": 0}

        def _baixar_foto(chave):
            if s3 is None:
                return None
            try:
                corpo = s3.get_object(Bucket=bucket(), Key=chave)["Body"].read()
            except Exception:
                logger.exception("Erro ao baixar foto %s para o PDF da inspeção", chave)
                return None
            total_bytes["valor"] += len(corpo)
            if total_bytes["valor"] > TETO_FOTOS_PDF_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail="As evidências desta inspeção excedem o limite do relatório (60 MB).",
                )
            return corpo

        from utils.pdf_inspecao import gerar_pdf_inspecao

        inspecao_pdf = dict(detalhe["inspecao"])
        inspecao_pdf["obra_nome"] = obra.get("nome")
        inspecao_pdf["obra_cliente"] = obra.get("cliente")
        inspecao_pdf["obra_endereco"] = obra.get("endereco")
        inspecao_pdf["obra_cidade"] = obra.get("cidade")
        caminho = gerar_pdf_inspecao(
            inspecao=inspecao_pdf,
            itens=itens_pdf,
            assinantes=detalhe.get("assinantes") or [],
            baixar_foto=_baixar_foto,
        )
        return FileResponse(
            caminho,
            media_type="application/pdf",
            filename=f"{inspecao.get('codigo') or 'inspecao'}_inspecao.pdf",
            background=BackgroundTask(_remover_arquivo, caminho),
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao gerar PDF da inspeção %s", inspecao_id)
        raise HTTPException(status_code=500, detail="Erro ao gerar o PDF da inspeção.") from None
