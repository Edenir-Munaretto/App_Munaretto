"""Módulo Controle de Ordens de Serviço (O.S.) de obras.

Regras de negócio centrais:
- Máquina de estados com transições válidas (ver TRANSICOES_STATUS);
- Trava de status 'Impedida': justificativa obrigatória (>= 20 caracteres)
  e pelo menos uma foto de evidência já anexada à O.S.;
- Apontamento de horas (H.H.) com Play/Pause e cálculo do Custo Real de
  Mão de Obra (zerado até que o valor da hora seja definido por equipe);
- Lançamento de serviços/materiais com conversão para USC (normal/especial)
  e resumo de totais aplicados;
- Permissão granular: usuários com "configuracoes"/"dashboard" são gestores
  (vêem tudo); demais usuários só acessam O.S das equipes em que atuam
  (vínculo pelo funcionário selecionado em Configurações → Usuários).
"""

import contextlib
import logging
import os
import re
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, ValidationError, field_validator
from starlette.background import BackgroundTask

from auth import UsuarioAutenticado, get_current_user, require_qualquer_permisao
from storage import bucket, get_s3_client
from supabase_client import get_supabase
from utils.checklist_os import (
    GRUPO_LIBERACAO_INICIO,
    RESPOSTAS_VALIDAS,
    itens_com_respostas,
    pendentes_para_conclusao,
    resumo_checklist,
    snapshot_checklist,
)
from utils.tipos_os import ROTULOS_TIPO, TIPOS_OS

# O módulo é acessível ao gestor ("os") e ao usuário de campo ("os_campo").
# O usuário de campo enxerga apenas as O.S das equipes em que atua e executa
# tarefas (status, H.H., fotos, materiais, impressão); ações de gestão
# (criar/editar O.S, estorno, exclusão de evidências) exigem "os".
router = APIRouter(dependencies=[Depends(require_qualquer_permisao(["os", "os_campo"]))])

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constantes de negócio
# ---------------------------------------------------------------------------

STATUS_VALIDOS = {"rascunho", "aberta", "em_andamento", "impedida", "concluida", "cancelada"}
PRIORIDADES = {"baixa", "media", "alta", "critica"}
# Tipo da O.S (fonte única em utils/tipos_os): define o modelo de impressão
# (CONSTRUÇÃO e MANUTENÇÃO usam o mesmo layout; LINHA VIVA tem modelo próprio).

# Manutenção e Linha Viva usam listas parecidas, mas são CONTRATOS
# INDEPENDENTES: cada contrato tem o SEU catálogo de serviços.
def _validar_servico_do_contrato(db, produto_id: int, tipo_os: str) -> dict:
    """Garante que o serviço pertence ao catálogo do contrato (tipo) da O.S.

    Contratos são isolados: o serviço só pode ser lançado na O.S do MESMO
    contrato. Serviços legados (produtos.tipo NULL) valem para todos.
    """
    resp = db.table("produtos").select(
        "id, nome, tipo, preco_unitario, qtd_usc_especial, codigo, codigo_especial"
    ).eq("id", produto_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Serviço não encontrado.")
    produto = resp.data[0]
    tipo_servico = produto.get("tipo")
    if tipo_servico and tipo_servico != tipo_os:
        raise HTTPException(
            status_code=422,
            detail=(
                f"O serviço '{produto.get('nome')}' pertence ao contrato de "
                f"{ROTULOS_TIPO.get(tipo_servico, tipo_servico)} e não pode ser "
                f"lançado em uma O.S de {ROTULOS_TIPO.get(tipo_os, tipo_os)}."
            ),
        )
    return produto

# Máquina de estados: origem -> destinos permitidos. Qualquer transição fora
# deste mapa é rejeitada com 422 (evita saltos como Rascunho -> Concluída).
# O.S concluída/cancelada podem ser REABERTAS pelo gestor (-> aberta) com
# justificativa registrada no histórico (decisão de negócio nº 2).
TRANSICOES_STATUS = {
    "rascunho": {"aberta", "cancelada"},
    "aberta": {"em_andamento", "impedida", "cancelada"},
    "em_andamento": {"impedida", "concluida", "cancelada"},
    "impedida": {"em_andamento"},
    "concluida": {"aberta"},
    "cancelada": {"aberta"},
}

MIN_JUSTIFICATIVA_IMPEDIDA = 20
MIN_REABERTURA_CARACTERES = 10
MIMES_FOTO_PERMITIDOS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
TAMANHO_MAXIMO_FOTO_BYTES = 15 * 1024 * 1024
VALIDADE_PRESIGNED_SEGUNDOS = 15 * 60

# Apontamento de horas vindo do tablet offline: tolerância de relógio e teto
# de duração para horários 'inicio'/'fim' carregados pelo sync.
TOLERANCIA_RELOGIO_SEGUNDOS = 5 * 60
MAX_DURACAO_BLOCO_HH = timedelta(hours=24)

PERMISSOES_GESTOR = {"configuracoes", "dashboard", "os"}

# ---------------------------------------------------------------------------
# Schemas Pydantic
# ---------------------------------------------------------------------------


def _validar_hora(valor):
    """Aceita None/'' ou hora no formato HH:MM (usada no modelo de impressão)."""
    if valor in (None, ""):
        return None
    if not re.fullmatch(r"\d{2}:\d{2}", str(valor)):
        raise ValueError("Formato inválido. Use HH:MM (ex.: 08:30).")
    return valor


def _validar_data_iso(valor):
    """Aceita None/'' ou data ISO YYYY-MM-DD."""
    if valor in (None, ""):
        return None
    try:
        datetime.fromisoformat(str(valor))
    except ValueError:
        raise ValueError("Data inválida. Use o formato AAAA-MM-DD.") from None
    return valor


class OSCreate(BaseModel):
    obra_id: int
    equipe_id: int | None = None
    prioridade: str = Field("media")
    prazo_entrega: str | None = None  # ISO date (YYYY-MM-DD)
    descricao_escopo: str | None = None
    custo_mo_orcado: float = Field(0, ge=0)
    # Campos do modelo de impressão (capa da O.S).
    tipo: str = Field("construcao", description="'construcao' ou 'linha_viva' (define o modelo de impressão)")
    agencia: str | None = None
    municipio: str | None = None
    local_servico: str | None = None
    bt_energizado: bool = False
    at_energizado_bloqueio: bool = False
    bloqueio: bool = False
    hora_desligar: str | None = None  # "HH:MM"
    hora_religar: str | None = None
    alimentador: str | None = None
    chave: str | None = None
    obs: str | None = None

    _val_hora = field_validator("hora_desligar", "hora_religar")(_validar_hora)
    _val_prazo = field_validator("prazo_entrega")(_validar_data_iso)


class OSUpdate(BaseModel):
    equipe_id: int | None = None
    prioridade: str = Field("media")
    prazo_entrega: str | None = None
    descricao_escopo: str | None = None
    custo_mo_orcado: float = Field(0, ge=0)
    tipo: str = Field("construcao")
    agencia: str | None = None
    municipio: str | None = None
    local_servico: str | None = None
    bt_energizado: bool = False
    at_energizado_bloqueio: bool = False
    bloqueio: bool = False
    hora_desligar: str | None = None
    hora_religar: str | None = None
    alimentador: str | None = None
    chave: str | None = None
    obs: str | None = None

    _val_hora = field_validator("hora_desligar", "hora_religar")(_validar_hora)
    _val_prazo = field_validator("prazo_entrega")(_validar_data_iso)


class StatusUpdate(BaseModel):
    novo_status: str
    justificativa: str | None = None
    # IDs de fotos já enviadas à O.S usadas como evidência do impedimento.
    fotos_ids: list[int] = Field(default_factory=list)
    geolocalizacao: str | None = Field(None, max_length=100, description="'lat,lng' do dispositivo")


class MaterialLancamento(BaseModel):
    produto_id: int
    # Quantidade de PEÇAS aplicadas (não convertida). O backend converte para
    # USC multiplicando pelo fator do cadastro do produto conforme o tipo.
    quantidade_usada: float = Field(..., gt=0)
    tipo_usc: str = Field("normal", description="'normal' (Qtd USC) ou 'especial' (Qtd USC especial)")
    observacao: str | None = None


class ApontamentoAcao(BaseModel):
    acao: str = Field(..., description="'play' para iniciar ou 'pause' para encerrar o bloco")


# ---------------------------------------------------------------------------
# Sincronização offline (Modo Campo)
# ---------------------------------------------------------------------------
# Operações aceitas no lote de sincronização enviado pelo tablet ao voltar
# para a base. Cada operação é revalidada no servidor na ordem cronológica.
TIPOS_SYNC_VALIDOS = {
    "checklist_resposta",
    "status",
    "apontamento_play",
    "apontamento_pause",
    "material",
}


class OperacaoSyncIn(BaseModel):
    id_local: str = Field(..., max_length=64, description="Identificador local único da operação (uuid do tablet)")
    tipo: str = Field(
        ...,
        description="'checklist_resposta', 'status', 'apontamento_play', 'apontamento_pause' ou 'material'",
    )
    os_id: int
    criado_em: str | None = Field(None, description="Timestamp ISO no momento em que a ação foi feita no dispositivo")
    payload: dict = Field(default_factory=dict)


class SincronizarIn(BaseModel):
    operacoes: list[OperacaoSyncIn] = Field(default_factory=list, max_length=500)
    # Fotos enviadas ANTES do lote: mapeia id_local da foto (uuid do tablet)
    # -> id do registro no servidor. Usado em operações 'status' cujo payload
    # referencia evidências tiradas offline (fotos_ids com ids locais).
    mapa_fotos: dict[str, int] = Field(default_factory=dict)
    # Identificador persistente do dispositivo (guardado no IndexedDB do
    # tablet). Forma, junto com o id_local, a chave de idempotência do lote
    # (tabela sync_ops): se a resposta se perder, o reenvio devolve a resposta
    # já gravada em vez de aplicar a operação de novo.
    dispositivo: str = Field(default="", max_length=64)


# ---------------------------------------------------------------------------
# Helpers internos
# ---------------------------------------------------------------------------


def _agora() -> datetime:
    return datetime.now(UTC)


def _remover_arquivo(caminho: str) -> None:
    """Remove um arquivo temporário após o envio (background do FileResponse)."""
    with contextlib.suppress(OSError):
        os.remove(caminho)


def _remover_objeto(s3, chave: str) -> None:
    """Remove um objeto do bucket de forma tolerante (log em vez de derrubar)."""
    try:
        s3.delete_object(Bucket=bucket(), Key=chave)
    except Exception:
        logger.exception("Erro ao remover objeto %s do B2", chave)


def _termo_busca_seguro(termo: str | None) -> str:
    """Remove caracteres da gramática do PostgREST (or_/ilike/in) que, se
    digitados pelo usuário, derrubariam a busca com 500: `( ) , . % : ; "`
    e colchetes. O termo volta apenas com letras/números/espaços/tracos."""
    if not termo:
        return ""
    return re.sub(r"[(),.%:;\"\\\[\]]", "", termo).strip()


def _e_gestor(usuario: UsuarioAutenticado) -> bool:
    """Gestores têm visão completa; usuários de campo veem apenas suas equipes."""
    return any(p in PERMISSOES_GESTOR for p in (usuario.permissoes or []))


def _e_gestor_os(usuario: UsuarioAutenticado) -> bool:
    """Gestor do módulo O.S: quem possui a permissão 'os'."""
    return "os" in (usuario.permissoes or [])


def _exigir_gestor(usuario: UsuarioAutenticado) -> None:
    """Ações de gestão do módulo O.S são restritas a quem tem a permissão 'os'."""
    if not _e_gestor_os(usuario):
        raise HTTPException(
            status_code=403,
            detail="Esta ação é restrita ao gestor de O.S.",
        )


def _funcionario_do_usuario(db, usuario: UsuarioAutenticado) -> dict | None:
    """Funcionário vinculado ao usuário (definido em Configurações → Usuários)."""
    if not usuario.funcionario_id:
        return None
    resp = db.table("funcionarios").select("*").eq("id", usuario.funcionario_id).limit(1).execute()
    return resp.data[0] if resp.data else None


def _equipes_do_usuario(db, usuario: UsuarioAutenticado) -> list[int]:
    func = _funcionario_do_usuario(db, usuario)
    if not func:
        return []
    resp = db.table("equipe_membros").select("equipe_id").eq("funcionario_id", func["id"]).execute()
    return [m["equipe_id"] for m in resp.data]


def _garantir_acesso_os(db, usuario: UsuarioAutenticado, os_data: dict) -> None:
    """Usuário de campo só pode acessar O.S da própria equipe."""
    if _e_gestor(usuario):
        return
    equipes_usuario = _equipes_do_usuario(db, usuario)
    if not equipes_usuario or os_data.get("equipe_id") not in equipes_usuario:
        raise HTTPException(
            status_code=403,
            detail="Você não tem acesso a esta Ordem de Serviço.",
        )


def _os_ou_404(db, os_id: int) -> dict:
    resp = db.table("ordens_servico").select("*").eq("id", os_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Ordem de Serviço não encontrada.")
    return resp.data[0]


def _gerar_codigo_os(db) -> str:
    """Gera código único no formato OS-<ANO>-<NNNN> (sequencial por ano).

    Em caso de colisão (duas criações simultâneas), tenta o próximo número.
    """
    ano = _agora().year
    prefixo = f"OS-{ano}-"
    for _ in range(10):
        existentes = db.table("ordens_servico").select("codigo").like("codigo", f"{prefixo}%").execute()
        maior = 0
        for linha in existentes.data or []:
            try:
                maior = max(maior, int(linha["codigo"].rsplit("-", 1)[1]))
            except (ValueError, IndexError):
                continue
        codigo = f"{prefixo}{maior + 1:04d}"
        # Confirma que o candidato ainda não existe (criação concorrente).
        duplicado = db.table("ordens_servico").select("id").eq("codigo", codigo).execute()
        if not duplicado.data:
            return codigo
        logger.warning("Código %s já reservado em criação concorrente; tentando o próximo.", codigo)
    raise RuntimeError("Não foi possível gerar um código único para a O.S.")


def _gravar_historico(
    db,
    os_id: int,
    anterior: str | None,
    novo: str,
    justificativa: str | None,
    usuario_email: str | None,
    geolocalizacao: str | None,
) -> None:
    db.table("os_historico").insert(
        {
            "os_id": os_id,
            "status_anterior": anterior,
            "status_novo": novo,
            "justificativa": justificativa,
            "usuario_alteracao": usuario_email,
            "geolocalizacao_log": geolocalizacao,
        }
    ).execute()


def _notificar_criador(db, os_data: dict, novo_status: str, ator_email: str | None) -> None:
    """Avisa o criador da O.S sobre eventos relevantes (impedimento/conclusão)."""
    destino = os_data.get("criado_por")
    if not destino or (ator_email and destino.lower() == (ator_email or "").lower()):
        return
    mensagens = {
        "impedida": f"A O.S {os_data['codigo']} foi IMPEDIDA.",
        "concluida": f"A O.S {os_data['codigo']} foi CONCLUÍDA.",
        "cancelada": f"A O.S {os_data['codigo']} foi CANCELADA.",
    }
    texto = mensagens.get(novo_status)
    if not texto:
        return
    try:
        db.table("notificacoes").insert(
            {
                "tipo": "os",
                "titulo": f"Controle de O.S - {novo_status.capitalize()}",
                "mensagem": texto,
                "destinatario": destino,
            }
        ).execute()
    except Exception:
        logger.exception("Falha ao criar notificação para %s", destino)


def _parse_ts(valor):
    """Converte timestamp ISO do banco para datetime (tolerante a formatos
    como '+00:00', 'Z', microsegundos). Retorna None se inválido."""
    if not valor:
        return None
    try:
        dt = datetime.fromisoformat(str(valor).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
    except (ValueError, TypeError):
        return None


def _encerrar_apontamentos_abertos(db, os_id: int) -> None:
    """Ao concluir/cancelar uma O.S, fecha qualquer cronômetro esquecido aberto."""
    abertos = db.table("os_apontamentos").select("*").eq("os_id", os_id).is_("fim", "null").execute()
    for apt in abertos.data or []:
        inicio = _parse_ts(apt.get("inicio"))
        minutos = 0 if inicio is None else max(0, int(((_agora() - inicio).total_seconds()) // 60))
        db.table("os_apontamentos").update(
            {
                "fim": _agora().isoformat(),
                "minutos_trabalhados": minutos,
            }
        ).eq("id", apt["id"]).execute()


def _validar_transicao_impedida(db, os_data: dict, payload: StatusUpdate) -> str:
    """Regra crítica: 'Impedida' exige justificativa descritiva + evidências.

    Retorna a justificativa validada ou levanta HTTP 422 explicando o motivo.
    """
    justificativa = (payload.justificativa or "").strip()
    if len(justificativa) < MIN_JUSTIFICATIVA_IMPEDIDA:
        raise HTTPException(
            status_code=422,
            detail=(
                "Para marcar a O.S como IMPEDIDA é obrigatória uma justificativa "
                f"descritiva com no mínimo {MIN_JUSTIFICATIVA_IMPEDIDA} caracteres."
            ),
        )
    fotos_ids = list(dict.fromkeys(payload.fotos_ids))
    if not fotos_ids:
        raise HTTPException(
            status_code=422,
            detail="Para marcar a O.S como IMPEDIDA é obrigatório anexar ao menos uma foto de evidência.",
        )
    evidencias = db.table("os_fotos").select("id").eq("os_id", os_data["id"]).in_("id", fotos_ids).execute()
    if len(evidencias.data or []) != len(fotos_ids):
        raise HTTPException(
            status_code=422,
            detail="Uma ou mais fotos informadas não pertencem a esta O.S.",
        )
    return justificativa


def _resumo_materiais(db, os_id: int) -> dict:
    """Total aplicado por produto, com desdobramento por tipo de USC.

    A quantidade já vem convertida para USC no lançamento (peças x fator) e o
    resumo usa SEMPRE os valores registrados no lançamento (quantidade_pecas,
    fator_usc) — mudanças posteriores no cadastro do serviço não alteram o
    que já foi lançado.
    """
    aplicacoes = (
        db.table("os_materiais")
        .select("produto_id, quantidade_usada, quantidade_pecas, fator_usc, tipo_usc, codigo_servico")
        .eq("os_id", os_id)
        .execute()
    )

    # Catálogo dos produtos envolvidos (consulta única, sem N+1 e sem depender
    # de embedded resources do PostgREST).
    todos_ids = [m["produto_id"] for m in (aplicacoes.data or [])]
    catalogo = {}
    ids_unicos = sorted(set(todos_ids))
    if ids_unicos:
        resp = db.table("produtos").select("id, nome, unidade").in_("id", ids_unicos).execute()
        catalogo = {p["id"]: p for p in resp.data or []}

    por_produto = {}
    for lanc in aplicacoes.data or []:
        pid = lanc["produto_id"]
        p = por_produto.setdefault(
            pid,
            {
                "produto_id": pid,
                "nome": (catalogo.get(pid) or {}).get("nome") or "Produto",
                "unidade": (catalogo.get(pid) or {}).get("unidade") or "-",
                "aplicado": 0.0,
                "aplicado_normal": 0.0,
                "aplicado_especial": 0.0,
                # Linhas para o relatório: um item por (tipo, fator) registrado,
                # para que "peças x USC unit." seja sempre fiel ao lançamento.
                "detalhe": {},
            },
        )
        quantidade = float(lanc["quantidade_usada"])
        tipo = lanc.get("tipo_usc") or "normal"
        fator = float(lanc.get("fator_usc") or 0)
        codigo = (lanc.get("codigo_servico") or "").strip() or None
        p["aplicado"] += quantidade
        if tipo == "especial":
            p["aplicado_especial"] += quantidade
        else:
            p["aplicado_normal"] += quantidade

        linha = p["detalhe"].setdefault(
            (tipo, fator, codigo),
            {"tipo": tipo, "fator": fator, "codigo_servico": codigo, "pecas": 0.0, "total": 0.0},
        )
        linha["pecas"] += float(lanc.get("quantidade_pecas") or 0)
        linha["total"] += quantidade

    itens = sorted(por_produto.values(), key=lambda i: i["nome"] or "")
    for p in itens:
        p["aplicado"] = round(p["aplicado"], 3)
        p["aplicado_normal"] = round(p["aplicado_normal"], 3)
        p["aplicado_especial"] = round(p["aplicado_especial"], 3)
        p["detalhe"] = sorted(p["detalhe"].values(), key=lambda d: (d["tipo"], d["fator"]))
    return {
        "itens": itens,
        "total_aplicado": round(sum(i["aplicado"] for i in itens), 3),
    }


def _resumo_mao_de_obra(db, os_id: int, custo_mo_orcado: float) -> dict:
    """Calcula horas líquidas e Custo Real de M.O. (zerado até definir valor por equipe)."""
    aponts = (
        db.table("os_apontamentos")
        .select("funcionario_id, inicio, fim, minutos_trabalhados")
        .eq("os_id", os_id)
        .execute()
    )

    # Dados dos colaboradores envolvidos em consulta única.
    func_ids = sorted({a["funcionario_id"] for a in (aponts.data or [])})
    funcs = {}
    if func_ids:
        resp = db.table("funcionarios").select("id, nome").in_("id", func_ids).execute()
        funcs = {f["id"]: f for f in resp.data or []}

    agora = _agora()
    total_minutos = 0
    custo_real = 0.0
    por_funcionario = {}
    for apt in aponts.data or []:
        func = funcs.get(apt["funcionario_id"]) or {}
        if apt.get("minutos_trabalhados") is not None:
            minutos = int(apt["minutos_trabalhados"])
        else:
            # Cronômetro ainda aberto: conta o tempo decorrido até agora.
            # Timestamp inválido/ausente não pode derrubar o detalhe da O.S.
            inicio = _parse_ts(apt.get("inicio"))
            minutos = 0 if inicio is None else max(0, int(((agora - inicio).total_seconds()) // 60))
        total_minutos += minutos
        acum = por_funcionario.setdefault(
            apt["funcionario_id"],
            {
                "nome": func.get("nome"),
                "minutos": 0,
                "custo": 0.0,
            },
        )
        acum["minutos"] += minutos

    return {
        "total_horas": round(total_minutos / 60, 2),
        "custo_mo_real": round(custo_real, 2),
        "custo_mo_orcado": round(float(custo_mo_orcado or 0), 2),
        "por_funcionario": sorted(por_funcionario.values(), key=lambda f: -(f["minutos"])),
    }


# ---------------------------------------------------------------------------
# Endpoints - Ordens de Serviço
# ---------------------------------------------------------------------------


@router.get("/transicoes", summary="Máquina de estados (fonte única p/ o frontend)")
def transicoes_status():
    """Retorna a máquina de estados e domínios do módulo, evitando duplicação
    das regras entre backend e frontend."""
    return {
        "transicoes": {origem: sorted(destinos) for origem, destinos in TRANSICOES_STATUS.items()},
        "status_validos": sorted(STATUS_VALIDOS),
        "prioridades": sorted(PRIORIDADES),
        "tipos": sorted(TIPOS_OS),
    }


@router.get("/", summary="Lista O.S (Kanban/filtros)")
def listar_os(
    status: str | None = Query(None),
    prioridade: str | None = Query(None),
    obra_id: int | None = Query(None),
    equipe_id: int | None = Query(None),
    busca: str | None = Query(None, description="Busca por código, escopo, Nota PS ou nome do cliente"),
    limit: int = Query(100, ge=1, le=500, description="Máximo de O.S por página"),
    offset: int = Query(0, ge=0, description="Registros a pular (paginação)"),
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
    response: Response = None,
):
    try:
        # ATENÇÃO: cada consulta usa o PRÓPRIO builder (db.table() → instância
        # nova). Reutilizar o mesmo builder para o total e a página faria o
        # `.limit(1)` do count contaminar a listagem.
        # Busca combinada: código/escopo da O.S, código da obra (obra.nome,
        # onde fica a Nota PS da obra) OU o cliente vinculado (nome do cliente
        # e a Nota PS do cliente). O PostgREST não aceita caminhos embutidos
        # dentro do operador `or`, então as obras candidatas são resolvidas
        # em etapas e convertidas em obra_id.in.(...). É computada uma única
        # vez e reutilizada no total e na página.
        busca_expr = None
        if busca:
            termo = _termo_busca_seguro(busca)
            busca_expr = f"codigo.ilike.%{termo}%,descricao_escopo.ilike.%{termo}%"
            try:
                obra_ids = set()
                # 1) Obras cujo nome (código/Nota PS da obra) ou o Cliente Celesc
                #    casa com o termo.
                obras_por_nome = (
                    db.table("obras")
                    .select("id")
                    .or_(f"nome.ilike.%{termo}%,cliente_celesc.ilike.%{termo}%")
                    .execute()
                    .data
                )
                obra_ids.update(o["id"] for o in obras_por_nome or [])
                # 2) Obras cujo cliente (nome ou Nota PS) casa com o termo.
                clientes_casa = (
                    db.table("clientes")
                    .select("id")
                    .or_(f"nome.ilike.%{termo}%,nota_ps.ilike.%{termo}%")
                    .execute()
                    .data
                )
                if clientes_casa:
                    obras_dos_clientes = (
                        db.table("obras")
                        .select("id")
                        .in_("cliente_id", [c["id"] for c in clientes_casa])
                        .execute()
                        .data
                    )
                    obra_ids.update(o["id"] for o in obras_dos_clientes or [])
                if obra_ids:
                    ids = ",".join(str(i) for i in sorted(obra_ids))
                    busca_expr += f",obra_id.in.({ids})"
            except Exception:
                # Uma falha na busca secundária não pode derrubar a listagem:
                # mantém apenas a busca por código/escopo.
                logger.exception("Falha ao resolver busca por obra/cliente/Nota PS")

        def _aplicar_filtros(q):
            # Permissão granular: usuário de campo só enxerga O.S das suas equipes.
            if not _e_gestor(usuario):
                equipes_usuario = _equipes_do_usuario(db, usuario)
                if not equipes_usuario:
                    return None
                q = q.in_("equipe_id", equipes_usuario)
                # O campo vê apenas as O.S em execução (abertas/em andamento)
                # e as impedidas (para retomar quando desbloquear).
                q = q.in_("status", ("aberta", "em_andamento", "impedida"))
            if status:
                # Aceita uma lista separada por vírgula (ex.: "concluida,cancelada"
                # na visão Encerradas) além do valor único usado no quadro.
                if "," in status:
                    q = q.in_("status", tuple(s.strip() for s in status.split(",") if s.strip()))
                else:
                    q = q.eq("status", status)
            if prioridade:
                q = q.eq("prioridade", prioridade)
            if obra_id:
                q = q.eq("obra_id", obra_id)
            if equipe_id:
                q = q.eq("equipe_id", equipe_id)
            if busca_expr:
                q = q.or_(busca_expr)
            return q

        # Total de registros (cabeçalho X-Total-Count para a paginação do Kanban).
        # count="exact" pede o total REAL ao PostgREST (header Prefer), que
        # continua correto acima do teto de linhas por requisição (~1000);
        # sem ele, contar por len(ids) truncaria na ~1000ª O.S.
        q_total = _aplicar_filtros(db.table("ordens_servico").select("id", count="exact"))
        if q_total is None:
            return []
        resp_total = q_total.limit(1).execute()
        total = int(resp_total.count) if resp_total.count not in (None, 0) else len(resp_total.data or [])
        if response is not None:
            response.headers["X-Total-Count"] = str(total)

        query = _aplicar_filtros(
            db.table("ordens_servico").select(
                "*, obras(id, nome, cliente_id, cliente_celesc, clientes(nome)), equipes(id, nome)"
            )
        )
        # Listagem de encerradas (multi-status): ordena pela data de encerramento
        # (mais recente primeiro, sem data_fim por último). Demais casos seguem
        # a ordem de criação usada no Kanban.
        if status and "," in status:
            dados = (
                query.order("data_fim", desc=True, nullsfirst=False)
                .order("id", desc=True)
                .range(offset, offset + limit - 1)
                .execute()
                .data
            )
        else:
            dados = (
                query.order("created_at", desc=True).order("id", desc=True).range(offset, offset + limit - 1).execute().data
            )

        # Contadores "Materiais aplicados" por O.S em UMA viagem só (evita
        # N+1 no frontend): soma da quantidade aplicada em USC (já convertida).
        if dados:
            os_ids = [d["id"] for d in dados]
            aplicacoes = (
                db.table("os_materiais")
                .select("os_id, quantidade_usada")
                .in_("os_id", os_ids)
                .execute()
                .data
            )
            fotos = db.table("os_fotos").select("os_id").in_("os_id", os_ids).execute().data
            fotos_count = {}
            for f in fotos or []:
                fotos_count[f["os_id"]] = fotos_count.get(f["os_id"], 0) + 1
            total_aplicado = {}
            for m in aplicacoes or []:
                total_aplicado[m["os_id"]] = total_aplicado.get(m["os_id"], 0.0) + float(m["quantidade_usada"])

            for d in dados:
                d["total_materiais_aplicado"] = round(total_aplicado.get(d["id"], 0.0), 3)
                d["fotos_count"] = fotos_count.get(d["id"], 0)

        return dados
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao listar O.S")
        raise HTTPException(status_code=500, detail="Erro ao listar Ordens de Serviço.") from None


def _eh_violacao_unique(exc: Exception) -> bool:
    """True quando o PostgREST/Postgres reporta violação de unicidade (23505).

    A corrida de código `OS-ANO-NNNN` entre criações simultâneas cai aqui: o
    backend re-tenta a geração em vez de devolver 500 (TOCTOU do código).
    """
    texto = str(getattr(exc, "message", "") or exc).lower()
    return any(marca in texto for marca in ("23505", "duplicate key", "já existe", "already exists"))


_CHUNK_LEITURA_UPLOAD = 1024 * 1024  # 1 MB


async def _ler_upload_limitado(
    arquivo: UploadFile,
    limite: int,
    *,
    mensagem_vazio: str = "Arquivo vazio.",
    mensagem_limite: str = "Arquivo excede o limite de 15 MB.",
) -> bytes:
    """Lê o arquivo em chunks de 1 MB e recusa SEM ler tudo quando estoura o
    limite (uploads grandes não podem ser carregados inteiros em memória)."""
    partes = []
    total = 0
    while True:
        bloco = await arquivo.read(_CHUNK_LEITURA_UPLOAD)
        if not bloco:
            break
        total += len(bloco)
        if total > limite:
            raise HTTPException(status_code=400, detail=mensagem_limite)
        partes.append(bloco)
    if total == 0:
        raise HTTPException(status_code=400, detail=mensagem_vazio)
    return b"".join(partes)


def _apagar_recursos_os(db, os_id: int) -> None:
    """Rollback de criação parcial: remove os registros auxiliares e a O.S.

    Criar_os não roda em transação (PostgREST); se o snapshot do checklist ou
    o histórico falhar depois do insert, removemos o que já foi gravado para
    não deixar O.S órfã/parcial (Lote 3).
    """
    for tabela, coluna in (
        ("os_checklist_itens", "os_id"),
        ("os_historico", "os_id"),
        ("ordens_servico", "id"),
    ):
        try:
            db.table(tabela).delete().eq(coluna, os_id).execute()
        except Exception:
            logger.exception("Falha no rollback da O.S %s (%s)", os_id, tabela)


def _criar_os_com_registro(db, dados: dict, tentativas: int = 5) -> dict:
    """Insere a O.S com código único, re-tentando em corrida de código.

    O insert pode colidir com outra criação simultânea no intervalo entre a
    geração (`_gerar_codigo_os`) e a gravação; aí o código é regenerado.
    """
    for tentativa in range(tentativas):
        codigo = _gerar_codigo_os(db)
        try:
            resp = db.table("ordens_servico").insert({**dados, "codigo": codigo}).execute()
        except Exception as exc:
            if _eh_violacao_unique(exc):
                logger.warning("Código %s colidiu no insert; tentando novamente (%d/%d).", codigo, tentativa + 1, tentativas)
                continue
            raise
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao criar O.S.")
        return resp.data[0]
    raise HTTPException(status_code=500, detail="Falha ao gerar um código único para a O.S. Tente novamente.")


@router.post("/", status_code=201)
def criar_os(payload: OSCreate, usuario: UsuarioAutenticado = Depends(get_current_user), db=Depends(get_supabase)):
    """Cria uma nova O.S (status inicial 'rascunho')."""
    try:
        _exigir_gestor(usuario)
        if payload.prioridade not in PRIORIDADES:
            raise HTTPException(status_code=400, detail=f"Prioridade inválida. Use: {', '.join(sorted(PRIORIDADES))}.")
        if payload.tipo not in TIPOS_OS:
            raise HTTPException(status_code=400, detail=f"Tipo inválido. Use: {', '.join(sorted(TIPOS_OS))}.")
        if not db.table("obras").select("id").eq("id", payload.obra_id).execute().data:
            raise HTTPException(status_code=404, detail="Obra não encontrada.")
        if payload.equipe_id and not db.table("equipes").select("id").eq("id", payload.equipe_id).execute().data:
            raise HTTPException(status_code=404, detail="Equipe não encontrada.")

        dados = {
            "obra_id": payload.obra_id,
            "equipe_id": payload.equipe_id,
            "status": "rascunho",
            "prioridade": payload.prioridade,
            "prazo_entrega": payload.prazo_entrega,
            "descricao_escopo": payload.descricao_escopo,
            "custo_mo_orcado": payload.custo_mo_orcado,
            "tipo": payload.tipo,
            "agencia": payload.agencia,
            "municipio": payload.municipio,
            "local_servico": payload.local_servico,
            "bt_energizado": payload.bt_energizado,
            "at_energizado_bloqueio": payload.at_energizado_bloqueio,
            "bloqueio": payload.bloqueio,
            "hora_desligar": payload.hora_desligar,
            "hora_religar": payload.hora_religar,
            "alimentador": payload.alimentador,
            "chave": payload.chave,
            "obs": payload.obs,
            "criado_por": usuario.email,
        }
        nova = _criar_os_com_registro(db, dados)

        # Estágios de apoio (snapshot do checklist + histórico). Sem transação
        # no PostgREST: se qualquer um falhar, removemos o que já foi gravado
        # (rollback) em vez de devolver uma O.S órfã ou parcial.
        try:
            snapshot_checklist(db, nova["id"])
            _gravar_historico(db, nova["id"], None, "rascunho", None, usuario.email, None)
        except HTTPException:
            _apagar_recursos_os(db, nova["id"])
            raise
        except Exception:
            logger.exception("Falha nos estágios de apoio da O.S %s", nova["id"])
            _apagar_recursos_os(db, nova["id"])
            raise
        return nova
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao criar O.S")
        raise HTTPException(status_code=500, detail="Erro ao criar Ordem de Serviço.") from None


def _erro_conexao(exc: Exception) -> bool:
    """Falhas transitórias de rede/HTTP (ex.: httpcore 'Server disconnected')
    entre o backend e o Supabase — vale a pena tentar a requisição de novo."""
    texto = str(exc).lower()
    return any(
        marca in texto
        for marca in ("disconnected", "connection", "timeout", "timed out", "remote protocol", "network")
    )


@router.get("/{os_id}", summary="Detalhes completos da O.S")
def detalhar_os(os_id: int, usuario: UsuarioAutenticado = Depends(get_current_user), db=Depends(get_supabase)):
    try:
        return _obter_detalhe_os(db, usuario, os_id)
    except HTTPException:
        raise
    except Exception as exc:
        # Queda de conexão com o Supabase é transitória: tenta uma segunda vez
        # antes de reportar o erro (comum ao recarregar o painel após o checklist).
        if _erro_conexao(exc):
            logger.warning("Falha de conexão ao detalhar O.S %s; tentando novamente.", os_id)
            try:
                return _obter_detalhe_os(db, usuario, os_id)
            except HTTPException:
                raise
            except Exception:
                logger.exception("Erro ao detalhar O.S %s (após retry)", os_id)
                raise HTTPException(status_code=500, detail="Erro ao obter detalhes da O.S.") from None
        logger.exception("Erro ao detalhar O.S %s", os_id)
        raise HTTPException(status_code=500, detail="Erro ao obter detalhes da O.S.") from None


def _obter_detalhe_os(db, usuario: UsuarioAutenticado, os_id: int) -> dict:
    """Monta o detalhe completo da O.S (chamado pelo endpoint, com retry de conexão)."""
    # Com as relações de obra/cliente/equipe (exibidas no painel e no modo campo).
    resp = (
        db.table("ordens_servico")
        .select("*, obras(id, nome, cliente_id, cliente_celesc, clientes(nome)), equipes(id, nome, numero)")
        .eq("id", os_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Ordem de Serviço não encontrada.")
    os_data = resp.data[0]
    _garantir_acesso_os(db, usuario, os_data)

    materiais = _resumo_materiais(db, os_id)
    mao_de_obra = _resumo_mao_de_obra(db, os_id, os_data.get("custo_mo_orcado"))
    historico = (
        db.table("os_historico").select("*").eq("os_id", os_id).order("criado_em", desc=False).execute().data
    )
    fotos = (
        db.table("os_fotos").select("id, nome_original, mime_type, created_at").eq("os_id", os_id).execute().data
    )
    apontamento_aberto = (
        db.table("os_apontamentos").select("id, inicio").eq("os_id", os_id).is_("fim", "null").execute().data
    )
    ultimos_lancamentos = (
        db.table("os_materiais")
        .select(
            "id, produto_id, quantidade_usada, quantidade_pecas, fator_usc, tipo_usc, codigo_servico, "
            "data_lancamento, produtos(nome, unidade)"
        )
        .eq("os_id", os_id)
        .order("data_lancamento", desc=True)
        .limit(10)
        .execute()
        .data
    )

    return {
        **os_data,
        "materiais": materiais,
        "mao_de_obra": mao_de_obra,
        "historico": historico,
        "fotos": fotos,
        "ultimos_lancamentos": ultimos_lancamentos,
        "cronometro_aberto": apontamento_aberto[0] if apontamento_aberto else None,
        "checklist": resumo_checklist(db, os_id),
    }


@router.put("/{os_id}", summary="Edita dados da O.S")
def editar_os(
    os_id: int, payload: OSUpdate, usuario: UsuarioAutenticado = Depends(get_current_user), db=Depends(get_supabase)
):
    """Permite editar escopo/prazo/equipe enquanto a O.S não está encerrada."""
    try:
        _exigir_gestor(usuario)
        os_data = _os_ou_404(db, os_id)
        _garantir_acesso_os(db, usuario, os_data)
        if os_data["status"] in ("concluida", "cancelada"):
            raise HTTPException(status_code=400, detail="Não é possível editar uma O.S encerrada.")
        if payload.prioridade not in PRIORIDADES:
            raise HTTPException(status_code=400, detail=f"Prioridade inválida. Use: {', '.join(sorted(PRIORIDADES))}.")
        if payload.tipo not in TIPOS_OS:
            raise HTTPException(status_code=400, detail=f"Tipo inválido. Use: {', '.join(sorted(TIPOS_OS))}.")
        if payload.equipe_id and not db.table("equipes").select("id").eq("id", payload.equipe_id).execute().data:
            raise HTTPException(status_code=404, detail="Equipe não encontrada.")

        # exclude_unset: PUT parcial não zera campos omissos (payloads que
        # não trazem o campo deixam o valor atual intacto, ex.: só escopo).
        atualizacoes = payload.model_dump(exclude_unset=True)
        resp = (
            db.table("ordens_servico")
            .update(atualizacoes)
            .eq("id", os_id)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar O.S.")

        return resp.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao editar O.S %s", os_id)
        raise HTTPException(status_code=500, detail="Erro ao atualizar O.S.") from None


@router.put("/{os_id}/status", summary="Transição de status (com máquina de estados)")
def alterar_status(
    os_id: int, payload: StatusUpdate, usuario: UsuarioAutenticado = Depends(get_current_user), db=Depends(get_supabase)
):
    try:
        os_data = _os_ou_404(db, os_id)
        _garantir_acesso_os(db, usuario, os_data)

        novo = payload.novo_status
        if novo not in STATUS_VALIDOS:
            raise HTTPException(status_code=400, detail=f"Status inválido: '{novo}'.")
        atual = os_data["status"]
        if novo == atual:
            raise HTTPException(status_code=400, detail=f"A O.S já está em '{atual}'.")

        # Regra 1: somente transições previstas na máquina de estados.
        if novo not in TRANSICOES_STATUS[atual]:
            destinos = sorted(TRANSICOES_STATUS[atual]) or ["nenhum"]
            raise HTTPException(
                status_code=422,
                detail=f"Transição inválida: '{atual}' -> '{novo}'. Destinos permitidos: {', '.join(destinos)}.",
            )

        # Cancelamento é decisão de gestão: restrito a quem tem a permissão 'os'.
        if novo == "cancelada":
            _exigir_gestor(usuario)

        # Reabertura (concluida/cancelada -> aberta) é decisão de gestão com
        # justificativa registrada no histórico (auditoria) — decisão nº 2.
        reabertura = novo == "aberta" and atual in ("concluida", "cancelada")
        if reabertura:
            _exigir_gestor(usuario)
            texto_reabertura = (payload.justificativa or "").strip()
            if len(texto_reabertura) < MIN_REABERTURA_CARACTERES:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "Para reabrir uma O.S encerrada é obrigatória uma justificativa "
                        f"descritiva com no mínimo {MIN_REABERTURA_CARACTERES} caracteres."
                    ),
                )

        # Regra 2 (crítica): 'Impedida' exige justificativa >= 20 caracteres + fotos.
        justificativa = None
        if novo == "impedida":
            justificativa = _validar_transicao_impedida(db, os_data, payload)

        # Regra 3: checklist de execução — liberação matinal e conclusão.
        if atual == "aberta" and novo == "em_andamento":
            resumo = resumo_checklist(db, os_id)
            if not resumo["inicio_liberado"]:
                grupo = next(g for g in resumo["grupos"] if g["grupo"] == GRUPO_LIBERACAO_INICIO)
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "O checklist de início precisa estar completo para liberar a execução. "
                        f"Grupo 1 - {grupo['nome']}: {grupo['respondidos']}/{grupo['total']} respondidos."
                    ),
                )
        if novo == "concluida":
            resumo = resumo_checklist(db, os_id)
            if not resumo["completo"]:
                pendentes = pendentes_para_conclusao(db, os_id)
                detalhe = f"Checklist da O.S incompleto ({resumo['respondidos']}/{resumo['total']})."
                if pendentes:
                    detalhe += " Pendentes: " + "; ".join(pendentes[:6])
                    if len(pendentes) > 6:
                        detalhe += f" e mais {len(pendentes) - 6}."
                raise HTTPException(status_code=422, detail=detalhe)

            # Evidência fotográfica obrigatória (exige_foto): a conclusão
            # também exige que cada item respondido 'sim'/'nao' tenha foto.
            sem_evidencia = _itens_exige_foto_sem_evidencia(db, os_id)
            if sem_evidencia:
                detalhe = "Há itens com resposta 'sim'/'não' sem a foto de evidência obrigatória: "
                detalhe += "; ".join(f"{i['classificacao']} {i['pergunta']}" for i in sem_evidencia[:6])
                if len(sem_evidencia) > 6:
                    detalhe += f" e mais {len(sem_evidencia) - 6}."
                raise HTTPException(status_code=422, detail=detalhe)

        updates = {"status": novo}
        if novo in ("concluida", "cancelada"):
            updates["data_fim"] = _agora().isoformat()
        if reabertura:
            # Volta ao funil: sem data de encerramento (limpa a do ciclo antigo).
            updates["data_fim"] = None

        # Update atômico: a condição de estado impede que duas solicitações
        # (dois dispositivos) validem o mesmo status atual e o último vença.
        resp = (
            db.table("ordens_servico")
            .update(updates)
            .eq("id", os_id)
            .eq("status", atual)
            .execute()
        )
        if not resp.data:
            raise HTTPException(
                status_code=409,
                detail=(
                    "A O.S foi alterada por outra pessoa enquanto você a operava. "
                    "Recarregue o quadro para ver o estado atual."
                ),
            )

        # Encerra cronômetros esquecidos ao encerrar a O.S.
        if novo in ("concluida", "cancelada"):
            _encerrar_apontamentos_abertos(db, os_id)

        _gravar_historico(
            db,
            os_id,
            atual,
            novo,
            justificativa or payload.justificativa,
            usuario.email,
            payload.geolocalizacao,
        )
        _notificar_criador(db, os_data, novo, usuario.email)
        return resp.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao alterar status da O.S %s", os_id)
        raise HTTPException(status_code=500, detail="Erro ao alterar status da O.S.") from None


# ---------------------------------------------------------------------------
# Checklist de execução da O.S
# ---------------------------------------------------------------------------


class ChecklistRespostaIn(BaseModel):
    resposta: str = Field(..., description="'sim', 'nao' ou 'na'")
    justificativa: str | None = Field(None, max_length=500, description="Opcional (legado: respostas antigas 'não' podem ter justificativa)")
    geolocalizacao: str | None = Field(None, max_length=100, description="'lat,lng' do dispositivo")


def _item_checklist_ou_404(db, os_id: int, item_id: int) -> dict:
    item = db.table("os_checklist_itens").select("*").eq("id", item_id).eq("os_id", os_id).execute().data
    if not item:
        raise HTTPException(status_code=404, detail="Item do checklist não encontrado nesta O.S.")
    return item[0]


def _itens_exige_foto_sem_evidencia(db, os_id: int) -> list[dict]:
    """Itens respondidos 'sim'/'nao' cujo modelo exige foto e não têm nenhuma.

    Respostas 'na' (não se aplica) não exigem evidência. Usado no gate de
    resposta e no gate de conclusão da O.S.
    """
    faltantes = []
    for item in itens_com_respostas(db, os_id):
        if not item.get("exige_foto"):
            continue
        resposta = (item.get("resposta") or {}).get("resposta", "")
        if resposta not in ("sim", "nao"):
            continue
        if not item.get("fotos"):
            faltantes.append(item)
    return faltantes


@router.get("/{os_id}/checklist", summary="Itens e respostas do checklist")
def obter_checklist(os_id: int, usuario: UsuarioAutenticado = Depends(get_current_user), db=Depends(get_supabase)):
    """Retorna os itens do checklist com a resposta e as fotos (com URL temporária)."""
    try:
        os_data = _os_ou_404(db, os_id)
        _garantir_acesso_os(db, usuario, os_data)

        itens = itens_com_respostas(db, os_id)
        # Adiciona presigned URL para as fotos de cada item.
        s3 = get_s3_client()
        for item in itens:
            for foto in item.get("fotos", []):
                try:
                    foto["url_temporaria"] = s3.generate_presigned_url(
                        "get_object",
                        Params={"Bucket": bucket(), "Key": foto["bucket_key"]},
                        ExpiresIn=VALIDADE_PRESIGNED_SEGUNDOS,
                    )
                except Exception:
                    foto["url_temporaria"] = None
        return {"itens": itens, "resumo": resumo_checklist(db, os_id)}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao obter checklist da O.S %s", os_id)
        raise HTTPException(status_code=500, detail="Erro ao obter o checklist da O.S.") from None


@router.put("/{os_id}/checklist/{item_id}", summary="Registra a resposta de um item")
def responder_checklist(
    os_id: int,
    item_id: int,
    payload: ChecklistRespostaIn,
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    """Responde um item do checklist (sim/nao/na). A justificativa é opcional."""
    try:
        os_data = _os_ou_404(db, os_id)
        _garantir_acesso_os(db, usuario, os_data)
        if os_data["status"] in ("concluida", "cancelada"):
            raise HTTPException(status_code=400, detail="O checklist de uma O.S encerrada não pode ser alterado.")

        item = _item_checklist_ou_404(db, os_id, item_id)
        resposta = payload.resposta.strip().lower()
        if resposta not in RESPOSTAS_VALIDAS:
            raise HTTPException(status_code=400, detail="Resposta inválida. Use 'sim', 'nao' ou 'na'.")
        justificativa = (payload.justificativa or "").strip() or None

        # Evidência fotográfica obrigatória: itens com `exige_foto` respondidos
        # 'sim'/'nao' precisam de pelo menos uma foto anexada ao item.
        if resposta in ("sim", "nao") and item.get("exige_foto"):
            tem_foto = (
                db.table("os_fotos")
                .select("id")
                .eq("checklist_item_id", item["id"])
                .limit(1)
                .execute()
                .data
            )
            if not tem_foto:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "Este item exige uma foto de evidência. Anexe a foto ao item "
                        "antes de registrar a resposta."
                    ),
                )

        db.table("os_checklist_respostas").upsert(
            {
                "item_id": item["id"],
                "resposta": resposta,
                "justificativa": justificativa,
                "respondido_por": usuario.email,
                "geolocalizacao": payload.geolocalizacao,
            },
            on_conflict="item_id",
        ).execute()
        return {"success": True, "resumo": resumo_checklist(db, os_id)}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao responder checklist da O.S %s", os_id)
        raise HTTPException(status_code=500, detail="Erro ao salvar resposta do checklist.") from None


@router.post("/{os_id}/checklist/{item_id}/foto", status_code=201, summary="Anexa foto a um item do checklist")
async def enviar_foto_checklist(
    os_id: int,
    item_id: int,
    arquivo: UploadFile = File(...),
    geolocalizacao: str | None = Query(None, max_length=100),
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    """Faz upload da evidência fotográfica de um item (mesmo fluxo das fotos da O.S)."""
    try:
        os_data = _os_ou_404(db, os_id)
        _garantir_acesso_os(db, usuario, os_data)
        item = _item_checklist_ou_404(db, os_id, item_id)

        mime = (arquivo.content_type or "").lower()
        extensao = MIMES_FOTO_PERMITIDOS.get(mime)
        if extensao is None:
            raise HTTPException(status_code=400, detail="Tipo de arquivo não permitido. Envie JPG, PNG ou WEBP.")
        conteudo = await _ler_upload_limitado(arquivo, TAMANHO_MAXIMO_FOTO_BYTES)

        s3 = get_s3_client()
        bucket_key = f"os_fotos/{os_id}/checklist_{item_id}_{uuid.uuid4().hex}{extensao}"
        s3.put_object(
            Bucket=bucket(),
            Key=bucket_key,
            Body=conteudo,
            ContentType=mime,
        )

        nome_original = os.path.basename((arquivo.filename or "").replace("\\", "/")).strip() or f"item_{item_id}.jpg"
        # "Trocar foto" substitui: cada item do checklist admite uma única foto
        # de evidência. Fotos anteriores do item (envios web ou sincronização
        # offline) são removidas — linhas antigas e objetos no bucket.
        antigas = (
            db.table("os_fotos")
            .select("id, bucket_key")
            .eq("os_id", os_id)
            .eq("checklist_item_id", item_id)
            .execute()
            .data
        )
        resp = (
            db.table("os_fotos")
            .insert(
                {
                    "os_id": os_id,
                    "checklist_item_id": item["id"],
                    "nome_original": nome_original[:500],
                    "tamanho_bytes": len(conteudo),
                    "mime_type": mime,
                    "bucket_key": bucket_key,
                    "enviado_por": usuario.email,
                }
            )
            .execute()
        )
        if not resp.data:
            _remover_objeto(s3, bucket_key)
            raise HTTPException(status_code=500, detail="Falha ao salvar a foto.")
        for antiga in antigas or []:
            try:
                s3.delete_object(Bucket=bucket(), Key=antiga["bucket_key"])
            except Exception:
                logger.exception("Erro ao remover objeto %s do B2", antiga["bucket_key"])
            db.table("os_fotos").delete().eq("id", antiga["id"]).execute()
        return resp.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao enviar foto do checklist da O.S %s", os_id)
        raise HTTPException(status_code=500, detail="Erro ao enviar foto do checklist.") from None


def _emb(valor):
    """Normaliza um embedded resource do PostgREST: retorna dict mesmo quando
    o servidor devolve lista (relações to-one às vezes vêm como array de 1)."""
    if isinstance(valor, list):
        return valor[0] if valor else {}
    return valor or {}


@router.get("/{os_id}/checklist/report", summary="Relatório em PDF do checklist de execução")
def relatorio_checklist(os_id: int, usuario: UsuarioAutenticado = Depends(get_current_user), db=Depends(get_supabase)):
    """Gera o PDF do checklist (capa + tabela + fotos + assinaturas) para impressão."""
    try:
        os_data = _os_ou_404(db, os_id)
        _garantir_acesso_os(db, usuario, os_data)

        resp = (
            db.table("ordens_servico")
            .select("*, obras(id, nome, cliente_id, cliente_celesc, clientes(nome)), equipes(id, nome, numero)")
            .eq("id", os_id)
            .execute()
        )
        obra = _emb((resp.data[0] or {}).get("obras"))
        equipe = _emb((resp.data[0] or {}).get("equipes"))
        obra["clientes"] = _emb(obra.get("clientes"))

        # Encarregado e membros (com cargo) da equipe vinculada.
        encarregado = ""
        membros = []
        equipe_id = os_data.get("equipe_id")
        if equipe_id:
            rel = (
                db.table("equipe_membros")
                # 'cargos' tem DOIS relacionamentos com funcionarios (cargo_id e
                # cargo_id_2): o PostgREST precisa do FK explícito para embutir.
                .select("funcionario_id, lider, funcionarios(id, nome, cargo_id, cargos!funcionarios_cargo_id_fkey(nome))")
                .eq("equipe_id", equipe_id)
                .execute()
                .data
            )
            for m in rel or []:
                func = _emb(m.get("funcionarios"))
                cargos = _emb(func.get("cargos"))
                nome = func.get("nome") or "-"
                cargo = cargos.get("nome") if isinstance(cargos, dict) else ""
                membros.append({"nome": nome, "cargo": cargo or "-"})
                if m.get("lider"):
                    encarregado = nome

        itens = itens_com_respostas(db, os_id)
        s3 = get_s3_client()

        def _baixar_foto(chave):
            try:
                return s3.get_object(Bucket=bucket(), Key=chave)["Body"].read()
            except Exception:
                logger.exception("Erro ao baixar foto %s para o relatório", chave)
                return None

        from utils.pdf_os_checklist import gerar_pdf_checklist

        caminho = gerar_pdf_checklist(
            os_data=os_data,
            obra=obra,
            itens=itens,
            equipe_nome=equipe.get("nome") or "",
            equipe_numero=equipe.get("numero") or "",
            encarregado=encarregado,
            membros=membros,
            baixar_foto=_baixar_foto,
        )
        return FileResponse(
            caminho,
            media_type="application/pdf",
            filename=f"{os_data['codigo']}_checklist.pdf",
            background=BackgroundTask(_remover_arquivo, caminho),
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao gerar relatório do checklist da O.S %s", os_id)
        raise HTTPException(status_code=500, detail="Erro ao gerar o relatório do checklist.") from None


# ---------------------------------------------------------------------------
# Sincronização offline (Modo Campo)
# ---------------------------------------------------------------------------


def _parse_criado_em(valor: str | None):
    """Timestamp do dispositivo para comparação de ordem (assume UTC)."""
    if not valor:
        return None
    try:
        dt = datetime.fromisoformat(str(valor).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt
    except ValueError:
        return None


@router.post("/sincronizar", summary="Sincroniza as operações feitas offline no campo")
def sincronizar(
    payload: SincronizarIn,
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    """Aplica o lote de operações gravadas no tablet sem internet.

    As operações são aplicadas EM ORDEM CRONOLÓGICA (por O.S) reutilizando as
    mesmas validações dos endpoints normais: máquina de estados, gates do
    checklist, travas de impedimento, permissão por equipe. Uma operação que
    falha NÃO aborta o restante do lote — cada resultado é reportado com o
    id_local para o dispositivo marcar como pendente/revisão.

    IDEMPOTÊNCIA: cada operação é registrada em `sync_ops` com a chave
    (dispositivo, id_local). Se a resposta do lote se perder e o tablet
    reenviar as mesmas operações, o backend devolve a resposta já gravada
    (resultado com `duplicada: true`) em vez de aplicar de novo — evita
    duplicar lançamentos de material e blocos de H.H.

    Tipos aceitos:
      - checklist_resposta : {item_id, resposta, justificativa?, geolocalizacao?}
      - status             : {novo_status, justificativa?, fotos_ids?, geolocalizacao?}
      - apontamento_play   : {geolocalizacao?, inicio?} — inicio: hora REAL do play
      - apontamento_pause  : {geolocalizacao?, fim?} — fim: hora REAL do pause
      - material           : {produto_id, quantidade_usada, tipo_usc?}
    """
    resultados = []
    if not payload.operacoes:
        return {"resultados": resultados}

    dispositivo = (payload.dispositivo or "").strip()

    # Ordenação estável: por O.S e pela hora registrada no dispositivo;
    # operações sem timestamp mantêm a ordem de chegada.
    operacoes = sorted(
        payload.operacoes,
        key=lambda op: (op.os_id, _parse_criado_em(op.criado_em) or datetime.min.replace(tzinfo=UTC)),
    )

    for op in operacoes:
        if op.tipo not in TIPOS_SYNC_VALIDOS:
            resultados.append(
                {"id_local": op.id_local, "ok": False, "status": 400, "erro": f"Tipo de operação inválido: '{op.tipo}'."}
            )
            continue

        # Reenvio de um lote cuja resposta se perdeu na rede: devolve a
        # resposta gravada sem reaplicar a operação.
        registrado = _consulta_sync_op(db, dispositivo, op.id_local)
        if registrado and registrado.get("status") == "ok":
            resultados.append(
                {"id_local": op.id_local, "ok": True, "duplicada": True, "dados": registrado.get("resposta")}
            )
            continue

        if registrado is None:
            # Garante o registro de entrega antes de aplicar (linha 'pendente').
            _gravar_sync_op(db, dispositivo, op.id_local, status="pendente", op=op)

        try:
            if op.tipo == "checklist_resposta":
                item_id = op.payload.get("item_id")
                if item_id is None:
                    raise HTTPException(status_code=400, detail="Operação 'checklist_resposta' sem 'item_id'.")
                dados = responder_checklist(
                    op.os_id,
                    int(item_id),
                    ChecklistRespostaIn(
                        resposta=op.payload.get("resposta", ""),
                        justificativa=op.payload.get("justificativa"),
                        geolocalizacao=op.payload.get("geolocalizacao"),
                    ),
                    usuario,
                    db,
                )
            elif op.tipo == "status":
                fotos_ids = op.payload.get("fotos_ids") or []

                def _resolve_foto_id(foto):
                    """Aceita id do servidor (int/dígitos) ou id_local do tablet
                    (uuid) já mapeado pelas fotos enviadas antes do lote."""
                    if isinstance(foto, int) or (isinstance(foto, str) and foto.strip().isdigit()):
                        return int(foto)
                    chave = str(foto)
                    if chave in payload.mapa_fotos:
                        return payload.mapa_fotos[chave]
                    raise HTTPException(
                        status_code=400,
                        detail=f"Evidência '{chave}' ainda não foi sincronizada (envie as fotos antes do lote).",
                    )

                try:
                    fotos_ids = [_resolve_foto_id(f) for f in fotos_ids]
                except HTTPException:
                    raise
                except (TypeError, ValueError):
                    raise HTTPException(status_code=400, detail="'fotos_ids' deve ser uma lista de números.") from None
                try:
                    dados = alterar_status(
                        op.os_id,
                        StatusUpdate(
                            novo_status=op.payload.get("novo_status", ""),
                            justificativa=op.payload.get("justificativa"),
                            fotos_ids=fotos_ids,
                            geolocalizacao=op.payload.get("geolocalizacao"),
                        ),
                        usuario,
                        db,
                    )
                except HTTPException as exc:
                    if exc.status_code == 400 and str(exc.detail).startswith("A O.S já está em"):
                        # Conflito benigno: o estado atual já é o desejado
                        # (ex.: transição aplicada por lote anterior cuja
                        # resposta se perdeu). Conta como sucesso.
                        dados = {"id": op.os_id, "status": op.payload.get("novo_status", "")}
                    else:
                        raise
            elif op.tipo == "material":
                dados = lancar_material(
                    op.os_id,
                    MaterialLancamento(
                        produto_id=op.payload.get("produto_id"),
                        quantidade_usada=op.payload.get("quantidade_usada"),
                        tipo_usc=op.payload.get("tipo_usc", "normal"),
                    ),
                    usuario,
                    db,
                )
            else:
                dados = _apontar_hora(
                    op.os_id,
                    ApontamentoAcao(acao="play" if op.tipo == "apontamento_play" else "pause"),
                    geolocalizacao=op.payload.get("geolocalizacao"),
                    # O horário REAL da ação (registrado no dispositivo offline)
                    # é carregado para o H.H. não zerar na sincronização.
                    inicio=op.payload.get("inicio") or op.criado_em,
                    fim=op.payload.get("fim") or op.criado_em,
                    usuario=usuario,
                    db=db,
                )

            resultado = {"id_local": op.id_local, "ok": True, "dados": dados}
        except HTTPException as exc:
            resultado = {"id_local": op.id_local, "ok": False, "status": exc.status_code, "erro": exc.detail}
        except ValidationError as exc:
            resultado = {"id_local": op.id_local, "ok": False, "status": 422, "erro": f"Dados inválidos: {exc}"}
        except Exception:
            logger.exception("Erro ao aplicar operação %s do sync", op.id_local)
            resultado = {
                "id_local": op.id_local,
                "ok": False,
                "status": 500,
                "erro": "Erro interno ao aplicar a operação.",
            }

        # Entrega confirmada (ok) ou conflito definitivo (4xx): grava o
        # estado. Falhas internas (5xx) ficam 'pendente' para o reenvio tentar
        # de novo (sem gravar a mensagem de erro como definitiva).
        if resultado["ok"] or resultado["status"] < 500:
            _gravar_sync_op(
                db,
                dispositivo,
                op.id_local,
                status="ok" if resultado["ok"] else "erro",
                resposta=resultado.get("dados"),
                erro=resultado.get("erro"),
            )
        resultados.append(resultado)

    return {"resultados": resultados}


def _consulta_sync_op(db, dispositivo: str, id_local: str) -> dict | None:
    """Registro de entrega já gravado da operação (ou None)."""
    try:
        resp = (
            db.table("sync_ops")
            .select("*")
            .eq("dispositivo", dispositivo)
            .eq("id_local", id_local)
            .execute()
        )
    except Exception:
        logger.exception("Falha ao consultar sync_ops de %s", id_local)
        return None
    return resp.data[0] if resp.data else None


def _gravar_sync_op(db, dispositivo: str, id_local: str, *, status: str, resposta=None, erro=None, op=None) -> None:
    """Grava/atualiza o registro de entrega da operação em `sync_ops`.

    A tabela tem UNIQUE(dispositivo, id_local): a primeira gravação cria a
    linha e as seguintes apenas atualizam o estado dela. Falha de banco aqui
    NÃO aborta a operação — sem o registro o sync volta ao comportamento
    legado (sem deduplicação) no próximo reenvio.
    """
    try:
        linha = {"dispositivo": dispositivo, "id_local": id_local, "status": status}
        if resposta is not None:
            linha["resposta"] = resposta
        if erro is not None:
            linha["erro"] = erro
        if op is not None:
            linha["os_id"] = op.os_id
            linha["tipo"] = op.tipo
            linha["criado_em"] = op.criado_em
            linha["payload"] = op.payload
        db.table("sync_ops").upsert(linha, on_conflict="dispositivo,id_local").execute()
    except Exception:
        logger.exception("Falha ao registrar sync_ops de %s", id_local)


# ---------------------------------------------------------------------------
# Impressão da O.S no modelo oficial (capa de campo)
# ---------------------------------------------------------------------------


@router.get("/{os_id}/imprimir", summary="Gera o PDF da O.S no modelo oficial")
def imprimir_os(os_id: int, usuario: UsuarioAutenticado = Depends(get_current_user), db=Depends(get_supabase)):
    """Preenche o modelo da O.S (CONSTRUÇÃO ou LINHA VIVA) e retorna o PDF.

    Campos derivados automaticamente quando não preenchidos: município e
    local vêm da obra; encarregado e membros vêm da equipe vinculada.
    """
    try:
        os_data = _os_ou_404(db, os_id)
        _garantir_acesso_os(db, usuario, os_data)

        obra = db.table("obras").select("*").eq("id", os_data["obra_id"]).execute().data
        obra = obra[0] if obra else {}

        equipe_nome = None
        equipe_numero = None
        encarregado = None
        membros: list[dict] = []
        if os_data.get("equipe_id"):
            equipe_resp = db.table("equipes").select("nome, numero").eq("id", os_data["equipe_id"]).execute().data
            if equipe_resp:
                equipe_nome = equipe_resp[0].get("nome")
                equipe_numero = equipe_resp[0].get("numero")

            vinculos = (
                db.table("equipe_membros")
                .select("funcionario_id, lider")
                .eq("equipe_id", os_data["equipe_id"])
                .execute()
                .data
            )
            func_ids = sorted({v["funcionario_id"] for v in vinculos})
            funcs = {}
            if func_ids:
                resp = db.table("funcionarios").select("id, nome, cargo_id").in_("id", func_ids).execute().data
                funcs = {f["id"]: f for f in resp}
            cargos = {}
            cargo_ids = sorted({f.get("cargo_id") for f in funcs.values() if f.get("cargo_id")})
            if cargo_ids:
                resp_c = db.table("cargos").select("id, nome").in_("id", cargo_ids).execute().data
                cargos = {c["id"]: c.get("nome") for c in resp_c}

            for v in vinculos:
                func = funcs.get(v["funcionario_id"]) or {}
                nome = func.get("nome")
                if not nome:
                    continue
                membros.append({"nome": nome, "cargo": cargos.get(func.get("cargo_id")) or ""})
                if v.get("lider") and not encarregado:
                    encarregado = nome

        from utils.modelo_os import gerar_modelo_os

        caminho = gerar_modelo_os(
            os_data=os_data,
            obra=obra,
            equipe_nome=equipe_nome,
            equipe_numero=equipe_numero,
            encarregado=encarregado,
            membros=membros,
            tipo=os_data.get("tipo") or "construcao",
        )
        return FileResponse(
            caminho,
            media_type="application/pdf",
            filename=f"{os_data['codigo']}_modelo.pdf",
            background=BackgroundTask(_remover_arquivo, caminho),
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao imprimir O.S %s", os_id)
        raise HTTPException(status_code=500, detail="Erro ao gerar o modelo da O.S.") from None


# ---------------------------------------------------------------------------
# Endpoints - Lançamento de materiais/insumos
# ---------------------------------------------------------------------------


@router.post("/{os_id}/materiais", status_code=201, summary="Lança material aplicado")
def lancar_material(
    os_id: int,
    payload: MaterialLancamento,
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    try:
        os_data = _os_ou_404(db, os_id)
        _garantir_acesso_os(db, usuario, os_data)
        # O campo lança em O.S em execução ou impedida (materiais já aplicados
        # antes do impedimento); o gestor também em O.S encerrada (ajustes
        # pós-conclusão). Rascunho permanece bloqueado para todos.
        if os_data["status"] == "rascunho":
            raise HTTPException(
                status_code=400,
                detail="Materiais não podem ser lançados em uma O.S em rascunho.",
            )
        if not _e_gestor_os(usuario) and os_data["status"] not in ("aberta", "em_andamento", "impedida"):
            raise HTTPException(
                status_code=400,
                detail="Materiais só podem ser lançados em O.S abertas, em andamento ou impedidas.",
            )
        produto = _validar_servico_do_contrato(db, payload.produto_id, os_data["tipo"])

        # Conversão para USC: peças x fator do cadastro. USC 'especial' exige
        # valor cadastrado; 'normal' com USC zerada (produto legado) mantém a
        # quantidade bruta digitada (comportamento original).
        tipo_usc = (payload.tipo_usc or "normal").strip().lower()
        if tipo_usc not in ("normal", "especial"):
            raise HTTPException(status_code=400, detail="Tipo de USC inválido. Use 'normal' ou 'especial'.")
        fator_usc = 0.0
        if tipo_usc == "especial":
            fator_usc = float(produto.get("qtd_usc_especial") or 0)
            if fator_usc <= 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"O serviço '{produto['nome']}' não possui Qtd USC especial cadastrada.",
                )
        else:
            fator_usc = float(produto.get("preco_unitario") or 0)
        if fator_usc > 0:
            quantidade = round(payload.quantidade_usada * fator_usc, 3)
        else:
            quantidade = payload.quantidade_usada

        # Snapshot do código do serviço aplicado: o mesmo serviço tem códigos
        # distintos conforme o tipo escolhido (normal -> codigo, especial ->
        # codigo_especial). Se o tipo escolhido não tem código próprio, usa o
        # outro como fallback. Gravado no lançamento para relatórios/
        # conferência; mudanças futuras no cadastro não alteram o já lançado.
        if tipo_usc == "especial":
            codigo_servico = produto.get("codigo_especial") or produto.get("codigo")
        else:
            codigo_servico = produto.get("codigo") or produto.get("codigo_especial")
        codigo_servico = (codigo_servico or "").strip() or None

        resp = (
            db.table("os_materiais")
            .insert(
                {
                    "os_id": os_id,
                    "produto_id": payload.produto_id,
                    "quantidade_usada": quantidade,
                    "quantidade_pecas": payload.quantidade_usada,
                    "fator_usc": round(fator_usc, 3),
                    "tipo_usc": tipo_usc,
                    "codigo_servico": codigo_servico,
                    "usuario_email": usuario.email,
                    "observacao": payload.observacao,
                }
            )
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao lançar serviço.")
        return {**resp.data[0], "produto_nome": produto["nome"]}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao lançar serviço na O.S %s", os_id)
        raise HTTPException(status_code=500, detail="Erro ao lançar serviço.") from None


@router.delete("/{os_id}/materiais/{lancamento_id}", summary="Estorna um lançamento de material")
def estornar_material(
    os_id: int, lancamento_id: int, usuario: UsuarioAutenticado = Depends(get_current_user), db=Depends(get_supabase)
):
    try:
        _exigir_gestor(usuario)
        os_data = _os_ou_404(db, os_id)
        _garantir_acesso_os(db, usuario, os_data)
        registro = db.table("os_materiais").select("id").eq("id", lancamento_id).eq("os_id", os_id).execute()
        if not registro.data:
            raise HTTPException(status_code=404, detail="Lançamento não encontrado nesta O.S.")
        db.table("os_materiais").delete().eq("id", lancamento_id).execute()
        return {"success": True, "message": "Lançamento estornado."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao estornar lançamento %s da O.S %s", lancamento_id, os_id)
        raise HTTPException(status_code=500, detail="Erro ao estornar lançamento.") from None


@router.get("/{os_id}/resumo", summary="Materiais aplicados + custo de M.O")
def resumo_os(os_id: int, usuario: UsuarioAutenticado = Depends(get_current_user), db=Depends(get_supabase)):
    try:
        os_data = _os_ou_404(db, os_id)
        _garantir_acesso_os(db, usuario, os_data)
        return {
            "materiais": _resumo_materiais(db, os_id),
            "mao_de_obra": _resumo_mao_de_obra(db, os_id, os_data.get("custo_mo_orcado")),
        }
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro no resumo da O.S %s", os_id)
        raise HTTPException(status_code=500, detail="Erro ao gerar resumo da O.S.") from None


# ---------------------------------------------------------------------------
# Endpoints - Apontamento de Horas (H.H.) - Play/Pause
# ---------------------------------------------------------------------------


@router.post("/{os_id}/apontamentos", summary="Play/Pause do cronômetro H.H.")
def apontar_hora(
    os_id: int,
    payload: ApontamentoAcao,
    geolocalizacao: str | None = Query(None, max_length=100),
    inicio: str | None = Query(None, description="ISO timestamp real do play (apenas sync offline)"),
    fim: str | None = Query(None, description="ISO timestamp real do pause (apenas sync offline)"),
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    """Play/Pause do cronômetro H.H. pela interface web.

    Os parâmetros `inicio`/`fim` existem apenas para o sync offline carregar
    o horário REAL da ação no dispositivo; na web o horário é sempre o do
    servidor, então informá-los aqui é recusado.
    """
    if inicio or fim:
        raise HTTPException(
            status_code=400,
            detail="Os parâmetros 'inicio'/'fim' só podem ser informados pela sincronização offline.",
        )
    return _apontar_hora(
        os_id,
        payload,
        geolocalizacao=geolocalizacao,
        inicio=inicio,
        fim=fim,
        usuario=usuario,
        db=db,
    )


def _validar_timestamp_nao_futuro(dt: datetime, detalhe: str) -> None:
    """Recusa horários muito à frente do servidor (relógio do tablet errado)."""
    if dt > _agora() + timedelta(seconds=TOLERANCIA_RELOGIO_SEGUNDOS):
        raise HTTPException(status_code=400, detail=detalhe)


def _apontar_hora(
    os_id: int,
    payload: ApontamentoAcao,
    *,
    geolocalizacao: str | None,
    inicio: str | None,
    fim: str | None,
    usuario: UsuarioAutenticado,
    db,
):
    """Registra blocos de trabalho do membro da equipe.

    - 'play': abre um bloco. Se a O.S estiver 'aberta', promove automaticamente
      para 'em_andamento' (início de serviço pelo campo), registrando histórico.
    - 'pause': fecha o bloco aberto calculando os minutos trabalhados.

    Os parâmetros `inicio`/`fim` permitem carregar o horário REAL registrado
    no dispositivo offline (a sincronização acontece horas depois; sem isso
    o bloco seria gravado com a hora do envio e as horas H.H. se perderiam).
    Na origem web esses parâmetros nunca vêm preenchidos (a rota os recusa).
    """
    acao = payload.acao.strip().lower()
    if acao not in ("play", "pause"):
        raise HTTPException(status_code=400, detail="Ação inválida. Use 'play' ou 'pause'.")

    def _timestamp_ou_agora(valor):
        if not valor:
            return _agora()
        try:
            dt = datetime.fromisoformat(str(valor).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
            return dt
        except ValueError:
            raise HTTPException(status_code=400, detail="Timestamp inválido. Use o formato ISO 8601.") from None

    try:
        os_data = _os_ou_404(db, os_id)
        _garantir_acesso_os(db, usuario, os_data)

        func = _funcionario_do_usuario(db, usuario)
        if not func:
            raise HTTPException(
                status_code=403,
                detail="Seu usuário não está vinculado a um funcionário. Peça ao administrador para vincular em "
                "Configurações → Usuários.",
            )

        if os_data["status"] in ("rascunho", "concluida", "cancelada", "impedida"):
            raise HTTPException(
                status_code=400,
                detail=f"Não é possível apontar horas em uma O.S {os_data['status']}.",
            )

        abertos = (
            db.table("os_apontamentos")
            .select("*")
            .eq("os_id", os_id)
            .eq("funcionario_id", func["id"])
            .is_("fim", "null")
            .execute()
        )

        if acao == "play":
            if abertos.data:
                raise HTTPException(status_code=409, detail="Já existe um cronômetro em andamento para você nesta O.S.")
            inicio_real = _timestamp_ou_agora(inicio)
            _validar_timestamp_nao_futuro(
                inicio_real,
                "O horário de início do apontamento está no futuro. Verifique o relógio do dispositivo.",
            )
            resp = (
                db.table("os_apontamentos")
                .insert(
                    {
                        "os_id": os_id,
                        "funcionario_id": func["id"],
                        "inicio": inicio_real.isoformat(),
                    }
                )
                .execute()
            )
            if not resp.data:
                raise HTTPException(status_code=500, detail="Falha ao iniciar cronômetro.")

            # Início automático de serviço: 'aberta' -> 'em_andamento'.
            if os_data["status"] == "aberta":
                resumo = resumo_checklist(db, os_id)
                if not resumo["inicio_liberado"]:
                    db.table("os_apontamentos").delete().eq("id", resp.data[0]["id"]).execute()
                    grupo = next(g for g in resumo["grupos"] if g["grupo"] == GRUPO_LIBERACAO_INICIO)
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            "O checklist de início precisa estar completo para liberar a execução. "
                            f"Grupo 1 - {grupo['nome']}: {grupo['respondidos']}/{grupo['total']} respondidos."
                        ),
                    )
                db.table("ordens_servico").update({"status": "em_andamento"}).eq("id", os_id).execute()
                _gravar_historico(
                    db,
                    os_id,
                    "aberta",
                    "em_andamento",
                    "Início automático via apontamento de horas.",
                    usuario.email,
                    geolocalizacao,
                )
            return {"acao": "play", "apontamento": resp.data[0]}

        # acao == pause
        if not abertos.data:
            raise HTTPException(status_code=409, detail="Nenhum cronômetro em andamento para você nesta O.S.")
        bloco = abertos.data[0]
        inicio_real = datetime.fromisoformat(bloco["inicio"])
        fim_real = _timestamp_ou_agora(fim)
        _validar_timestamp_nao_futuro(
            fim_real,
            "O horário de fim do apontamento está no futuro. Verifique o relógio do dispositivo.",
        )
        if fim_real <= inicio_real:
            raise HTTPException(status_code=400, detail="O fim do apontamento deve ser depois do início.")
        if fim_real - inicio_real > MAX_DURACAO_BLOCO_HH:
            raise HTTPException(status_code=400, detail="A duração do apontamento excede o teto de 24 horas.")
        minutos = int(((fim_real - inicio_real).total_seconds()) // 60)
        resp = (
            db.table("os_apontamentos")
            .update(
                {
                    "fim": fim_real.isoformat(),
                    "minutos_trabalhados": minutos,
                }
            )
            .eq("id", bloco["id"])
            .is_("fim", "null")
            .execute()
        )
        if not resp.data:
            raise HTTPException(
                status_code=409,
                detail="O cronômetro já foi encerrado por outra solicitação. Recarregue para ver o estado atual.",
            )
        return {"acao": "pause", "minutos_trabalhados": minutos}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro no apontamento de horas da O.S %s", os_id)
        raise HTTPException(status_code=500, detail="Erro no apontamento de horas.") from None


# ---------------------------------------------------------------------------
# Endpoints - Evidências fotográficas
# ---------------------------------------------------------------------------


@router.post("/{os_id}/fotos", status_code=201, summary="Upload de foto (câmera/galeria)")
async def enviar_foto(
    os_id: int,
    arquivo: UploadFile = File(...),
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    try:
        os_data = _os_ou_404(db, os_id)
        _garantir_acesso_os(db, usuario, os_data)

        mime = (arquivo.content_type or "").lower()
        extensao = MIMES_FOTO_PERMITIDOS.get(mime)
        if extensao is None:
            raise HTTPException(status_code=400, detail="Envie a foto em JPG, PNG ou WEBP.")
        conteudo = await _ler_upload_limitado(
            arquivo,
            TAMANHO_MAXIMO_FOTO_BYTES,
            mensagem_limite="Foto excede o limite de 15 MB.",
        )

        s3 = get_s3_client()
        bucket_key = f"os_fotos/{os_id}/{uuid.uuid4().hex}{extensao}"
        s3.put_object(Bucket=bucket(), Key=bucket_key, Body=conteudo, ContentType=mime)

        # Basename + truncatura: o nome do cliente não pode virar caminho.
        nome_original = os.path.basename((arquivo.filename or "").replace("\\", "/")).strip() or "foto"
        resp = (
            db.table("os_fotos")
            .insert(
                {
                    "os_id": os_id,
                    "nome_original": nome_original[:500],
                    "tamanho_bytes": len(conteudo),
                    "mime_type": mime,
                    "bucket_key": bucket_key,
                    "enviado_por": usuario.email,
                }
            )
            .execute()
        )
        if not resp.data:
            s3.delete_object(Bucket=bucket(), Key=bucket_key)
            raise HTTPException(status_code=500, detail="Falha ao registrar a foto.")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao enviar foto da O.S %s", os_id)
        raise HTTPException(status_code=500, detail="Erro ao enviar foto.") from None


@router.get("/{os_id}/fotos", summary="Lista fotos com URLs temporárias")
def listar_fotos(os_id: int, usuario: UsuarioAutenticado = Depends(get_current_user), db=Depends(get_supabase)):
    try:
        os_data = _os_ou_404(db, os_id)
        _garantir_acesso_os(db, usuario, os_data)
        fotos = db.table("os_fotos").select("*").eq("os_id", os_id).order("created_at").execute().data
        s3 = get_s3_client()
        resultado = []
        for meta in fotos or []:
            url = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket(), "Key": meta["bucket_key"]},
                ExpiresIn=VALIDADE_PRESIGNED_SEGUNDOS,
            )
            resultado.append({**meta, "url_temporaria": url})
        return resultado
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao listar fotos da O.S %s", os_id)
        raise HTTPException(status_code=500, detail="Erro ao listar fotos.") from None


@router.delete("/{os_id}/fotos/{foto_id}", summary="Exclui uma evidência fotográfica")
def excluir_foto(
    os_id: int, foto_id: int, usuario: UsuarioAutenticado = Depends(get_current_user), db=Depends(get_supabase)
):
    try:
        _exigir_gestor(usuario)
        os_data = _os_ou_404(db, os_id)
        _garantir_acesso_os(db, usuario, os_data)
        meta = db.table("os_fotos").select("*").eq("id", foto_id).eq("os_id", os_id).execute()
        if not meta.data:
            raise HTTPException(status_code=404, detail="Foto não encontrada nesta O.S.")
        s3 = get_s3_client()
        try:
            s3.delete_object(Bucket=bucket(), Key=meta.data[0]["bucket_key"])
        except Exception:
            logger.exception("Erro ao remover objeto %s do B2", meta.data[0]["bucket_key"])
        db.table("os_fotos").delete().eq("id", foto_id).execute()
        return {"success": True, "message": "Foto excluída."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao excluir foto %s da O.S %s", foto_id, os_id)
        raise HTTPException(status_code=500, detail="Erro ao excluir foto.") from None


@router.delete("/{os_id}", summary="Exclui uma O.S (rascunho ou encerrada)")
def excluir_os(os_id: int, usuario: UsuarioAutenticado = Depends(get_current_user), db=Depends(get_supabase)):
    """Exclui permanentemente uma O.S de teste/descartada.

    Permitido apenas para o gestor e somente nos status sem execução de campo:
    'rascunho' (criada por engano), 'concluida' ou 'cancelada'. A exclusão é
    em cascata (apontamentos, materiais, fotos, checklist e histórico); os
    objetos das fotos são removidos do bucket antes da exclusão.
    """
    try:
        _exigir_gestor(usuario)
        os_data = _os_ou_404(db, os_id)
        _garantir_acesso_os(db, usuario, os_data)
        if os_data["status"] not in ("rascunho", "concluida", "cancelada"):
            raise HTTPException(
                status_code=400,
                detail="Apenas O.S em rascunho ou encerradas (concluída/cancelada) podem ser excluídas.",
            )

        # Remove antes os objetos do bucket (as linhas caem em cascata).
        fotos = db.table("os_fotos").select("bucket_key").eq("os_id", os_id).execute().data or []
        s3 = get_s3_client()
        for foto in fotos:
            try:
                s3.delete_object(Bucket=bucket(), Key=foto["bucket_key"])
            except Exception:
                logger.exception("Erro ao remover objeto %s do B2", foto["bucket_key"])

        db.table("ordens_servico").delete().eq("id", os_id).execute()
        return {"success": True, "message": f"O.S {os_data['codigo']} excluída."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao excluir a O.S %s", os_id)
        raise HTTPException(status_code=500, detail="Erro ao excluir a O.S.") from None


# ---------------------------------------------------------------------------
# Relatório PDF
# ---------------------------------------------------------------------------


@router.get("/{os_id}/pdf", summary="Relatório de execução da O.S em PDF")
def relatorio_pdf(os_id: int, usuario: UsuarioAutenticado = Depends(get_current_user), db=Depends(get_supabase)):
    try:
        os_data = _os_ou_404(db, os_id)
        _garantir_acesso_os(db, usuario, os_data)

        obra = db.table("obras").select("nome, cliente_celesc, clientes(nome)").eq("id", os_data["obra_id"]).execute().data
        equipe = (
            db.table("equipes").select("nome").eq("id", os_data.get("equipe_id")).execute().data
            if os_data.get("equipe_id")
            else []
        )
        historico = db.table("os_historico").select("*").eq("os_id", os_id).order("criado_em").execute().data
        materiais = _resumo_materiais(db, os_id)
        mao_de_obra = _resumo_mao_de_obra(db, os_id, os_data.get("custo_mo_orcado"))
        qtd_fotos = db.table("os_fotos").select("id").eq("os_id", os_id).execute()

        # utils/pdf_os.py monta o documento (mantém pdf_generator.py intacto).
        from utils.pdf_os import gerar_pdf_os

        caminho = gerar_pdf_os(
            os_data=os_data,
            obra=(obra[0] if obra else {}),
            equipe=(equipe[0].get("nome") if equipe else None),
            historico=historico,
            materiais=materiais,
            mao_de_obra=mao_de_obra,
            quantidade_fotos=len(qtd_fotos.data or []),
        )
        return FileResponse(
            caminho,
            media_type="application/pdf",
            filename=f"{os_data['codigo']}_relatorio.pdf",
            background=BackgroundTask(_remover_arquivo, caminho),
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao gerar PDF da O.S %s", os_id)
        raise HTTPException(status_code=500, detail="Erro ao gerar relatório PDF.") from None
