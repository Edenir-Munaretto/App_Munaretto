"""Módulo isolado Materiais por Cliente.

Cadastro simples de materiais (cabo/poste/trafo) por nome de cliente.
Não há vínculo com a tabela `clientes` nem alteração de outros módulos: o
nome do cliente é texto livre e todos os dados ficam na tabela `materiais`.
"""

import logging
import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from auth import require_permisao
from supabase_client import get_supabase

router = APIRouter(dependencies=[Depends(require_permisao("materiais"))])

logger = logging.getLogger(__name__)

Categoria = Literal["cabo", "poste", "trafo"]
CATEGORIAS = ("cabo", "poste", "trafo")
ORDEM_CATEGORIAS = {categoria: indice for indice, categoria in enumerate(CATEGORIAS)}


class MaterialBase(BaseModel):
    cliente_nome: str = Field(
        ...,
        min_length=1,
        max_length=255,
        description="Nome do cliente (texto livre, sem vínculo com o cadastro de clientes)",
    )
    categoria: Categoria = Field(..., description="cabo, poste ou trafo")
    quantidade: float = Field(..., gt=0, description="Quantidade do material")
    descricao: str = Field(..., min_length=1, description="Descrição livre do material")

    @field_validator("cliente_nome", "descricao")
    @classmethod
    def _limpar_texto(cls, valor: str) -> str:
        valor = (valor or "").strip()
        if not valor:
            raise ValueError("O campo não pode ficar em branco.")
        return valor


class MaterialCreate(MaterialBase):
    pass


class MaterialResponse(MaterialBase):
    id: int
    created_at: str | None = None
    updated_at: str | None = None


def _termo_busca_seguro(termo: str | None) -> str:
    """Remove caracteres que o PostgREST interpreta como sintaxe de filtro."""
    if not termo:
        return ""
    return re.sub(r"[(),.%:;\"\\\[\]]", "", termo).strip()


def _validar_categoria(categoria: str | None) -> str | None:
    if not categoria:
        return None
    valor = categoria.strip().lower()
    if valor not in CATEGORIAS:
        raise HTTPException(
            status_code=400,
            detail="Categoria inválida. Use 'cabo', 'poste' ou 'trafo'.",
        )
    return valor


def _ordenar_materiais(materiais: list[dict]) -> list[dict]:
    """Ordena por cliente, categoria (cabo/poste/trafo) e id."""
    return sorted(
        materiais,
        key=lambda item: (
            str(item.get("cliente_nome") or "").lower(),
            ORDEM_CATEGORIAS.get(item.get("categoria"), len(CATEGORIAS)),
            item.get("id") or 0,
        ),
    )


@router.get("/", response_model=list[MaterialResponse])
def listar_materiais(
    cliente: str | None = Query(None, description="Filtro por nome do cliente"),
    categoria: str | None = Query(None, description="Filtro por categoria: cabo, poste ou trafo"),
    busca: str | None = Query(None, description="Busca por cliente ou descrição"),
    db=Depends(get_supabase),
):
    """Lista os materiais cadastrados, com filtros opcionais."""
    try:
        query = db.table("materiais").select("*")

        if cliente:
            termo = _termo_busca_seguro(cliente)
            if termo:
                query = query.ilike("cliente_nome", f"%{termo}%")

        categoria_validada = _validar_categoria(categoria)
        if categoria_validada:
            query = query.eq("categoria", categoria_validada)

        if busca:
            termo = _termo_busca_seguro(busca)
            if termo:
                query = query.or_(f"cliente_nome.ilike.%{termo}%,descricao.ilike.%{termo}%")

        response = query.execute()
        return _ordenar_materiais(response.data or [])
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao listar materiais")
        raise HTTPException(status_code=500, detail="Erro ao listar materiais.") from None


@router.get("/{material_id}", response_model=MaterialResponse)
def buscar_material(material_id: int, db=Depends(get_supabase)):
    """Busca um material específico pelo ID."""
    try:
        response = db.table("materiais").select("*").eq("id", material_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Material não encontrado.")
        return response.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao buscar material %s", material_id)
        raise HTTPException(status_code=500, detail="Erro ao buscar material.") from None


@router.post("/", response_model=MaterialResponse, status_code=201)
def criar_material(material: MaterialCreate, db=Depends(get_supabase)):
    """Cadastra um material no módulo isolado."""
    try:
        response = db.table("materiais").insert(material.model_dump()).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao cadastrar material.")
        return response.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao cadastrar material")
        raise HTTPException(status_code=500, detail="Erro ao cadastrar material.") from None


@router.put("/{material_id}", response_model=MaterialResponse)
def atualizar_material(material_id: int, material: MaterialCreate, db=Depends(get_supabase)):
    """Atualiza os dados de um material existente."""
    try:
        check = db.table("materiais").select("id").eq("id", material_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Material não encontrado.")

        response = db.table("materiais").update(material.model_dump()).eq("id", material_id).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar material.")
        return response.data[0]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao atualizar material %s", material_id)
        raise HTTPException(status_code=500, detail="Erro ao atualizar material.") from None


@router.delete("/{material_id}")
def excluir_material(material_id: int, db=Depends(get_supabase)):
    """Exclui definitivamente um material do módulo."""
    try:
        check = db.table("materiais").select("id").eq("id", material_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Material não encontrado.")

        db.table("materiais").delete().eq("id", material_id).execute()
        return {"success": True, "message": "Material excluído com sucesso."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro ao excluir material %s", material_id)
        raise HTTPException(status_code=500, detail="Erro ao excluir material.") from None
