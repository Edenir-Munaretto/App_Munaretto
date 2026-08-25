"""Cadastros de apoio do módulo Controle de O.S.: Obras, Equipes e Produtos.

Segue o mesmo padrão dos demais routers do projeto: Supabase via PostgREST,
validação com Pydantic e permissão de módulo ("os").
"""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from supabase_client import get_supabase
from auth import require_permisao

router = APIRouter(dependencies=[Depends(require_permisao("os"))])

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Schemas Pydantic
# ---------------------------------------------------------------------------

class ObraCreate(BaseModel):
    cliente_id: int = Field(..., description="ID do cliente dono da obra")
    nome: str = Field(..., min_length=2, description="Nome/identificação da obra")
    endereco: Optional[str] = None
    cidade: Optional[str] = None

class ObraResponse(ObraCreate):
    id: int
    ativo: bool
    created_at: str

class EquipeCreate(BaseModel):
    nome: str = Field(..., min_length=2)
    descricao: Optional[str] = None
    # IDs dos funcionários que compõem a equipe
    membro_ids: List[int] = Field(default_factory=list)
    # ID do líder: precisa pertencer à lista de membros (validado no endpoint)
    lider_id: Optional[int] = None

class EquipeResponse(BaseModel):
    id: int
    nome: str
    descricao: Optional[str]
    ativa: bool
    membros: List[dict]

class ProdutoCreate(BaseModel):
    nome: str = Field(..., min_length=2, description="Nome/descrição do produto")
    codigo: Optional[str] = Field(None, description="SKU/código de barras p/ bipagem")
    unidade: str = Field("UN", max_length=20)
    preco_unitario: float = Field(0, ge=0)

class ProdutoResponse(ProdutoCreate):
    id: int
    ativo: bool

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _obter_ou_404(db, tabela: str, registro_id: int, rotulo: str) -> dict:
    resp = db.table(tabela).select("*").eq("id", registro_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail=f"{rotulo} não encontrado(a).")
    return resp.data[0]


def _gravar_membros(db, equipe_id: int, membro_ids: List[int], lider_id: Optional[int]):
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


def _membros_da_equipe(db, equipe_id: int) -> List[dict]:
    """Retorna os membros com nome/valor_hora resolvidos via join manual."""
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

@router.get("/obras", response_model=List[ObraResponse])
def listar_obras(
    busca: Optional[str] = Query(None),
    incluir_inativas: bool = False,
    db=Depends(get_supabase),
):
    """Lista obras; opcionalmente filtra por termo (nome/cidade)."""
    try:
        query = db.table("obras").select("*")
        if not incluir_inativas:
            query = query.eq("ativo", True)
        if busca:
            query = query.or_(f"nome.ilike.%{busca}%,cidade.ilike.%{busca}%")
        return query.order("nome").execute().data
    except Exception:
        logger.exception("Erro ao listar obras")
        raise HTTPException(status_code=500, detail="Erro ao listar obras.")


@router.post("/obras", response_model=ObraResponse, status_code=201)
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
        raise HTTPException(status_code=500, detail="Erro ao criar obra.")


@router.put("/obras/{obra_id}", response_model=ObraResponse)
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
        raise HTTPException(status_code=500, detail="Erro ao atualizar obra.")


@router.delete("/obras/{obra_id}")
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
        raise HTTPException(status_code=500, detail="Erro ao excluir obra.")

# ---------------------------------------------------------------------------
# Equipes
# ---------------------------------------------------------------------------

@router.get("/equipes", response_model=List[EquipeResponse])
def listar_equipes(db=Depends(get_supabase)):
    try:
        equipes = db.table("equipes").select("*").order("nome").execute().data
        resultado = []
        for eq in equipes:
            resultado.append({
                **eq,
                "membros": _membros_da_equipe(db, eq["id"]),
            })
        return resultado
    except Exception:
        logger.exception("Erro ao listar equipes")
        raise HTTPException(status_code=500, detail="Erro ao listar equipes.")


@router.post("/equipes", response_model=EquipeResponse, status_code=201)
def criar_equipe(equipe: EquipeCreate, db=Depends(get_supabase)):
    try:
        dup = db.table("equipes").select("id").eq("nome", equipe.nome).execute()
        if dup.data:
            raise HTTPException(status_code=400, detail="Já existe uma equipe com este nome.")
        # Regra: o líder deve fazer parte da equipe.
        if equipe.lider_id is not None and equipe.lider_id not in equipe.membro_ids:
            raise HTTPException(status_code=400, detail="O líder deve ser um membro da equipe.")
        resp = db.table("equipes").insert({
            "nome": equipe.nome,
            "descricao": equipe.descricao,
        }).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao criar equipe.")
        nova = resp.data[0]
        _gravar_membros(db, nova["id"], equipe.membro_ids, equipe.lider_id)
        return {**nova, "membros": _membros_da_equipe(db, nova["id"])}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao criar equipe")
        raise HTTPException(status_code=500, detail="Erro ao criar equipe.")


@router.put("/equipes/{equipe_id}", response_model=EquipeResponse)
def atualizar_equipe(equipe_id: int, equipe: EquipeCreate, db=Depends(get_supabase)):
    try:
        _obter_ou_404(db, "equipes", equipe_id, "Equipe")
        if equipe.lider_id is not None and equipe.lider_id not in equipe.membro_ids:
            raise HTTPException(status_code=400, detail="O líder deve ser um membro da equipe.")
        resp = db.table("equipes").update({
            "nome": equipe.nome,
            "descricao": equipe.descricao,
        }).eq("id", equipe_id).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar equipe.")
        _gravar_membros(db, equipe_id, equipe.membro_ids, equipe.lider_id)
        return {**resp.data[0], "membros": _membros_da_equipe(db, equipe_id)}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao atualizar equipe %s", equipe_id)
        raise HTTPException(status_code=500, detail="Erro ao atualizar equipe.")


@router.delete("/equipes/{equipe_id}")
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
        raise HTTPException(status_code=500, detail="Erro ao excluir equipe.")

# ---------------------------------------------------------------------------
# Produtos
# ---------------------------------------------------------------------------

@router.get("/produtos", response_model=List[ProdutoResponse])
def listar_produtos(
    busca: Optional[str] = Query(None, description="Busca por nome ou código (autocompletar)"),
    db=Depends(get_supabase),
):
    try:
        query = db.table("produtos").select("*").eq("ativo", True)
        if busca:
            query = query.or_(f"nome.ilike.%{busca}%,codigo.ilike.%{busca}%")
        return query.order("nome").limit(50).execute().data
    except Exception:
        logger.exception("Erro ao listar produtos")
        raise HTTPException(status_code=500, detail="Erro ao listar produtos.")


@router.post("/produtos", response_model=ProdutoResponse, status_code=201)
def criar_produto(produto: ProdutoCreate, db=Depends(get_supabase)):
    try:
        if produto.codigo:
            dup = db.table("produtos").select("id").eq("codigo", produto.codigo).execute()
            if dup.data:
                raise HTTPException(status_code=400, detail="Já existe um produto com este código.")
        resp = db.table("produtos").insert(produto.model_dump()).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao criar produto.")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao criar produto")
        raise HTTPException(status_code=500, detail="Erro ao criar produto.")


@router.put("/produtos/{produto_id}", response_model=ProdutoResponse)
def atualizar_produto(produto_id: int, produto: ProdutoCreate, db=Depends(get_supabase)):
    try:
        _obter_ou_404(db, "produtos", produto_id, "Produto")
        resp = db.table("produtos").update(produto.model_dump()).eq("id", produto_id).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar produto.")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao atualizar produto %s", produto_id)
        raise HTTPException(status_code=500, detail="Erro ao atualizar produto.")


@router.delete("/produtos/{produto_id}")
def excluir_produto(produto_id: int, db=Depends(get_supabase)):
    try:
        _obter_ou_404(db, "produtos", produto_id, "Produto")
        usadas = (
            db.table("os_materiais").select("id").eq("produto_id", produto_id).limit(1).execute()
        )
        if usadas.data:
            db.table("produtos").update({"ativo": False}).eq("id", produto_id).execute()
            return {"success": True, "message": "Produto possui lançamentos e foi apenas inativado."}
        db.table("produtos").delete().eq("id", produto_id).execute()
        return {"success": True, "message": "Produto excluído com sucesso."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao excluir produto %s", produto_id)
        raise HTTPException(status_code=500, detail="Erro ao excluir produto.")
