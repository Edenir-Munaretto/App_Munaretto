from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, Field
from typing import List, Optional
from supabase_client import get_supabase

router = APIRouter()

class ComprovanteCreate(BaseModel):
    tipo_documento: str = Field(..., description="Tipo do documento: Nota Fiscal, Boleto, Pix, Diversas, Aluguel")
    
    # Campos Nota Fiscal
    numero_nf: Optional[str] = None
    data_emissao: Optional[str] = None
    nome: Optional[str] = None
    cnpj: Optional[str] = None
    local_servico: Optional[str] = None
    valor_total: Optional[float] = 0.0
    base_calculo: Optional[float] = 0.0
    valor_inss: Optional[float] = 0.0
    valor_iss: Optional[float] = 0.0
    valor_liquido: Optional[float] = 0.0
    
    # Outros tipos (Boleto, Pix, Diversas, Aluguel)
    data_pagamento: Optional[str] = None
    data_vencimento: Optional[str] = None
    descricao: Optional[str] = None
    forma_pagamento: Optional[str] = None # "boleto", "dda", "pix"
    valor_pago: Optional[float] = 0.0
    valor_juros: Optional[float] = 0.0

class ComprovanteResponse(ComprovanteCreate):
    id: int
    data_registro: str

@router.get("/", response_model=List[ComprovanteResponse])
def listar_comprovantes(db = Depends(get_supabase)):
    """Lista todos os lançamentos de comprovantes registrados."""
    try:
        response = db.table("comprovantes").select("*").order("data_registro", desc=True).execute()
        return response.data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao buscar comprovantes: {str(e)}")

@router.get("/{comprovante_id}", response_model=ComprovanteResponse)
def buscar_comprovante(comprovante_id: int, db = Depends(get_supabase)):
    """Busca um comprovante específico pelo ID."""
    try:
        response = db.table("comprovantes").select("*").eq("id", comprovante_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Comprovante não encontrado.")
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao buscar comprovante: {str(e)}")

@router.post("/", response_model=ComprovanteResponse, status_code=201)
def criar_comprovante(comprovante: ComprovanteCreate, db = Depends(get_supabase)):
    """Cria um novo lançamento de comprovante."""
    try:
        payload = comprovante.model_dump()
        # Higieniza strings vazias para None, evitando erros em campos opcionais e do tipo data
        for key, value in list(payload.items()):
            if value == "":
                payload[key] = None
        response = db.table("comprovantes").insert(payload).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao salvar comprovante.")
        return response.data[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao criar comprovante: {str(e)}")

@router.put("/{comprovante_id}", response_model=ComprovanteResponse)
def atualizar_comprovante(comprovante_id: int, comprovante: ComprovanteCreate, db = Depends(get_supabase)):
    """Atualiza um comprovante existente."""
    try:
        check = db.table("comprovantes").select("id").eq("id", comprovante_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Comprovante não encontrado.")

        payload = comprovante.model_dump()
        # Higieniza strings vazias para None, evitando erros em campos opcionais e do tipo data
        for key, value in list(payload.items()):
            if value == "":
                payload[key] = None
        response = db.table("comprovantes").update(payload).eq("id", comprovante_id).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar comprovante.")
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar comprovante: {str(e)}")

@router.delete("/{comprovante_id}")
def excluir_comprovante(comprovante_id: int, db = Depends(get_supabase)):
    """Exclui um comprovante do sistema."""
    try:
        check = db.table("comprovantes").select("id").eq("id", comprovante_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Comprovante não encontrado.")

        db.table("comprovantes").delete().eq("id", comprovante_id).execute()
        return {"status": "success", "message": "Comprovante excluído com sucesso."}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao excluir comprovante: {str(e)}")
