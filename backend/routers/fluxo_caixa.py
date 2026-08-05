import logging
from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import List, Optional
import os
from supabase_client import get_supabase
from utils.pdf_generator import gerar_pdf_mensal, gerar_pdf_socio_especifico
from auth import get_current_user, require_permisao

router = APIRouter(dependencies=[Depends(require_permisao("fluxo"))])

logger = logging.getLogger(__name__)

class FluxoCaixaCreate(BaseModel):
    mes_referencia: str = Field(..., description="Mês de referência (ex: Janeiro/2026 ou 2026-01)")
    rendimento_usina1: float = Field(0.0, description="Rendimento da Usina 1")
    rendimento_usina2: float = Field(0.0, description="Rendimento da Usina 2")
    rendimento_usina3: float = Field(0.0, description="Rendimento da Usina 3")
    despesa_contabilidade: float = Field(0.0, description="Despesa com contabilidade")
    despesa_internet: float = Field(0.0, description="Despesa com internet")
    despesa_lavagem: float = Field(0.0, description="Despesa com lavagem de usinas")
    despesa_manutencao: float = Field(0.0, description="Despesa com manutenção")
    despesa_imposto: float = Field(0.0, description="Despesa com impostos")
    despesa_taxa: float = Field(0.0, description="Despesa com taxas ou seguro")
    despesa_diversas: float = Field(0.0, description="Outras despesas diversas")

class FluxoCaixaResponse(FluxoCaixaCreate):
    id: int
    total_liquido: float
    data_registro: str

def format_currency_br(val: float) -> str:
    return f"{val:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

@router.get("/", response_model=List[FluxoCaixaResponse])
def listar_fluxos(db = Depends(get_supabase)):
    """Lista todos os fechamentos de fluxo de caixa registrados."""
    try:
        response = db.table("fluxo_caixa").select("*").order("data_registro", desc=True).execute()
        return response.data
    except Exception as e:
        logger.exception("Erro ao buscar fluxo de caixa")
        raise HTTPException(status_code=500, detail="Erro ao buscar fluxo de caixa")
@router.get("/{fluxo_id}", response_model=FluxoCaixaResponse)
def buscar_fluxo(fluxo_id: int, db = Depends(get_supabase)):
    """Busca um registro específico de fluxo de caixa pelo ID."""
    try:
        response = db.table("fluxo_caixa").select("*").eq("id", fluxo_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Fechamento financeiro não encontrado.")
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao buscar fluxo de caixa")
        raise HTTPException(status_code=500, detail="Erro ao buscar fluxo de caixa")
@router.post("/", response_model=FluxoCaixaResponse, status_code=201)
def criar_fluxo(fluxo: FluxoCaixaCreate, db = Depends(get_supabase)):
    """Salva um novo fechamento de fluxo de caixa calculando automaticamente o total líquido."""
    try:
        # Calcula total líquido
        entradas = fluxo.rendimento_usina1 + fluxo.rendimento_usina2 + fluxo.rendimento_usina3
        saidas = (
            fluxo.despesa_contabilidade + fluxo.despesa_internet + fluxo.despesa_lavagem +
            fluxo.despesa_manutencao + fluxo.despesa_imposto + fluxo.despesa_taxa + fluxo.despesa_diversas
        )
        total_liquido = entradas - saidas

        payload = fluxo.model_dump()
        payload["total_liquido"] = total_liquido

        response = db.table("fluxo_caixa").insert(payload).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao salvar fluxo de caixa.")
            
        return response.data[0]
    except Exception as e:
        logger.exception("Erro ao salvar fluxo de caixa")
        raise HTTPException(status_code=500, detail="Erro ao salvar fluxo de caixa")
@router.put("/{fluxo_id}", response_model=FluxoCaixaResponse)
def atualizar_fluxo(fluxo_id: int, fluxo: FluxoCaixaCreate, db = Depends(get_supabase)):
    """Atualiza um fechamento financeiro existente e recalcula o total líquido."""
    try:
        check = db.table("fluxo_caixa").select("id").eq("id", fluxo_id).execute()
        if not check.data:
            raise HTTPException(status_code=404, detail="Fechamento financeiro não encontrado.")

        # Calcula total líquido
        entradas = fluxo.rendimento_usina1 + fluxo.rendimento_usina2 + fluxo.rendimento_usina3
        saidas = (
            fluxo.despesa_contabilidade + fluxo.despesa_internet + fluxo.despesa_lavagem +
            fluxo.despesa_manutencao + fluxo.despesa_imposto + fluxo.despesa_taxa + fluxo.despesa_diversas
        )
        total_liquido = entradas - saidas

        payload = fluxo.model_dump()
        payload["total_liquido"] = total_liquido

        response = db.table("fluxo_caixa").update(payload).eq("id", fluxo_id).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Falha ao atualizar fluxo de caixa.")
            
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao atualizar fluxo de caixa")
        raise HTTPException(status_code=500, detail="Erro ao atualizar fluxo de caixa")
@router.delete("/{fluxo_id}")
def excluir_fluxo(fluxo_id: int, db = Depends(get_supabase)):
    """Exclui um fechamento de fluxo de caixa pelo ID."""
    try:
        response = db.table("fluxo_caixa").delete().eq("id", fluxo_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Fechamento financeiro não encontrado.")
        return {"success": True, "message": "Fechamento de fluxo de caixa excluído com sucesso."}
    except Exception as e:
        logger.exception("Erro ao excluir fluxo de caixa")
        raise HTTPException(status_code=500, detail="Erro ao excluir fluxo de caixa")
@router.get("/{fluxo_id}/relatorio")
def obter_relatorio_pdf(
    fluxo_id: int,
    socio: Optional[str] = Query(None, description="Filtro para gerar relatório apenas de um sócio específico (ex: Demarco, Marlene, João B., Nei Rigo, Gilmar T.)"),
    db = Depends(get_supabase)
):
    """Gera um relatório PDF do fechamento mensal e envia o arquivo diretamente para download."""
    try:
        response = db.table("fluxo_caixa").select("*").eq("id", fluxo_id).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Fluxo de caixa não encontrado.")
        
        row = response.data[0]
        
        # Estrutura dados formatados no padrão BR para o gerador de PDF
        dados_usinas = {
            "Rendimento Usina 01": format_currency_br(row["rendimento_usina1"]),
            "Rendimento Usina 02": format_currency_br(row["rendimento_usina2"]),
            "Rendimento Usina 03": format_currency_br(row["rendimento_usina3"])
        }
        
        dados_despesas = {
            "Contabilidade": format_currency_br(row["despesa_contabilidade"]),
            "Internet": format_currency_br(row["despesa_internet"]),
            "Lavagem Usinas": format_currency_br(row["despesa_lavagem"]),
            "Manutenção": format_currency_br(row["despesa_manutencao"]),
            "Impostos": format_currency_br(row["despesa_imposto"]),
            "Seguro/Taxas": format_currency_br(row["despesa_taxa"]),
            "Diversas": format_currency_br(row["despesa_diversas"])
        }
        
        total_liquido_str = format_currency_br(row["total_liquido"])
        mes_ref = row["mes_referencia"]
        
        if socio:
            valid_socios = ["Demarco", "Marlene", "João B.", "Nei Rigo", "Gilmar T."]
            if socio not in valid_socios:
                raise HTTPException(status_code=400, detail=f"Sócio inválido. Escolha entre: {', '.join(valid_socios)}")
            
            caminho_pdf = gerar_pdf_socio_especifico(socio, mes_ref, dados_usinas, dados_despesas, total_liquido_str)
            nome_download = f"Relatorio_{socio}_{mes_ref.replace('/', '-')}.pdf"
        else:
            caminho_pdf = gerar_pdf_mensal(mes_ref, dados_usinas, dados_despesas, total_liquido_str)
            nome_download = f"Relatorio_Geral_{mes_ref.replace('/', '-')}.pdf"
            
        if not os.path.exists(caminho_pdf):
            raise HTTPException(status_code=500, detail="Erro interno ao gerar o arquivo PDF.")
            
        return FileResponse(
            caminho_pdf,
            media_type="application/pdf",
            filename=nome_download
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao gerar relatório do fluxo")
        raise HTTPException(status_code=500, detail="Erro ao gerar relatório do fluxo")