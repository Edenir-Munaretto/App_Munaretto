"""Módulo Controle de Ordens de Serviço (O.S.) de obras.

Regras de negócio centrais:
- Máquina de estados com transições válidas (ver TRANSICOES_STATUS);
- Trava de status 'Impedida': justificativa obrigatória (>= 20 caracteres)
  e pelo menos uma foto de evidência já anexada à O.S.;
- Apontamento de horas (H.H.) com Play/Pause e cálculo do Custo Real de
  Mão de Obra (zerado até que o valor da hora seja definido por equipe);
- Comparativo Materiais Aplicados vs. Orçados;
- Permissão granular: usuários com "configuracoes"/"dashboard" são gestores
  (vêem tudo); demais usuários só acessam O.S das equipes em que atuam
  (vínculo pelo funcionário selecionado em Configurações → Usuários).
"""

import logging
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from auth import UsuarioAutenticado, get_current_user, require_qualquer_permisao
from storage import bucket, get_s3_client
from supabase_client import get_supabase

# O módulo é acessível ao gestor ("os") e ao usuário de campo ("os_campo").
# O usuário de campo enxerga apenas as O.S das equipes em que atua e executa
# tarefas (status, H.H., fotos, materiais, impressão); ações de gestão
# (criar/editar/duplicar O.S, estorno, exclusão de evidências) exigem "os".
router = APIRouter(dependencies=[Depends(require_qualquer_permisao(["os", "os_campo"]))])

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constantes de negócio
# ---------------------------------------------------------------------------

STATUS_VALIDOS = {"rascunho", "aberta", "em_andamento", "impedida", "concluida", "cancelada"}
PRIORIDADES = {"baixa", "media", "alta", "critica"}
# Tipo da O.S: define qual modelo de impressão é usado (CONSTRUÇÃO ou LINHA VIVA).
TIPOS_OS = {"construcao", "linha_viva"}

# Máquina de estados: origem -> destinos permitidos. Qualquer transição fora
# deste mapa é rejeitada com 422 (evita saltos como Rascunho -> Concluída).
TRANSICOES_STATUS = {
    "rascunho": {"aberta", "cancelada"},
    "aberta": {"em_andamento", "impedida", "cancelada"},
    "em_andamento": {"impedida", "concluida", "cancelada"},
    "impedida": {"em_andamento"},
    "concluida": set(),
    "cancelada": set(),
}

MIN_JUSTIFICATIVA_IMPEDIDA = 20
MIMES_FOTO_PERMITIDOS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
TAMANHO_MAXIMO_FOTO_BYTES = 15 * 1024 * 1024
VALIDADE_PRESIGNED_SEGUNDOS = 15 * 60

PERMISSOES_GESTOR = {"configuracoes", "dashboard"}

# ---------------------------------------------------------------------------
# Schemas Pydantic
# ---------------------------------------------------------------------------


class ItemOrcadoIn(BaseModel):
    produto_id: int
    quantidade_orcada: float = Field(..., gt=0)


class OSCreate(BaseModel):
    obra_id: int
    equipe_id: int | None = None
    prioridade: str = Field("media")
    prazo_entrega: str | None = None  # ISO date (YYYY-MM-DD)
    descricao_escopo: str | None = None
    custo_mo_orcado: float = Field(0, ge=0)
    itens_orcados: list[ItemOrcadoIn] = Field(default_factory=list)
    # Campos do modelo de impressão (capa da O.S).
    tipo: str = Field("construcao", description="'construcao' ou 'linha_viva' (define o modelo de impressão)")
    agencia: str | None = None
    municipio: str | None = None
    local_servico: str | None = None
    bt_energizado: bool = False
    at_energizado_bloqueio: bool = False
    hora_desligar: str | None = None  # "HH:MM"
    hora_religar: str | None = None
    alimentador: str | None = None
    chave: str | None = None
    obs: str | None = None


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
    hora_desligar: str | None = None
    hora_religar: str | None = None
    alimentador: str | None = None
    chave: str | None = None
    obs: str | None = None


class StatusUpdate(BaseModel):
    novo_status: str
    justificativa: str | None = None
    # IDs de fotos já enviadas à O.S usadas como evidência do impedimento.
    fotos_ids: list[int] = Field(default_factory=list)
    geolocalizacao: str | None = Field(None, max_length=100, description="'lat,lng' do dispositivo")


class MaterialLancamento(BaseModel):
    produto_id: int
    quantidade_usada: float = Field(..., gt=0)
    observacao: str | None = None


class ApontamentoAcao(BaseModel):
    acao: str = Field(..., description="'play' para iniciar ou 'pause' para encerrar o bloco")


# ---------------------------------------------------------------------------
# Helpers internos
# ---------------------------------------------------------------------------


def _agora() -> datetime:
    return datetime.now(UTC)


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
    existentes = db.table("ordens_servico").select("codigo").like("codigo", f"{prefixo}%").execute()
    maior = 0
    for linha in existentes.data or []:
        try:
            maior = max(maior, int(linha["codigo"].rsplit("-", 1)[1]))
        except (ValueError, IndexError):
            continue
    return f"{prefixo}{maior + 1:04d}"


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


def _encerrar_apontamentos_abertos(db, os_id: int) -> None:
    """Ao concluir/cancelar uma O.S, fecha qualquer cronômetro esquecido aberto."""
    abertos = db.table("os_apontamentos").select("*").eq("os_id", os_id).is_("fim", "null").execute()
    for apt in abertos.data or []:
        inicio = datetime.fromisoformat(apt["inicio"])
        minutos = max(0, int(((_agora() - inicio).total_seconds()) // 60))
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


def _precos_dos_produtos(db, produto_ids) -> dict:
    """Mapa {id: preco_unitario} em consulta única (evita N+1)."""
    ids = sorted({pid for pid in produto_ids if pid})
    if not ids:
        return {}
    resp = db.table("produtos").select("id, preco_unitario").in_("id", ids).execute()
    return {p["id"]: float(p.get("preco_unitario") or 0) for p in resp.data or []}


def _resumo_materiais(db, os_id: int) -> dict:
    """Compara orçado vs. aplicado por produto e calcula custos."""
    orcados = db.table("os_itens_orcados").select("produto_id, quantidade_orcada").eq("os_id", os_id).execute()
    aplicacoes = db.table("os_materiais").select("produto_id, quantidade_usada").eq("os_id", os_id).execute()

    # Catálogo e preços dos produtos envolvidos (consultas únicas, sem N+1
    # e sem depender de embedded resources do PostgREST).
    todos_ids = [i["produto_id"] for i in (orcados.data or [])] + [m["produto_id"] for m in (aplicacoes.data or [])]
    catalogo = {}
    ids_unicos = sorted(set(todos_ids))
    if ids_unicos:
        resp = db.table("produtos").select("id, nome, unidade").in_("id", ids_unicos).execute()
        catalogo = {p["id"]: p for p in resp.data or []}
    precos = _precos_dos_produtos(db, todos_ids)

    por_produto = {}
    for item in orcados.data or []:
        pid = item["produto_id"]
        p = por_produto.setdefault(
            pid,
            {
                "produto_id": pid,
                "nome": (catalogo.get(pid) or {}).get("nome"),
                "unidade": (catalogo.get(pid) or {}).get("unidade"),
                "preco_unitario": precos.get(pid, 0),
                "orcado": 0.0,
                "aplicado": 0.0,
            },
        )
        p["orcado"] += float(item["quantidade_orcada"])

    for lanc in aplicacoes.data or []:
        pid = lanc["produto_id"]
        p = por_produto.setdefault(
            pid,
            {
                "produto_id": pid,
                "nome": (catalogo.get(pid) or {}).get("nome") or "Produto",
                "unidade": (catalogo.get(pid) or {}).get("unidade") or "-",
                "preco_unitario": precos.get(pid, 0),
                "orcado": 0.0,
                "aplicado": 0.0,
            },
        )
        p["aplicado"] += float(lanc["quantidade_usada"])

    itens = []
    total_orcado_rs = 0.0
    total_aplicado_rs = 0.0
    for p in por_produto.values():
        custo_orcado = p["orcado"] * p["preco_unitario"]
        custo_aplicado = p["aplicado"] * p["preco_unitario"]
        total_orcado_rs += custo_orcado
        total_aplicado_rs += custo_aplicado
        itens.append(
            {
                **p,
                "custo_orcado": round(custo_orcado, 2),
                "custo_aplicado": round(custo_aplicado, 2),
                "perc_aplicado": round(p["aplicado"] / p["orcado"] * 100, 1) if p["orcado"] else None,
            }
        )

    return {
        "itens": sorted(itens, key=lambda i: i["nome"] or ""),
        "total_orcado_rs": round(total_orcado_rs, 2),
        "total_aplicado_rs": round(total_aplicado_rs, 2),
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
            inicio = datetime.fromisoformat(apt["inicio"])
            minutos = max(0, int(((agora - inicio).total_seconds()) // 60))
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


@router.get("/", summary="Lista O.S (Kanban/filtros)")
def listar_os(
    status: str | None = Query(None),
    prioridade: str | None = Query(None),
    obra_id: int | None = Query(None),
    equipe_id: int | None = Query(None),
    busca: str | None = Query(None, description="Busca por código ou escopo"),
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    try:
        query = db.table("ordens_servico").select("*, obras(id, nome, cliente_id, clientes(nome)), equipes(id, nome)")

        # Permissão granular: usuário de campo só enxerga O.S das suas equipes.
        if not _e_gestor(usuario):
            equipes_usuario = _equipes_do_usuario(db, usuario)
            if not equipes_usuario:
                return []
            query = query.in_("equipe_id", equipes_usuario)

        if status:
            query = query.eq("status", status)
        if prioridade:
            query = query.eq("prioridade", prioridade)
        if obra_id:
            query = query.eq("obra_id", obra_id)
        if equipe_id:
            query = query.eq("equipe_id", equipe_id)
        if busca:
            termo = busca.replace("%", "").replace(",", "")
            query = query.or_(f"codigo.ilike.%{termo}%,descricao_escopo.ilike.%{termo}%")

        dados = query.order("created_at", desc=True).execute().data

        # Contadores "Aplicado vs. Orçado" por O.S em UMA viagem só (evita
        # N+1 no frontend): soma o custo de cada item (qtde x preço unitário)
        # e devolve o percentual executado exibido como barra no Kanban.
        if dados:
            os_ids = [d["id"] for d in dados]
            orcados = (
                db.table("os_itens_orcados")
                .select("os_id, quantidade_orcada, produtos(preco_unitario)")
                .in_("os_id", os_ids)
                .execute()
                .data
            )
            aplicacoes = (
                db.table("os_materiais")
                .select("os_id, quantidade_usada, produtos(preco_unitario)")
                .in_("os_id", os_ids)
                .execute()
                .data
            )
            fotos = db.table("os_fotos").select("os_id").in_("os_id", os_ids).execute().data
            fotos_count = {}
            for f in fotos or []:
                fotos_count[f["os_id"]] = fotos_count.get(f["os_id"], 0) + 1
            custo_orcado = {}
            for i in orcados or []:
                preco = float((i.get("produtos") or {}).get("preco_unitario") or 0)
                custo_orcado[i["os_id"]] = custo_orcado.get(i["os_id"], 0) + float(i["quantidade_orcada"]) * preco
            custo_aplicado = {}
            for m in aplicacoes or []:
                preco = float((m.get("produtos") or {}).get("preco_unitario") or 0)
                custo_aplicado[m["os_id"]] = custo_aplicado.get(m["os_id"], 0) + float(m["quantidade_usada"]) * preco

            for d in dados:
                orc = round(custo_orcado.get(d["id"], 0.0), 2)
                apl = round(custo_aplicado.get(d["id"], 0.0), 2)
                d["custo_materiais_orcado"] = orc
                d["custo_materiais_aplicado"] = apl
                d["perc_materiais"] = round(apl / orc * 100, 1) if orc > 0 else None
                d["fotos_count"] = fotos_count.get(d["id"], 0)

        return dados
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao listar O.S")
        raise HTTPException(status_code=500, detail="Erro ao listar Ordens de Serviço.") from None


@router.post("/", status_code=201)
def criar_os(payload: OSCreate, usuario: UsuarioAutenticado = Depends(get_current_user), db=Depends(get_supabase)):
    """Cria uma nova O.S (status inicial 'rascunho') com seus itens orçados."""
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
            "codigo": _gerar_codigo_os(db),
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
            "hora_desligar": payload.hora_desligar,
            "hora_religar": payload.hora_religar,
            "alimentador": payload.alimentador,
            "chave": payload.chave,
            "obs": payload.obs,
            "criado_por": usuario.email,
        }
        resp = db.table("ordens_servico").insert(dados).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao criar O.S.")
        nova = resp.data[0]

        if payload.itens_orcados:
            linhas = [
                {"os_id": nova["id"], "produto_id": i.produto_id, "quantidade_orcada": i.quantidade_orcada}
                for i in {i.produto_id: i for i in payload.itens_orcados}.values()
            ]
            db.table("os_itens_orcados").insert(linhas).execute()

        _gravar_historico(db, nova["id"], None, "rascunho", None, usuario.email, None)
        return nova
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao criar O.S")
        raise HTTPException(status_code=500, detail="Erro ao criar Ordem de Serviço.") from None


@router.get("/{os_id}", summary="Detalhes completos da O.S")
def detalhar_os(os_id: int, usuario: UsuarioAutenticado = Depends(get_current_user), db=Depends(get_supabase)):
    try:
        os_data = _os_ou_404(db, os_id)
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

        return {
            **os_data,
            "materiais": materiais,
            "mao_de_obra": mao_de_obra,
            "historico": historico,
            "fotos": fotos,
            "cronometro_aberto": apontamento_aberto[0] if apontamento_aberto else None,
        }
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao detalhar O.S %s", os_id)
        raise HTTPException(status_code=500, detail="Erro ao obter detalhes da O.S.") from None


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

        resp = (
            db.table("ordens_servico")
            .update(
                {
                    "equipe_id": payload.equipe_id,
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
                    "hora_desligar": payload.hora_desligar,
                    "hora_religar": payload.hora_religar,
                    "alimentador": payload.alimentador,
                    "chave": payload.chave,
                    "obs": payload.obs,
                }
            )
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

        # Regra 2 (crítica): 'Impedida' exige justificativa >= 20 caracteres + fotos.
        justificativa = None
        if novo == "impedida":
            justificativa = _validar_transicao_impedida(db, os_data, payload)

        updates = {"status": novo}
        if novo in ("concluida", "cancelada"):
            updates["data_fim"] = _agora().isoformat()

        resp = db.table("ordens_servico").update(updates).eq("id", os_id).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao alterar status.")

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


@router.post("/{os_id}/duplicar", status_code=201, summary="Clona a O.S como rascunho")
def duplicar_os(os_id: int, usuario: UsuarioAutenticado = Depends(get_current_user), db=Depends(get_supabase)):
    try:
        _exigir_gestor(usuario)
        original = _os_ou_404(db, os_id)
        _garantir_acesso_os(db, usuario, original)

        nova = {
            "codigo": _gerar_codigo_os(db),
            "obra_id": original["obra_id"],
            "equipe_id": original["equipe_id"],
            "status": "rascunho",
            "prioridade": original["prioridade"],
            "prazo_entrega": None,
            "descricao_escopo": original.get("descricao_escopo"),
            "custo_mo_orcado": original.get("custo_mo_orcado", 0),
            "criado_por": usuario.email,
        }
        resp = db.table("ordens_servico").insert(nova).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao duplicar O.S.")
        copia = resp.data[0]

        itens = db.table("os_itens_orcados").select("produto_id, quantidade_orcada").eq("os_id", os_id).execute()
        if itens.data:
            db.table("os_itens_orcados").insert(
                [
                    {"os_id": copia["id"], "produto_id": i["produto_id"], "quantidade_orcada": i["quantidade_orcada"]}
                    for i in itens.data
                ]
            ).execute()

        _gravar_historico(
            db, copia["id"], None, "rascunho", f"Duplicada a partir da O.S {original['codigo']}.", usuario.email, None
        )
        return copia
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao duplicar O.S %s", os_id)
        raise HTTPException(status_code=500, detail="Erro ao duplicar O.S.") from None


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
        # Lançamentos fazem sentido apenas com serviço em execução (ou aberto).
        if os_data["status"] not in ("aberta", "em_andamento"):
            raise HTTPException(
                status_code=400,
                detail="Materiais só podem ser lançados em O.S abertas ou em andamento.",
            )
        produto = db.table("produtos").select("*").eq("id", payload.produto_id).execute()
        if not produto.data:
            raise HTTPException(status_code=404, detail="Produto não encontrado.")

        resp = (
            db.table("os_materiais")
            .insert(
                {
                    "os_id": os_id,
                    "produto_id": payload.produto_id,
                    "quantidade_usada": payload.quantidade_usada,
                    "usuario_email": usuario.email,
                    "observacao": payload.observacao,
                }
            )
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao lançar material.")
        return {**resp.data[0], "produto_nome": produto.data[0]["nome"]}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao lançar material na O.S %s", os_id)
        raise HTTPException(status_code=500, detail="Erro ao lançar material.") from None


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


@router.get("/{os_id}/resumo", summary="Aplicado vs. Orçado + custo de M.O")
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
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db=Depends(get_supabase),
):
    """Registra blocos de trabalho do membro da equipe.

    - 'play': abre um bloco. Se a O.S estiver 'aberta', promove automaticamente
      para 'em_andamento' (início de serviço pelo campo), registrando histórico.
    - 'pause': fecha o bloco aberto calculando os minutos trabalhados.
    """
    acao = payload.acao.strip().lower()
    if acao not in ("play", "pause"):
        raise HTTPException(status_code=400, detail="Ação inválida. Use 'play' ou 'pause'.")

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

        if os_data["status"] in ("concluida", "cancelada", "impedida"):
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
            resp = (
                db.table("os_apontamentos")
                .insert(
                    {
                        "os_id": os_id,
                        "funcionario_id": func["id"],
                        "inicio": _agora().isoformat(),
                    }
                )
                .execute()
            )
            if not resp.data:
                raise HTTPException(status_code=500, detail="Falha ao iniciar cronômetro.")

            # Início automático de serviço: 'aberta' -> 'em_andamento'.
            if os_data["status"] == "aberta":
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
        inicio = datetime.fromisoformat(bloco["inicio"])
        minutos = max(0, int(((_agora() - inicio).total_seconds()) // 60))
        resp = (
            db.table("os_apontamentos")
            .update(
                {
                    "fim": _agora().isoformat(),
                    "minutos_trabalhados": minutos,
                }
            )
            .eq("id", bloco["id"])
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao encerrar cronômetro.")
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
        conteudo = await arquivo.read()
        if not conteudo:
            raise HTTPException(status_code=400, detail="Arquivo vazio.")
        if len(conteudo) > TAMANHO_MAXIMO_FOTO_BYTES:
            raise HTTPException(status_code=400, detail="Foto excede o limite de 15 MB.")

        s3 = get_s3_client()
        bucket_key = f"os_fotos/{os_id}/{uuid.uuid4().hex}{extensao}"
        s3.put_object(Bucket=bucket(), Key=bucket_key, Body=conteudo, ContentType=mime)

        resp = (
            db.table("os_fotos")
            .insert(
                {
                    "os_id": os_id,
                    "nome_original": arquivo.filename or "foto",
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


# ---------------------------------------------------------------------------
# Relatório PDF
# ---------------------------------------------------------------------------


@router.get("/{os_id}/pdf", summary="Relatório de execução da O.S em PDF")
def relatorio_pdf(os_id: int, usuario: UsuarioAutenticado = Depends(get_current_user), db=Depends(get_supabase)):
    try:
        os_data = _os_ou_404(db, os_id)
        _garantir_acesso_os(db, usuario, os_data)

        obra = db.table("obras").select("nome, clientes(nome)").eq("id", os_data["obra_id"]).execute().data
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
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao gerar PDF da O.S %s", os_id)
        raise HTTPException(status_code=500, detail="Erro ao gerar relatório PDF.") from None
