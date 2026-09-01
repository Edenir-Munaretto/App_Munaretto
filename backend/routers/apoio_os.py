"""Cadastros de apoio do módulo Controle de O.S.: Obras, Equipes e Produtos.

Segue o mesmo padrão dos demais routers do projeto: Supabase via PostgREST,
validação com Pydantic e permissão de módulo ("os").
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth import require_permisao, require_qualquer_permisao
from supabase_client import get_supabase

# Catálogo de produtos é leitura necessária ao usuário de campo (lançamento de
# serviços na O.S); as demais operações de cadastro seguem restritas ao gestor.
router = APIRouter(dependencies=[Depends(require_qualquer_permisao(["os", "os_campo"]))])

GESTOR_ONLY = [Depends(require_permisao("os"))]

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Schemas Pydantic
# ---------------------------------------------------------------------------


class ObraCreate(BaseModel):
    cliente_id: int = Field(..., description="ID do cliente dono da obra")
    nome: str = Field(..., min_length=2, description="Nome/identificação da obra")
    endereco: str | None = None
    cidade: str | None = None


class ClienteMinResponse(BaseModel):
    nome: str


class ObraResponse(ObraCreate):
    id: int
    ativo: bool
    created_at: str
    clientes: ClienteMinResponse | None = None


class EquipeCreate(BaseModel):
    nome: str = Field(..., min_length=2)
    numero: str | None = Field(None, max_length=20, description="Número impresso no modelo de O.S (ex.: 12204)")
    descricao: str | None = None
    # IDs dos funcionários que compõem a equipe
    membro_ids: list[int] = Field(default_factory=list)
    # ID do líder: precisa pertencer à lista de membros (validado no endpoint)
    lider_id: int | None = None


class EquipeResponse(BaseModel):
    id: int
    nome: str
    numero: str | None
    descricao: str | None
    ativa: bool
    membros: list[dict]


class ProdutoCreate(BaseModel):
    nome: str = Field(..., min_length=2, description="Nome/descrição do serviço")
    codigo: str | None = Field(None, description="SKU/código de barras p/ bipagem")
    unidade: str = Field("UN", max_length=20)
    # Qtd USC (quantidade de unidades de serviço de construção) — a coluna
    # física continua `preco_unitario` (reaproveitada); o valor é exibido como USC.
    preco_unitario: float = Field(0, ge=0, description="Qtd USC")
    qtd_usc_especial: float = Field(0, ge=0, description="Qtd USC especial (adicional)")
    # Contrato (tipo de O.S) dono do serviço: construcao, manutencao ou linha_viva.
    # Obrigatório ao criar/editar; NULL só existe em registros legados.
    tipo: str = Field(..., description="Contrato do serviço: 'construcao', 'manutencao' ou 'linha_viva'")


class ProdutoResponse(BaseModel):
    id: int
    ativo: bool = True  # default do banco
    nome: str
    codigo: str | None = None
    unidade: str = "UN"
    preco_unitario: float = 0  # Qtd USC
    qtd_usc_especial: float = 0  # default do banco
    # NULL = legado (disponível em todos os contratos)
    tipo: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _obter_ou_404(db, tabela: str, registro_id: int, rotulo: str) -> dict:
    resp = db.table(tabela).select("*").eq("id", registro_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail=f"{rotulo} não encontrado(a).")
    return resp.data[0]


def _gravar_membros(db, equipe_id: int, membro_ids: list[int], lider_id: int | None):
    """Regrava a composição da equipe de forma atômica (delete + insert)."""
    db.table("equipe_membros").delete().eq("equipe_id", equipe_id).execute()
    if not membro_ids:
        return
    linhas = [
        {"equipe_id": equipe_id, "funcionario_id": fid, "lider": fid == lider_id}
        for fid in dict.fromkeys(membro_ids)  # dedup preservando ordem
    ]
    resp = db.table("equipe_membros").insert(linhas).execute()
    if not resp.data:
        raise HTTPException(status_code=500, detail="Falha ao salvar membros da equipe.")


def _membros_da_equipe(db, equipe_id: int) -> list[dict]:
    """Retorna os membros da equipe com nome resolvido via join manual."""
    resp = (
        db.table("equipe_membros")
        .select("id, funcionario_id, lider, funcionarios(nome, cpf)")
        .eq("equipe_id", equipe_id)
        .execute()
    )
    return [
        {
            "id": m["id"],
            "funcionario_id": m["funcionario_id"],
            "nome": (m.get("funcionarios") or {}).get("nome"),
            "lider": m.get("lider", False),
        }
        for m in resp.data
    ]


# ---------------------------------------------------------------------------
# Obras
# ---------------------------------------------------------------------------


@router.get("/obras", response_model=list[ObraResponse], dependencies=GESTOR_ONLY)
def listar_obras(
    busca: str | None = Query(None),
    incluir_inativas: bool = False,
    db=Depends(get_supabase),
):
    """Lista obras; opcionalmente filtra por termo (nome/cidade)."""
    try:
        query = db.table("obras").select("*, clientes(nome)")
        if not incluir_inativas:
            query = query.eq("ativo", True)
        if busca:
            query = query.or_(f"nome.ilike.%{busca}%,cidade.ilike.%{busca}%")
        return query.order("nome").execute().data
    except Exception:
        logger.exception("Erro ao listar obras")
        raise HTTPException(status_code=500, detail="Erro ao listar obras.") from None


@router.post("/obras", response_model=ObraResponse, status_code=201, dependencies=GESTOR_ONLY)
def criar_obra(obra: ObraCreate, db=Depends(get_supabase)):
    try:
        _obter_ou_404(db, "clientes", obra.cliente_id, "Cliente")
        resp = db.table("obras").insert(obra.model_dump()).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao criar obra.")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao criar obra")
        raise HTTPException(status_code=500, detail="Erro ao criar obra.") from None


@router.put("/obras/{obra_id}", response_model=ObraResponse, dependencies=GESTOR_ONLY)
def atualizar_obra(obra_id: int, obra: ObraCreate, db=Depends(get_supabase)):
    try:
        _obter_ou_404(db, "obras", obra_id, "Obra")
        _obter_ou_404(db, "clientes", obra.cliente_id, "Cliente")
        resp = db.table("obras").update(obra.model_dump()).eq("id", obra_id).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar obra.")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao atualizar obra %s", obra_id)
        raise HTTPException(status_code=500, detail="Erro ao atualizar obra.") from None


@router.delete("/obras/{obra_id}", dependencies=GESTOR_ONLY)
def excluir_obra(obra_id: int, db=Depends(get_supabase)):
    """Exclusão lógica: mantém o histórico de O.S íntegro."""
    try:
        _obter_ou_404(db, "obras", obra_id, "Obra")
        usadas = db.table("ordens_servico").select("id").eq("obra_id", obra_id).limit(1).execute()
        if usadas.data:
            db.table("obras").update({"ativo": False}).eq("id", obra_id).execute()
            return {"success": True, "message": "Obra possui O.S vinculadas e foi apenas inativada."}
        db.table("obras").delete().eq("id", obra_id).execute()
        return {"success": True, "message": "Obra excluída com sucesso."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao excluir obra %s", obra_id)
        raise HTTPException(status_code=500, detail="Erro ao excluir obra.") from None


# ---------------------------------------------------------------------------
# Equipes
# ---------------------------------------------------------------------------


@router.get("/equipes", response_model=list[EquipeResponse], dependencies=GESTOR_ONLY)
def listar_equipes(db=Depends(get_supabase)):
    try:
        equipes = db.table("equipes").select("*").order("nome").execute().data
        resultado = []
        for eq in equipes:
            resultado.append(
                {
                    **eq,
                    "membros": _membros_da_equipe(db, eq["id"]),
                }
            )
        return resultado
    except Exception:
        logger.exception("Erro ao listar equipes")
        raise HTTPException(status_code=500, detail="Erro ao listar equipes.") from None


@router.post("/equipes", response_model=EquipeResponse, status_code=201, dependencies=GESTOR_ONLY)
def criar_equipe(equipe: EquipeCreate, db=Depends(get_supabase)):
    try:
        dup = db.table("equipes").select("id").eq("nome", equipe.nome).execute()
        if dup.data:
            raise HTTPException(status_code=400, detail="Já existe uma equipe com este nome.")
        # Regra: o líder deve fazer parte da equipe.
        if equipe.lider_id is not None and equipe.lider_id not in equipe.membro_ids:
            raise HTTPException(status_code=400, detail="O líder deve ser um membro da equipe.")
        resp = (
            db.table("equipes")
            .insert(
                {
                    "nome": equipe.nome,
                    "numero": equipe.numero,
                    "descricao": equipe.descricao,
                }
            )
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao criar equipe.")
        nova = resp.data[0]
        _gravar_membros(db, nova["id"], equipe.membro_ids, equipe.lider_id)
        return {**nova, "membros": _membros_da_equipe(db, nova["id"])}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao criar equipe")
        raise HTTPException(status_code=500, detail="Erro ao criar equipe.") from None


@router.put("/equipes/{equipe_id}", response_model=EquipeResponse, dependencies=GESTOR_ONLY)
def atualizar_equipe(equipe_id: int, equipe: EquipeCreate, db=Depends(get_supabase)):
    try:
        _obter_ou_404(db, "equipes", equipe_id, "Equipe")
        if equipe.lider_id is not None and equipe.lider_id not in equipe.membro_ids:
            raise HTTPException(status_code=400, detail="O líder deve ser um membro da equipe.")
        resp = (
            db.table("equipes")
            .update(
                {
                    "nome": equipe.nome,
                    "numero": equipe.numero,
                    "descricao": equipe.descricao,
                }
            )
            .eq("id", equipe_id)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar equipe.")
        _gravar_membros(db, equipe_id, equipe.membro_ids, equipe.lider_id)
        return {**resp.data[0], "membros": _membros_da_equipe(db, equipe_id)}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao atualizar equipe %s", equipe_id)
        raise HTTPException(status_code=500, detail="Erro ao atualizar equipe.") from None


@router.delete("/equipes/{equipe_id}", dependencies=GESTOR_ONLY)
def excluir_equipe(equipe_id: int, db=Depends(get_supabase)):
    try:
        _obter_ou_404(db, "equipes", equipe_id, "Equipe")
        usadas = db.table("ordens_servico").select("id").eq("equipe_id", equipe_id).limit(1).execute()
        if usadas.data:
            db.table("equipes").update({"ativa": False}).eq("id", equipe_id).execute()
            return {"success": True, "message": "Equipe possui O.S vinculadas e foi apenas desativada."}
        db.table("equipes").delete().eq("id", equipe_id).execute()
        return {"success": True, "message": "Equipe excluída com sucesso."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao excluir equipe %s", equipe_id)
        raise HTTPException(status_code=500, detail="Erro ao excluir equipe.") from None


# ---------------------------------------------------------------------------
# Produtos (serviços por contrato)
# ---------------------------------------------------------------------------

TIPOS_SERVICO = {"construcao", "manutencao", "linha_viva"}


def _validar_tipo_servico(tipo: str) -> None:
    if tipo not in TIPOS_SERVICO:
        raise HTTPException(
            status_code=422,
            detail=f"Contrato inválido: '{tipo}'. Use 'construcao', 'manutencao' ou 'linha_viva'.",
        )


@router.get("/produtos", response_model=list[ProdutoResponse])
def listar_produtos(
    busca: str | None = Query(None, description="Busca por nome ou código (autocompletar)"),
    tipo: str | None = Query(None, description="Filtra pelo contrato (legados sem tipo valem para todos)"),
    db=Depends(get_supabase),
):
    try:
        query = db.table("produtos").select("*").eq("ativo", True)
        if busca:
            query = query.or_(f"nome.ilike.%{busca}%,codigo.ilike.%{busca}%")
        dados = query.order("nome").limit(50).execute().data
        if tipo:
            # Serviços legados (tipo NULL) são válidos em todos os contratos.
            dados = [p for p in dados if p.get("tipo") is None or p["tipo"] == tipo]
        return dados
    except Exception:
        logger.exception("Erro ao listar produtos")
        raise HTTPException(status_code=500, detail="Erro ao listar serviços.") from None


@router.post("/produtos", response_model=ProdutoResponse, status_code=201, dependencies=GESTOR_ONLY)
def criar_produto(produto: ProdutoCreate, db=Depends(get_supabase)):
    try:
        _validar_tipo_servico(produto.tipo)
        if produto.codigo:
            dup = db.table("produtos").select("id").eq("codigo", produto.codigo).execute()
            if dup.data:
                raise HTTPException(status_code=400, detail="Já existe um serviço com este código.")
        resp = db.table("produtos").insert(produto.model_dump()).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao criar serviço.")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao criar produto")
        raise HTTPException(status_code=500, detail="Erro ao criar serviço.") from None


@router.put("/produtos/{produto_id}", response_model=ProdutoResponse, dependencies=GESTOR_ONLY)
def atualizar_produto(produto_id: int, produto: ProdutoCreate, db=Depends(get_supabase)):
    try:
        _obter_ou_404(db, "produtos", produto_id, "Serviço")
        _validar_tipo_servico(produto.tipo)
        resp = db.table("produtos").update(produto.model_dump()).eq("id", produto_id).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar serviço.")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao atualizar produto %s", produto_id)
        raise HTTPException(status_code=500, detail="Erro ao atualizar serviço.") from None


@router.delete("/produtos/{produto_id}", dependencies=GESTOR_ONLY)
def excluir_produto(produto_id: int, db=Depends(get_supabase)):
    try:
        _obter_ou_404(db, "produtos", produto_id, "Serviço")
        usadas = db.table("os_materiais").select("id").eq("produto_id", produto_id).limit(1).execute()
        if usadas.data:
            db.table("produtos").update({"ativo": False}).eq("id", produto_id).execute()
            return {"success": True, "message": "Serviço possui lançamentos e foi apenas inativado."}
        db.table("produtos").delete().eq("id", produto_id).execute()
        return {"success": True, "message": "Serviço excluído com sucesso."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao excluir produto %s", produto_id)
        raise HTTPException(status_code=500, detail="Erro ao excluir serviço.") from None
