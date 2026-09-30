# Plano — Corrigir tela branca do PWA em rede móvel instável (v2)

> Status: **em execução**. Escopo aprovado: completo.
> Arquivos previstos: `frontend/public/sw.js`, `frontend/index.html`,
> `frontend/src/main.jsx`, `frontend/src/App.jsx` (1 linha p/ flag de montagem),
> `frontend/src/sw.test.js` (novo). Sem mudanças de backend/banco.

## 1. Contexto e diagnóstico

**Sintoma:** ao abrir o PWA com dados móveis ligados, tela branca; repetia. Sem dados, abria.

**Causa principal:** `frontend/public/sw.js:34-46` faz `fetch` network-first **sem timeout** na navegação. Em lie-fi o fetch não rejeita e fica pendurado; `respondWith` segura o documento → tela branca. Sem dados o fetch falha rápido → `.catch` → cache do SW → abre.

**Fatores secundários:** Google Fonts render-blocking (`index.html:16-18`); erros antes do React montar não aparecem (overlay em `main.jsx:109-113`; ErrorBoundary em `App.jsx:79-116`); API com timeout de 30s (`api.js:119`) não bloqueia render.

**Evidências:** PWA standalone (`manifest.webmanifest:8`); SW só PROD (`main.jsx:121`); SW intercepta todo GET exceto `/api/` (`sw.js:29-33`); navegação sem cache-first nem timeout.

## 2. Escopo da correção

### 2.1 `frontend/public/sw.js` (correção principal)

- Bump `munaretto-v4` → `munaretto-v5`.
- Helper `comTimeout(fetchPromise, ms, controller)`:
  - usa `AbortController`; no estouro **aborta a requisição** e rejeita;
  - `clearTimeout` no `finally` (evita fetch pendurado gravando cache após o fallback).
- Handler `fetch` por classe:
  - **Navegação** (`request.mode === 'navigate'`): fetch com timeout de **3s** (orçamento ≤4s do critério de aceite) + `signal`; 2xx → responde e atualiza cache (clonar antes do `put`, só `response.ok`); **5xx, timeout ou erro de rede** → `caches.match(request, { ignoreSearch: true })` → `/index.html` → `/` → `Response.error()`; **404** → devolve a resposta da rede (não é falha de conectividade).
  - **`/assets/*.js|css`**: cache-first + revalidação em background (imutáveis). Miss → fetch normal (sem timeout; ver risco aceito em §5).
  - **Demais GET**: stale-while-revalidate; nunca devolver `index.html` para recurso que não é navegação.
- `activate`: antes de apagar caches antigos, **migrar `/assets/*.js|css`** do cache anterior para o novo (best-effort) — evita a janela sem JS/CSS se o usuário ficar offline logo após a atualização.
- Manter `install`/`activate`, `skipWaiting()`, `clients.claim()`; `respondWith` sempre resolve um `Response` válido.

### 2.2 `frontend/index.html` (fontes + watchdog)

- Fontes não bloqueantes: manter `preconnect`; trocar stylesheet por
  `rel="preload" as="style"` + `onload="this.onload=null;this.rel='stylesheet'"`,
  com `<noscript>` de fallback. Verificar no DevTools se o preload acusa
  "not used" e, se sim, adicionar `crossorigin`. Fallback natural: fonte do sistema.
- Placeholder dentro do `#root` ("Carregando…", estilo inline).
- **Watchdog inline** (script clássico no `index.html`, não módulo — cobre o caso
  de o JS nunca carregar): após 10s, se `document.documentElement.dataset.appMontado`
  não estiver setado, exibe overlay com:
  - **"Limpar dados e recarregar"** → limpeza best-effort inline
    (`localStorage`/`sessionStorage`, `serviceWorker.getRegistrations().unregister()`,
    `caches.delete`) com teto de 2s e `location.reload()`;
  - "Recarregar" simples.

### 2.3 `frontend/src/App.jsx` e `frontend/src/main.jsx`

- `App.jsx`: `useEffect(() => { document.documentElement.dataset.appMontado = '1'; document.getElementById('aviso-carregamento')?.remove(); }, [])` — sinal de montagem para o watchdog e remoção do aviso caso ele já tenha aparecido (carregamento lento).
- `main.jsx`: registrar com `{ updateViaCache: 'none' }`. O watchdog **não fica aqui**
  (não cobriria JS que nunca carrega); `limparDadosLocais()` segue só para o overlay de erros.

### 2.4 Testes — `frontend/src/sw.test.js` (novo)

- Stub **antes** do import: `vi.stubGlobal` de `caches`/`fetch`; `vi.resetModules()`;
  `await import('../public/sw.js')` (import estático é hoisted e quebraria);
  em jsdom `self === window`; capturar handlers via `addEventListener` mockado.
- Se o Vite reclamar de importar de `public/` (warning ou erro), ler com
  `fs.readFileSync` + `new Function` executando com globals mockados.
- Casos: navegação pendurada → timeout aborta o fetch e serve `/index.html` do
  cache; navegação 200 → responde e atualiza cache; navegação 500 → serve cache;
  `/assets/x.js` → cache-first sem esperar rede; miss sem cache → falha normal.
- `vi.unstubAllGlobals()`/limpar listeners entre testes.
- Rodar `npm run lint`, `npm test`, `npm run build`.

## 3. Verificação manual (obrigatória)

- DevTools → Offline/Slow 3G: PWA abre ≤4s do cache; no Network, a navegação
  aparece **cancelada/abortada** no timeout.
- Simular asset não cacheado + rede pendurada (block/latência): watchdog aparece
  em ≤10s e "Limpar dados e recarregar" recupera.
- Application → SW novo ativo e cache `munaretto-v5`.
- Aparelho real: abre com dados móveis fracos e offline.
- `curl -I https://<host>/sw.js`: conferir `Cache-Control` curto (default da Vercel
  é `max-age=0, must-revalidate`; não há `vercel.json` no repo).

## 4. Deploy e operação

- Deploy do frontend (Vercel). Usuários precisam abrir **uma vez com rede boa**
  para instalar o SW novo. Sem mudanças de backend/banco.

## 5. Riscos

- SW mal atualizado com `index.html` antigo — mitigado pelo bump de cache e
  network-first com timeout. Premissa: páginas importadas estaticamente
  (`App.jsx:25-38`), sem chunks lazy soltos.
- Cache-first em `/assets/*` é seguro (hash no nome; `index.html` controla versão).
- **Aceito:** miss de asset não cacheado em lie-fi ainda pode pendurar o JS; coberto
  pelo watchdog inline com recuperação.
- Placeholder não conflita com StrictMode (React substitui o conteúdo do root).

## 6. Critérios de aceite

- (a) Lie-fi simulada: abre do cache ≤4s (timeout 3s + parse), sem tela branca.
- (b) Rede boa: abre e atualiza caches.
- (c) Offline total: shell abre e Modo Campo funciona.
- (d) JS não carrega/asset não cacheado: watchdog aparece ≤10s e "Limpar dados e recarregar" recupera.
