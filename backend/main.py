import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import clientes, ferias, fluxo_caixa, documentos

app = FastAPI(
    title="App Munaretto Web API",
    description="Backend API para gerenciamento de clientes, contratos, férias e fluxo de caixa.",
    version="1.0.0"
)

# Configuração de CORS para permitir acesso do frontend React (Vite roda na porta 5173 por padrão)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Em produção, defina o domínio do frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inclui os roteadores da API
app.include_router(clientes.router, prefix="/api/clientes", tags=["Clientes"])
app.include_router(ferias.router, prefix="/api/ferias", tags=["Gestão de Férias"])
app.include_router(fluxo_caixa.router, prefix="/api/fluxo-caixa", tags=["Fluxo de Caixa"])
app.include_router(documentos.router, prefix="/api/documentos", tags=["Documentos"])

@app.get("/health", tags=["Geral"])
def health_check():
    """Rota simples para verificar se a API está online."""
    return {"status": "online", "message": "App Munaretto API rodando com sucesso."}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
