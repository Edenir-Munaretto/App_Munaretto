# Como contribuir

Obrigado por contribuir com o App Munaretto. Este guia cobre o fluxo de trabalho e o checklist antes de abrir um PR.

## Preparando o ambiente

Siga o [README.md](README.md) (backend e frontend rodando localmente). Resumo:

```bash
# backend
cd backend
cp .env.example .env    # Windows: Copy-Item .env.example .env
pip install -r requirements.txt

# frontend
cd ../frontend
npm install
cp .env.example .env.local
```

## Fluxo de trabalho

1. Crie uma branch a partir da `main`: `git checkout -b ajuste-filtro-os`.
2. Faça mudanças pequenas e focadas (um assunto por PR).
3. Commits em português, curtos e no imperativo, como no histórico do repositório:
   - `corrige filtro de data na listagem de O.S`
   - `ajusta textos do modo campo`
   - Evite commits gigantes ou mensagens genéricas ("ajustes").
4. Abra o PR descrevendo **o quê** e **por quê**; anexe evidência (print/log/teste) quando for mudança visual.

## Checklist antes do PR

Backend (dentro de `backend/`):

```bash
ruff check <arquivos alterados>   # ex.: ruff check routers/os.py
pytest
```

> O backend ainda tem violações antigas de lint/formatação fora do escopo das
> mudanças atuais. Rode o `ruff` nos arquivos que você alterou — evite
> reformatar arquivos inteiros junto com uma correção (diff gigante e difícil
> de revisar).

Frontend (dentro de `frontend/`):

```bash
npm run lint
npm test
npm run build
```

- Não há CI configurado: o PR só é aprovado com esses comandos passando.
- Corrija avisos do lint em vez de silenciá-los; não use `--no-verify`.

## Adicionando um módulo/feature

- **Backend:** crie o router em `backend/routers/`, inclua em `backend/main.py` e proteja as rotas com `Depends(require_permissao("modulo"))` (ver `backend/auth.py`).
- **Frontend:** crie a página em `src/pages/`, registre o id do módulo em `src/modules.js` (menu e permissão) e use sempre `apiFetch` (`src/api.js`) — nunca `fetch` direto na API.
- **Banco:** toda mudança de schema vai em `backend/schema.sql` (comandos **idempotentes**) e deve ser rodada também no Supabase.
- **Permissões:** valide no servidor (fonte da verdade) e reflita no menu do frontend.
- **Offline/Modo Campo:** ao mexer em O.S, leia [docs/DIAGRAMA_OS.md](docs/DIAGRAMA_OS.md) e as revisões em [docs/decisoes/](docs/decisoes/).

## Segurança

- Nunca comite `.env`, tokens, chaves ou dados de clientes (PII).
- A chave `service_role` do Supabase existe **somente** no backend; nunca a exponha no frontend.
- Não registre dados sensíveis em log; mensagens de erro para o usuário não devem vazar detalhes internos.
- Uploads/arquivos: valide tipo/tamanho e mantenha o bucket do B2 privado (acesso via proxy autenticado).

## Documentação

- Mudou comportamento, arquitetura ou um fluxo complexo? Atualize o documento correspondente **no mesmo PR**: `README.md`, `docs/ARQUITETURA.md`, `docs/DIAGRAMA_OS.md` ou um registro em `docs/decisoes/` (com status no topo).
- Comentários no código: em português, explicando o **porquê** (decisão, corrida, exceção), sem repetir o óbvio.

## Deploy (após o merge)

- Frontend (Vercel) e backend (Render) publicam a partir da `main`.
- Se o `schema.sql` mudou, rode-o no SQL Editor do Supabase.
- O PWA só troca a versão do service worker quando o app é aberto uma vez com internet; veja [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md).
