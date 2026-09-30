# App Munaretto

Sistema web de gestão do escritório Munaretto — clientes e contratos, funcionários e férias, fluxo de caixa, documentos, contabilidade (comprovantes), recebimentos, devoluções Celesc, manutenção de veículos/equipamentos, SST e Controle de O.S com **Modo Campo** (operação offline no celular/tablet).

## Documentação

| Assunto | Documento |
|---|---|
| Arquitetura, autenticação, módulos e padrões | [docs/ARQUITETURA.md](docs/ARQUITETURA.md) |
| Fluxo completo do módulo de O.S (diagramas) | [docs/DIAGRAMA_OS.md](docs/DIAGRAMA_OS.md) |
| Índice geral e registros de decisões/planos | [docs/README.md](docs/README.md) |
| Implantação (Supabase, Render, Vercel, B2) | [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md) |
| Como contribuir | [CONTRIBUTING.md](CONTRIBUTING.md) |

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS · PWA (service worker próprio) |
| Backend | FastAPI (Python 3.11) + JWT |
| Banco | Supabase (Postgres) com RLS — acesso somente via `service_role` no backend |
| Arquivos | Backblaze B2 (bucket privado) · PDFs/DOCX com LibreOffice no container |
| Deploy | Vercel (frontend) + Render (backend via `render.yaml`/Docker) |

## Módulos

- **Dashboard** — indicadores gerais.
- **Clientes** — cadastro e histórico de documentos.
- **Funcionários** — cadastro, cargos; **Gestão de Férias**.
- **Gestão Usinas** (fluxo de caixa) — lançamentos e relatórios.
- **Documentos** — geração de contratos, declarações, recibos e propostas.
- **Contabilidade** (comprovantes) — importação de planilhas e conciliação.
- **Controle de Recebimentos**.
- **Devoluções Celesc**.
- **Manutenção** — veículos, equipamentos, reposições e documentos.
- **SST** — treinamentos, matriz, ASO, EPIs e documentos.
- **Controle de O.S** — Kanban, checklist, H.H., materiais, fotos e PDFs; **O.S (Campo)** opera offline com pacote local (IndexedDB) e sincronização.
- **Notificações** e **Configurações** (usuários, permissões e catálogos).

## Estrutura de pastas

```
backend/            API FastAPI
  routers/          endpoints por módulo (os.py, sst.py, ...)
  utils/            PDFs, modelos, checklist
  schema.sql        schema do Supabase (fonte da verdade do banco)
  tests/            pytest
frontend/           App React/Vite (PWA)
  src/pages/        telas por módulo
  src/offline/      Modo Campo (IndexedDB, fila e sincronização)
  public/sw.js      service worker
docs/               Arquitetura, diagramas, implantação e decisões
render.yaml         Blueprint do backend no Render
```

## Rodando localmente

### Backend (FastAPI)

```bash
cd backend
cp .env.example .env        # Windows: Copy-Item .env.example .env
# preencha SUPABASE_URL, SUPABASE_KEY (service_role) e JWT_SECRET
pip install -r requirements.txt
uvicorn main:app --reload
```

- API em `http://localhost:8000` · healthcheck em `/health`.
- Com `APP_ENV=development` no `.env`, o Swagger fica em `http://localhost:8000/docs` (desabilitado em produção).
- Testes: `pytest` (execute dentro de `backend/`).
- Lint/format: `ruff check .` e `ruff format .`.

### Frontend (React/Vite)

```bash
cd frontend
npm install
cp .env.example .env.local  # Windows: Copy-Item .env.example .env.local
npm run dev
```

- App em `http://localhost:5173`.
- `VITE_API_URL` deve incluir o sufixo `/api` (ex.: `http://localhost:8000/api`). **Sem essa variável, o app usa a API de produção** (`src/api.js`).
- Scripts: `npm run lint` · `npm test` (vitest) · `npm run build` · `npm run preview`.

## Segurança

- Nunca versione `.env`/segredos; a chave `service_role` do Supabase só existe no backend.
- Em produção: HTTPS obrigatório, `CORS_ORIGINS` restrito, Swagger/OpenAPI desabilitados, cabeçalhos de segurança e (opcional) `TRUSTED_HOSTS`.
- O primeiro boot cria o usuário admin (senha em `ADMIN_SENHA_INICIAL` ou em `backend/admin_inicial.txt`); troque a senha no primeiro acesso.

## Deploy

Passo a passo (Supabase, Render, Vercel e Backblaze B2) em [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md).

## Licença

MIT — ver [LICENSE](LICENSE).
