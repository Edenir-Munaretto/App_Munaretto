# Implantação — App Munaretto Web

Passo a passo para colocar o sistema em produção usando camadas gratuitas: **Supabase** (banco), **Render** (backend FastAPI em Docker), **Vercel** (frontend React) e **Backblaze B2** (arquivos de certificados).

Arquitetura e detalhes técnicos: [ARQUITETURA.md](ARQUITETURA.md).

---

## 1. Supabase (banco de dados)

1. Crie um projeto em [supabase.com](https://supabase.com/) com senha forte para o banco.
2. Em **SQL Editor → New Query**, execute todo o conteúdo de [`backend/schema.sql`](../backend/schema.sql).
   - Cria tabelas, índices, gatilhos e habilita RLS (somente `service_role` acessa).
3. Guarde, em **Project Settings → API**:
   - `SUPABASE_URL` — URL do projeto;
   - `SUPABASE_KEY` — a chave **`service_role`** (a `anon` não funciona: o RLS bloqueia).
4. Sempre que o `schema.sql` mudar em um deploy, **rode novamente** no SQL Editor (os comandos são idempotentes).

> Migração de dados do app desktop antigo já foi concluída e os scripts não existem mais no repositório.

## 2. Backblaze B2 (certificados/documentos privados)

1. Crie um bucket **privado** (ex.: `munaretto-certificados`).
2. Em **App Keys**, gere uma Application Key (nunca use as credenciais mestras).
3. Anote `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_NAME` e o endpoint da região (ex.: `https://s3.us-west-004.backblazeb2.com` → `B2_ENDPOINT`, `B2_REGION=us-west-004`).

## 3. Backend no Render

O repositório já tem o Blueprint [`render.yaml`](../render.yaml):

- Tipo: **Web Service** com `env: docker`, Dockerfile `backend/Dockerfile` e contexto `./backend` (LibreOffice incluído para converter DOCX→PDF).
- Healthcheck: `/health`.
- `APP_ENV=production` (Swagger/OpenAPI desabilitados, logs em JSON, HSTS).

1. Em [render.com](https://render.com/), crie um **Blueprint** apontando para o repositório (ou um Web Service manual com as mesmas configurações).
2. Configure as variáveis de ambiente (as marcadas com `sync: false` no Blueprint devem ser preenchidas no painel):

| Variável | Descrição | Obrigatória |
|---|---|---|
| `SUPABASE_URL` | URL do projeto Supabase | Sim |
| `SUPABASE_KEY` | Chave `service_role` (nunca no frontend) | Sim |
| `JWT_SECRET` | Secret para assinar tokens (`python -c "import secrets; print(secrets.token_hex(32))"`) | Sim |
| `CORS_ORIGINS` | Origens do frontend, separadas por vírgula (ex.: `https://app-munaretto-sand.vercel.app`) | Sim |
| `B2_ENDPOINT` / `B2_KEY_ID` / `B2_APPLICATION_KEY` / `B2_BUCKET_NAME` / `B2_REGION` | Backblaze B2 | Sim p/ certificados |
| `JWT_VALIDADE_MINUTOS` | Validade do token (padrão `960` = 16 h) | Não |
| `LOG_LEVEL` | `DEBUG`/`INFO`/`WARNING`/`ERROR`/`CRITICAL` (padrão `INFO`) | Não |
| `TRUSTED_HOSTS` | Hosts aceitos contra host header poisoning (ex.: `app-munaretto.onrender.com`) | Recomendada |
| `ADMIN_SENHA_INICIAL` | Senha do admin no primeiro boot (mín. 8 chars; se vazia, vai para `backend/admin_inicial.txt`) | Não |

3. Copie a URL gerada (ex.: `https://app-munaretto-1.onrender.com`).

## 4. Frontend na Vercel

1. Em [vercel.com](https://vercel.com/), **Add New → Project** e conecte o repositório.
2. **Root Directory:** `frontend` (framework detectado: Vite).
3. Em **Environment Variables**, defina:
   - `VITE_API_URL` = URL do backend com sufixo `/api` (ex.: `https://app-munaretto-1.onrender.com/api`).
4. **Deploy**. A Vercel entrega HTTPS e o PWA fica instalável (manifest + service worker).

## 5. Pós-deploy

1. Atualize `CORS_ORIGINS` no Render com o domínio final da Vercel e faça redeploy.
2. Acesse o app, faça login com o admin e **troque a senha**; crie os usuários e permissões em **Configurações**.
3. Teste `GET /health` do backend e o Swagger local (`APP_ENV=development` + `uvicorn main:app --reload`).
4. Atualizações do PWA: o service worker só troca de versão quando o app é aberto **uma vez com internet**. Em caso de problema, o app tem recuperação ("Limpar dados e recarregar") — ver [decisoes/PLANO_FIX_TELA_BRANCA_PWA.md](decisoes/PLANO_FIX_TELA_BRANCA_PWA.md).
