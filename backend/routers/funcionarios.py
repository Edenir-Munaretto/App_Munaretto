import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from auth import UsuarioAutenticado, require_qualquer_permisao
from routers.usuarios import (
    desativar_usuarios_vinculados,
    usuarios_vinculados_para_desligamento,
)
from supabase_client import get_supabase

# O router é acessível por quem tem o módulo "funcionarios" (novo), além de
# "clientes"/"ferias" (compatibilidade), "sst" (o módulo de Segurança do
# Trabalho usa a lista de funcionários para treinamentos, ASO e EPIs) e
# "configuracoes" (o cadastro de Usuários vincula o funcionário ao login).
router = APIRouter(
    dependencies=[Depends(require_qualquer_permisao(["funcionarios", "clientes", "ferias", "sst", "configuracoes"]))]
)

logger = logging.getLogger(__name__)

# Desligamento e exclusão de cadastro são ações de gestão de pessoal: não
# ficam disponíveis para módulos que apenas consomem a lista (SST, férias etc.).
GERIR_FUNCIONARIOS = [Depends(require_qualquer_permisao(["funcionarios", "configuracoes"]))]

MOTIVOS_DESLIGAMENTO = (
    "Pedido de demissão",
    "Dispensa sem justa causa",
    "Dispensa por justa causa",
    "Fim de contrato",
    "Aposentadoria",
    "Abandono de emprego",
    "Falecimento",
    "Outro",
)


class FuncionarioCreate(BaseModel):
    nome: str = Field(..., min_length=2, description="Nome do funcionário")
    cpf: str = Field(..., min_length=11, description="CPF do funcionário")
    cargo_id: int | None = Field(None, description="ID do cargo/função (módulo SST)")
    cargo_id_2: int | None = Field(None, description="ID da 2ª função (módulo SST)")


class FuncionarioResponse(FuncionarioCreate):
    id: int
    ativo: bool
    desligado: bool = False
    data_desligamento: str | None = None
    motivo_desligamento: str | None = None
    observacao_desligamento: str | None = None
    desligado_por: str | None = None
    created_at: str | None = None
    cargo_id: int | None = None
    cargo_id_2: int | None = None


class FuncionarioStats(BaseModel):
    total: int
    ativos: int
    inativos: int
    desligados: int = 0


class FuncionarioDesligamento(BaseModel):
    data_desligamento: date = Field(..., description="Data do desligamento (YYYY-MM-DD)")
    motivo_desligamento: str = Field(..., min_length=3, max_length=100)
    observacao_desligamento: str | None = Field(None, max_length=2000)

    @field_validator("data_desligamento")
    @classmethod
    def _validar_data(cls, valor: date) -> date:
        if valor > date.today():
            raise ValueError("A data do desligamento não pode estar no futuro.")
        return valor

    @field_validator("motivo_desligamento")
    @classmethod
    def _validar_motivo(cls, valor: str) -> str:
        valor = valor.strip()
        if valor not in MOTIVOS_DESLIGAMENTO:
            raise ValueError("Motivo de desligamento inválido.")
        return valor

    @field_validator("observacao_desligamento")
    @classmethod
    def _normalizar_observacao(cls, valor: str | None) -> str | None:
        if isinstance(valor, str):
            valor = valor.strip()
            return valor or None
        return valor


class UsuarioVinculado(BaseModel):
    id: int
    nome: str
    email: str


class EquipeVinculada(BaseModel):
    id: int
    nome: str
    lider: bool = False


class DesligamentoChecklist(BaseModel):
    usuarios_vinculados: list[UsuarioVinculado] = Field(default_factory=list)
    equipes: list[EquipeVinculada] = Field(default_factory=list)
    apontamentos_abertos: int = 0
    epis_em_uso: int = 0
    aso_demissional_registrado: bool = False
    bloqueios: list[str] = Field(default_factory=list)


class DesligamentoResponse(BaseModel):
    funcionario: FuncionarioResponse
    usuarios_desativados: int = 0
    equipes_removidas: list[str] = Field(default_factory=list)
    avisos: list[str] = Field(default_factory=list)


def _eh_violacao_unique(exc: Exception) -> bool:
    """True quando o PostgREST/Postgres reporta violação de unicidade (23505)."""
    texto = str(exc).lower()
    return any(marca in texto for marca in ("23505", "duplicate key", "já existe", "already exists"))


def _funcionario_ou_404(db, funcionario_id: int) -> dict:
    response = (
        db.table("funcionarios")
        .select("*")
        .eq("id", funcionario_id)
        .eq("excluido", False)
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="Funcionário não encontrado")
    return response.data[0]


def _apontamentos_abertos(db, funcionario_id: int) -> list[dict]:
    response = (
        db.table("os_apontamentos")
        .select("id, os_id")
        .eq("funcionario_id", funcionario_id)
        .is_("fim", "null")
        .execute()
    )
    return response.data or []


def _equipes_do_funcionario(db, funcionario_id: int) -> list[dict]:
    vinculos = (
        db.table("equipe_membros")
        .select("equipe_id, lider")
        .eq("funcionario_id", funcionario_id)
        .execute()
        .data
        or []
    )
    if not vinculos:
        return []

    equipe_ids = sorted({v["equipe_id"] for v in vinculos})
    equipes = (
        db.table("equipes")
        .select("id, nome")
        .in_("id", equipe_ids)
        .execute()
        .data
        or []
    )
    nomes = {e["id"]: e.get("nome") or f"Equipe {e['id']}" for e in equipes}
    return [
        {
            "id": v["equipe_id"],
            "nome": nomes.get(v["equipe_id"], f"Equipe {v['equipe_id']}"),
            "lider": bool(v.get("lider")),
        }
        for v in vinculos
    ]


def _epis_em_uso(db, funcionario_id: int) -> int:
    response = (
        db.table("funcionario_epis")
        .select("id")
        .eq("funcionario_id", funcionario_id)
        .is_("data_devolucao", "null")
        .execute()
    )
    return len(response.data or [])


def _tem_aso_demissional(db, funcionario_id: int) -> bool:
    response = (
        db.table("aso")
        .select("id")
        .eq("funcionario_id", funcionario_id)
        .eq("tipo_exame", "demissional")
        .limit(1)
        .execute()
    )
    return bool(response.data)


def _invalidar_caches_operacionais() -> None:
    """Atualiza os resumos que dependem da lista de funcionários ativos."""
    try:
        from routers.dashboard import limpar_cache_dashboard
        from routers.sst import limpar_cache_alertas_sst

        limpar_cache_dashboard()
        limpar_cache_alertas_sst()
    except Exception:
        logger.exception("Erro ao invalidar caches após alteração de funcionário")


@router.get("/stats", response_model=FuncionarioStats)
def estatisticas_funcionarios(db=Depends(get_supabase)):
    """Retorna a quantidade total de funcionários cadastrados (ativos + inativos), sem contar os excluídos."""
    try:
        response = (
            db.table("funcionarios")
            .select("ativo", "desligado", "excluido")
            .eq("excluido", False)
            .execute()
        )
        dados = response.data
        total = len(dados)
        ativos = sum(1 for r in dados if r.get("ativo", True))
        desligados = sum(1 for r in dados if not r.get("ativo", True) and r.get("desligado"))
        inativos = total - ativos - desligados
        return FuncionarioStats(total=total, ativos=ativos, inativos=inativos, desligados=desligados)
    except Exception:
        logger.exception("Erro ao buscar estatísticas de funcionários")
        raise HTTPException(status_code=500, detail="Erro ao buscar estatísticas de funcionários") from None


@router.get("/", response_model=list[FuncionarioResponse])
def listar_funcionarios(
    busca: str | None = Query(None, description="Termo de busca (nome ou CPF)"),
    status: str | None = Query(
        "ativos",
        description="Filtro de status: ativos, inativos, desligados ou todos",
    ),
    limit: int | None = Query(None, ge=1, le=10000, description="Máximo de registros a retornar (paginação)"),
    offset: int | None = Query(0, ge=0, description="Registros a pular (paginação)"),
    db=Depends(get_supabase),
):
    """Lista funcionários filtrados por status (exclui os excluídos). Filtra por nome ou CPF se informado."""

    def base():
        query = db.table("funcionarios").select("*").eq("excluido", False)
        if status == "inativos":
            query = query.eq("ativo", False).eq("desligado", False)
        elif status == "desligados":
            query = query.eq("ativo", False).eq("desligado", True)
        elif status != "todos":
            query = query.eq("ativo", True)
        return query

    try:
        if busca:
            # Busca segura por coluna (parametrizada); sem interpolação no filtro do PostgREST
            consolidado = {}
            for coluna in ("nome", "cpf"):
                resposta = base().ilike(coluna, f"%{busca}%").execute()
                for linha in resposta.data:
                    consolidado[linha["id"]] = linha
            dados = list(consolidado.values())
        else:
            query = base().order("nome")
            if limit is not None:
                query = query.range(offset, offset + limit - 1)
            dados = query.execute().data

        dados.sort(key=lambda x: str(x.get("nome", "")).lower())
        # Quando há busca, aplica paginação em memória (busca já consolidou tudo)
        if busca and limit is not None:
            dados = dados[offset : offset + limit]
        return dados
    except Exception:
        logger.exception("Erro ao buscar funcionários")
        raise HTTPException(status_code=500, detail="Erro ao buscar funcionários") from None


@router.get("/{funcionario_id}", response_model=FuncionarioResponse)
def buscar_funcionario(funcionario_id: int, db=Depends(get_supabase)):
    """Busca os detalhes de um funcionário pelo ID."""
    try:
        return _funcionario_ou_404(db, funcionario_id)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao buscar funcionário")
        raise HTTPException(status_code=500, detail="Erro ao buscar funcionário") from None


@router.post("/", response_model=FuncionarioResponse, status_code=201)
def cadastrar_funcionario(funcionario: FuncionarioCreate, db=Depends(get_supabase)):
    """Cadastra um novo funcionário. Retorna erro se o CPF já existir."""
    try:
        dup_check = (
            db.table("funcionarios")
            .select("id, ativo, desligado")
            .eq("cpf", funcionario.cpf)
            .eq("excluido", False)
            .execute()
        )
        if dup_check.data:
            existente = dup_check.data[0]
            if existente.get("ativo", True):
                detalhe = "Este CPF já está cadastrado para um funcionário ativo."
            elif existente.get("desligado"):
                detalhe = (
                    "Já existe um cadastro com este CPF para um funcionário desligado. "
                    "Reative o cadastro existente em Funcionários."
                )
            else:
                detalhe = (
                    "Já existe um cadastro com este CPF para um funcionário inativo. "
                    "Reative o cadastro existente em Funcionários."
                )
            raise HTTPException(status_code=400, detail=detalhe)

        response = db.table("funcionarios").insert(funcionario.model_dump()).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao cadastrar funcionário.")

        return response.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        if _eh_violacao_unique(exc):
            excluido = (
                db.table("funcionarios")
                .select("id")
                .eq("cpf", funcionario.cpf)
                .eq("excluido", True)
                .execute()
            )
            detalhe = (
                "Já existe um cadastro excluído com este CPF. Regularize o cadastro antes de criar outro."
                if excluido.data
                else "Já existe um cadastro com este CPF. Reative o cadastro existente em Funcionários."
            )
            raise HTTPException(status_code=400, detail=detalhe) from None
        logger.exception("Erro ao cadastrar funcionário")
        raise HTTPException(status_code=500, detail="Erro ao cadastrar funcionário") from None


@router.put("/{funcionario_id}", response_model=FuncionarioResponse)
def atualizar_funcionario(funcionario_id: int, funcionario: FuncionarioCreate, db=Depends(get_supabase)):
    """Atualiza os dados de um funcionário existente."""
    try:
        _funcionario_ou_404(db, funcionario_id)

        dup_check = (
            db.table("funcionarios")
            .select("id")
            .eq("cpf", funcionario.cpf)
            .neq("id", funcionario_id)
            .eq("excluido", False)
            .execute()
        )
        if dup_check.data:
            raise HTTPException(status_code=400, detail="Este CPF já está cadastrado para outro funcionário.")

        response = db.table("funcionarios").update(funcionario.model_dump()).eq("id", funcionario_id).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar funcionário.")

        return response.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        if _eh_violacao_unique(exc):
            raise HTTPException(
                status_code=400,
                detail="Este CPF já está cadastrado para outro funcionário.",
            ) from None
        logger.exception("Erro ao atualizar funcionário")
        raise HTTPException(status_code=500, detail="Erro ao atualizar funcionário") from None


class FuncionarioStatusUpdate(BaseModel):
    ativo: bool


@router.patch("/{funcionario_id}/status", response_model=FuncionarioResponse)
def alterar_status_funcionario(funcionario_id: int, payload: FuncionarioStatusUpdate, db=Depends(get_supabase)):
    """Ativa ou inativa um funcionário existente.

    Reativar zera `desligado` (o registro do último desligamento é mantido como
    histórico). Inativar sem desligar representa um afastamento temporário.
    """
    try:
        atual = _funcionario_ou_404(db, funcionario_id)

        if not payload.ativo and atual.get("desligado"):
            raise HTTPException(
                status_code=400,
                detail="Este funcionário está desligado. Use a reativação para um novo vínculo.",
            )

        dados = {"ativo": payload.ativo}
        if payload.ativo:
            dados["desligado"] = False

        response = db.table("funcionarios").update(dados).eq("id", funcionario_id).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao alterar status do funcionário.")

        _invalidar_caches_operacionais()
        return response.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao alterar status do funcionário")
        raise HTTPException(status_code=500, detail="Erro ao alterar status do funcionário") from None


@router.get(
    "/{funcionario_id}/desligamento/checklist",
    response_model=DesligamentoChecklist,
    dependencies=GERIR_FUNCIONARIOS,
)
def checklist_desligamento(funcionario_id: int, db=Depends(get_supabase)):
    """Pendências e bloqueios exibidos antes de confirmar o desligamento."""
    try:
        funcionario = _funcionario_ou_404(db, funcionario_id)

        usuarios, bloqueio_admin = usuarios_vinculados_para_desligamento(db, funcionario_id)
        apontamentos = _apontamentos_abertos(db, funcionario_id)
        equipes = _equipes_do_funcionario(db, funcionario_id)

        bloqueios = []
        if not funcionario.get("desligado"):
            if apontamentos:
                bloqueios.append(
                    f"Existe(m) {len(apontamentos)} apontamento(s) de horas em aberto. "
                    "Pause o cronômetro antes de registrar o desligamento."
                )
            if bloqueio_admin:
                bloqueios.append(bloqueio_admin)

        return DesligamentoChecklist(
            usuarios_vinculados=[
                UsuarioVinculado(id=u["id"], nome=u.get("nome") or "", email=u.get("email") or "")
                for u in usuarios
            ],
            equipes=[EquipeVinculada(**e) for e in equipes],
            apontamentos_abertos=len(apontamentos),
            epis_em_uso=_epis_em_uso(db, funcionario_id),
            aso_demissional_registrado=_tem_aso_demissional(db, funcionario_id),
            bloqueios=bloqueios,
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao montar checklist de desligamento")
        raise HTTPException(status_code=500, detail="Erro ao montar checklist de desligamento") from None


@router.patch("/{funcionario_id}/desligamento", response_model=DesligamentoResponse)
def desligar_funcionario(
    funcionario_id: int,
    payload: FuncionarioDesligamento,
    usuario: UsuarioAutenticado = Depends(require_qualquer_permisao(["funcionarios", "configuracoes"])),
    db=Depends(get_supabase),
):
    """Registra o desligamento mantendo o cadastro e todo o histórico.

    Efeitos: inativa o funcionário, desativa os logins vinculados e o remove
    das equipes atuais. O nome permanece para O.S, SST, férias e relatórios.
    """
    try:
        atual = _funcionario_ou_404(db, funcionario_id)
        ja_desligado = bool(atual.get("desligado"))

        usuarios_desativados = 0
        equipes_removidas: list[str] = []
        avisos: list[str] = []

        if not ja_desligado:
            apontamentos = _apontamentos_abertos(db, funcionario_id)
            if apontamentos:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Existe(m) {len(apontamentos)} apontamento(s) de horas em aberto. "
                        "Pause o cronômetro antes de registrar o desligamento."
                    ),
                )

            equipes = _equipes_do_funcionario(db, funcionario_id)
            usuarios_desativados = len(desativar_usuarios_vinculados(db, funcionario_id))

            dados = {
                "ativo": False,
                "desligado": True,
                "data_desligamento": payload.data_desligamento.isoformat(),
                "motivo_desligamento": payload.motivo_desligamento,
                "observacao_desligamento": payload.observacao_desligamento,
                "desligado_por": usuario.email,
            }
            response = db.table("funcionarios").update(dados).eq("id", funcionario_id).execute()
            if not response.data:
                raise HTTPException(status_code=500, detail="Falha ao registrar o desligamento.")

            if equipes:
                try:
                    db.table("equipe_membros").delete().eq("funcionario_id", funcionario_id).execute()
                    equipes_removidas = [e["nome"] for e in equipes]
                    for equipe in equipes:
                        if equipe.get("lider"):
                            avisos.append(
                                f"A equipe {equipe['nome']} ficou sem líder. Atualize a composição da equipe."
                            )
                except Exception:
                    logger.exception("Erro ao remover funcionário %s das equipes", funcionario_id)
                    avisos.append(
                        "Não foi possível remover o funcionário das equipes. Ajuste manualmente em O.S → Equipes."
                    )

            try:
                epis_em_uso = _epis_em_uso(db, funcionario_id)
                if epis_em_uso:
                    avisos.append(f"Existem {epis_em_uso} EPI(s) sem devolução registrada.")
                if not _tem_aso_demissional(db, funcionario_id):
                    avisos.append("Nenhum ASO demissional registrado para este funcionário.")
            except Exception:
                logger.exception("Erro ao verificar pendências de SST do funcionário %s", funcionario_id)

            _invalidar_caches_operacionais()
        else:
            dados = {
                "ativo": False,
                "desligado": True,
                "data_desligamento": payload.data_desligamento.isoformat(),
                "motivo_desligamento": payload.motivo_desligamento,
                "observacao_desligamento": payload.observacao_desligamento,
                "desligado_por": usuario.email,
            }
            response = db.table("funcionarios").update(dados).eq("id", funcionario_id).execute()
            if not response.data:
                raise HTTPException(status_code=500, detail="Falha ao atualizar o desligamento.")
            _invalidar_caches_operacionais()

        return DesligamentoResponse(
            funcionario=response.data[0],
            usuarios_desativados=usuarios_desativados,
            equipes_removidas=equipes_removidas,
            avisos=avisos,
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao registrar desligamento")
        raise HTTPException(status_code=500, detail="Erro ao registrar desligamento") from None


@router.delete("/{funcionario_id}", dependencies=GERIR_FUNCIONARIOS)
def excluir_funcionario(funcionario_id: int, db=Depends(get_supabase)):
    """Exclui um cadastro feito por engano, somente quando não há histórico.

    Desligamento NÃO usa esta rota: o cadastro é preservado. Com qualquer
    vínculo (O.S, SST, certificado, equipe ou login), a exclusão é bloqueada.
    """
    try:
        atual = _funcionario_ou_404(db, funcionario_id)

        if atual.get("desligado") or atual.get("data_desligamento"):
            raise HTTPException(
                status_code=409,
                detail="Este funcionário possui desligamento registrado e não pode ser excluído.",
            )

        referencias = (
            ("os_apontamentos", "funcionario_id", "apontamentos de O.S"),
            ("funcionario_treinamentos", "funcionario_id", "treinamentos"),
            ("aso", "funcionario_id", "ASO"),
            ("funcionario_epis", "funcionario_id", "fichas de EPI"),
            ("certificados", "colaborador_id", "certificados"),
            ("equipe_membros", "funcionario_id", "equipes"),
            ("usuarios", "funcionario_id", "usuários vinculados"),
        )
        vinculos = []
        for tabela, coluna, rotulo in referencias:
            existe = db.table(tabela).select("id").eq(coluna, funcionario_id).limit(1).execute().data
            if existe:
                vinculos.append(rotulo)

        if vinculos:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Este funcionário possui histórico/vínculos ("
                    + ", ".join(vinculos)
                    + ") e não pode ser excluído. Registre o desligamento."
                ),
            )

        response = db.table("funcionarios").delete().eq("id", funcionario_id).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao excluir funcionário.")

        _invalidar_caches_operacionais()
        return {"success": True, "message": "Cadastro excluído com sucesso."}
    except HTTPException:
        raise
    except Exception as exc:
        if "foreign key" in str(exc).lower():
            raise HTTPException(
                status_code=409,
                detail="Este funcionário possui vínculos e não pode ser excluído. Registre o desligamento.",
            ) from None
        logger.exception("Erro ao excluir funcionário")
        raise HTTPException(status_code=500, detail="Erro ao excluir funcionário") from None
