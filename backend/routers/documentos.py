from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Depends
from fastapi.responses import FileResponse
from typing import List, Dict
import os
import tempfile
import shutil
from supabase_client import get_supabase
from utils.document_generator import (
    TEMPLATES_DIR,
    garantir_pastas,
    preencher_word,
    preencher_excel,
    convert_docx_to_pdf
)

router = APIRouter()

@router.get("/templates")
def listar_modelos():
    """Retorna os nomes dos modelos disponíveis para Word (.docx) e Excel (.xlsx)."""
    garantir_pastas()
    templates_word = []
    templates_excel = []
    
    try:
        for arquivo in sorted(os.listdir(TEMPLATES_DIR)):
            if arquivo.lower().endswith(".docx"):
                templates_word.append(os.path.splitext(arquivo)[0])
            elif arquivo.lower().endswith(".xlsx"):
                templates_excel.append(os.path.splitext(arquivo)[0])
        
        return {
            "word": templates_word,
            "excel": templates_excel
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao listar templates: {str(e)}")

@router.post("/templates/upload")
def upload_modelo(file: UploadFile = File(...)):
    """Envia um novo modelo de documento (.docx ou .xlsx) para a pasta de templates do backend."""
    garantir_pastas()
    
    filename = file.filename
    ext = os.path.splitext(filename)[1].lower()
    if ext not in [".docx", ".xlsx"]:
        raise HTTPException(status_code=400, detail="Formato inválido. Apenas arquivos .docx ou .xlsx são permitidos.")
        
    caminho_destino = os.path.join(TEMPLATES_DIR, filename)
    try:
        with open(caminho_destino, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        return {"success": True, "message": f"Template '{filename}' importado com sucesso."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao salvar arquivo de template: {str(e)}")

@router.post("/gerar")
def gerar_documento(
    cliente_id: int = Form(...),
    template_name: str = Form(...),
    formato: str = Form(..., description="Formato desejado: word, pdf ou excel"),
    db = Depends(get_supabase)
):
    """Gera um documento personalizado para o cliente e inicia o download diretamente no navegador."""
    # 1. Busca dados do cliente no Supabase
    cliente_resp = db.table("clientes").select("*").eq("id", cliente_id).execute()
    if not cliente_resp.data:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    
    cliente = cliente_resp.data[0]
    temp_dir = tempfile.gettempdir()
    caminho_gerado = None
    media_type = "application/octet-stream"
    
    formato = formato.lower()
    
    try:
        # 2. Geração do arquivo no diretório temporário
        if formato == "word":
            caminho_gerado = preencher_word(cliente, template_name, temp_dir)
            media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        elif formato == "excel":
            caminho_gerado = preencher_excel(cliente, template_name, temp_dir)
            media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        elif formato == "pdf":
            # Para gerar PDF, primeiro geramos o Word e depois convertemos
            caminho_word = preencher_word(cliente, template_name, temp_dir)
            if not caminho_word:
                raise HTTPException(status_code=404, detail="Template do Word correspondente não encontrado para conversão.")
            
            caminho_gerado = convert_docx_to_pdf(caminho_word, temp_dir)
            # Remove o Word temporário
            if os.path.exists(caminho_word):
                os.remove(caminho_word)
                
            media_type = "application/pdf"
        else:
            raise HTTPException(status_code=400, detail="Formato não suportado. Escolha entre: word, pdf, excel.")
            
        if not caminho_gerado or not os.path.exists(caminho_gerado):
            raise HTTPException(status_code=500, detail="Erro interno ao gerar o arquivo preenchido.")
            
        nome_arquivo = os.path.basename(caminho_gerado)
        
        # 3. Registra a geração do documento no histórico do Supabase
        db.table("documentos_gerados").insert({
            "cliente_id": cliente_id,
            "tipo_documento": template_name,
            "formato": formato,
            "caminho_arquivo": nome_arquivo
        }).execute()
        
        # 4. Retorna o arquivo para download
        return FileResponse(
            caminho_gerado,
            media_type=media_type,
            filename=nome_arquivo
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro no processamento do documento: {str(e)}")
