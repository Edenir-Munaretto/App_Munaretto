import logging
import os
import sys

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from routers import (
    apoio_os,
    certificados,
    clientes,
    comprovantes,
    dashboard,
    documentos,
    documentos_diversos,
    ferias,
    fluxo_caixa,
    funcionarios,
    manutencao,
    notificacoes,
    recebimentos,
    sst,
    usuarios,
)
from routers import os as router_os

load_dotenv()


# ---------------------------------------------------------------------------
# Logging centralizado (T4.2): nível configurável por ambiente.
# Em produção (APP_ENV=production) usa formato JSON para facilitar ingestão;
# em desenvolvimento usa texto legível.
# ---------------------------------------------------------------------------
def _configurar_logging():
    nivel = os.environ.get("LOG_LEVEL", "INFO").upper()
    nivel_valido = getattr(logging, nivel, None)
    if not isinstance(nivel_valido, int):
        nivel = "INFO"
    if os.environ.get("APP_ENV", "development") == "production":
        fmt = '{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","message":"%(message)s"}'
    else:
        fmt = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
    logging.basicConfig(
        level=nivel,
        format=fmt,
        datefmt="%Y-%m-%dT%H:%M:%S%z",
        stream=sys.stdout,
    )


_configurar_logging()

APP_ENV = os.environ.get("APP_ENV", "development")

# Falha-seguro: a documentação interativa só abre quando o ambiente foi
# EXPLICITAMENTE marcado como desenvolvimento (esquecer APP_ENV não expõe
# /docs e /openapi.json em produção).
app = FastAPI(
    title="App Munaretto Web API",
    description="Backend API para gerenciamento de clientes, contratos, férias e fluxo de caixa.",
    version="1.0.0",
    docs_url="/docs" if APP_ENV == "development" else None,
    redoc_url="/redoc" if APP_ENV == "development" else None,
    openapi_url="/openapi.json" if APP_ENV == "development" else None,
)

# Configuração de CORS: origens explícitas vindas da variável de ambiente CORS_ORIGINS.
# Exemplo: CORS_ORIGINS=http://localhost:5173,https://app.munaretto.com.br
# Não use "*" em produção quando allow_credentials=True.
_cors_origins = [
    o.strip()
    for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Total-Count"],
)


class _HeadersSeguranca(BaseHTTPMiddleware):
    """Cabeçalhos de segurança mínimos em todas as respostas (Lote 2)."""

    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        if APP_ENV == "production":
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response


app.add_middleware(_HeadersSeguranca)

# Host permitido (defesa contra host header poisoning): ativo apenas quando a
# variável TRUSTED_HOSTS é configurada (ex.: app-munaretto.onrender.com,
# localhost). Sem a variável, mantém o comportamento atual (permite todos).
_hosts_confiaveis = [h.strip() for h in os.environ.get("TRUSTED_HOSTS", "").split(",") if h.strip()]
if _hosts_confiaveis:
    from fastapi.middleware.trustedhost import TrustedHostMiddleware

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=_hosts_confiaveis)

# Inclui os roteadores da API
app.include_router(clientes.router, prefix="/api/clientes", tags=["Clientes"])
app.include_router(ferias.router, prefix="/api/ferias", tags=["Gestão de Férias"])
app.include_router(fluxo_caixa.router, prefix="/api/fluxo-caixa", tags=["Fluxo de Caixa"])
app.include_router(documentos.router, prefix="/api/documentos", tags=["Documentos"])
app.include_router(comprovantes.router, prefix="/api/comprovantes", tags=["Comprovantes"])
app.include_router(recebimentos.router, prefix="/api/recebimentos", tags=["Controle de Recebimentos"])
app.include_router(usuarios.router, prefix="/api/usuarios", tags=["Configurações / Usuários"])
app.include_router(notificacoes.router, prefix="/api/notificacoes", tags=["Notificações"])
app.include_router(funcionarios.router, prefix="/api/funcionarios", tags=["Funcionários"])
app.include_router(sst.router, prefix="/api/sst", tags=["Segurança do Trabalho (SST)"])
app.include_router(certificados.router, prefix="/api/certificados", tags=["Certificados"])
app.include_router(documentos_diversos.router, prefix="/api/sst", tags=["SST - Documentos Diversos"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(manutencao.router, prefix="/api/manutencao", tags=["Manutenção"])
# Cadastros de apoio ANTES do router principal: as rotas estáticas
# (/obras, /equipes, /produtos) precisam ser casadas antes da rota
# dinâmica /{os_id}.
app.include_router(apoio_os.router, prefix="/api/os", tags=["Controle de O.S - Cadastros"])
app.include_router(router_os.router, prefix="/api/os", tags=["Controle de O.S"])


@app.get("/health", tags=["Geral"])
def health_check():
    """Rota simples para verificar se a API está online."""
    return {"status": "online", "message": "App Munaretto API rodando com sucesso."}


if __name__ == "__main__":
    # Render/plataformas injetam a porta via variável PORT; fallback para 8000 em dev.
    porta = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=porta)
