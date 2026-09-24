# Plano — Corrigir tela branca do PWA em rede móvel instável

> Status: **planejado (não executado)**. Escopo aprovado: completo.
> Arquivos previstos: `frontend/public/sw.js`, `frontend/index.html`,
> `frontend/src/main.jsx`, `frontend/src/sw.test.js` (novo).
> Sem mudanças de backend/banco.

## 1. Contexto e diagnóstico

**Sintoma:** ao abrir o aplicativo (PWA) com os dados móveis ligados, a tela
ficava branca; as tentativas repetiam o problema. Ao desligar os dados móveis,
o app abriu perfeitamente.

**Causa principal:** o service worker (`frontend/public/sw.js:34-46`) faz
`fetch` **network-first sem timeout** para a navegação:

```js
fetch(event.request)        // pode ficar pendurado em rede móvel
  .catch(() => caches.match(...))
```

Em rede móvel ruim ("lie-fi": DNS responde, mas TCP/TLS trava — sinal fraco,
portal cativo, operadora), o `fetch` **não rejeita** e fica pendurado por
dezenas de segundos/minutos. Como `respondWith` segura a resposta do
documento, o navegador permanece em **tela branca**. Ao desligar os dados
móveis, o fetch falha imediatamente (`ERR_INTERNET_DISCONNECTED`) → cai no
`.catch` → serve `/index.html`/assets do cache do SW → o app abre.

**Fatores secundários:**

- `frontend/index.html:16-18`: Google Fonts via `<link rel="stylesheet">`
  **render-blocking** — em rede travada, o primeiro paint também espera.
  Sem dados, a falha é rápida e o app usa a fonte do sistema.
- O overlay global de erros (`frontend/src/main.jsx:109-113`) e o
  ErrorBoundary (`frontend/src/App.jsx:75-112`) não aparecem porque o problema
  ocorre **antes do React montar**.
- As chamadas de API têm timeout de 30s (`frontend/src/api.js:119`) e não
  bloqueiam a renderização — não são a causa da tela branca.

**Evidências que sustentam o diagnóstico:**

- App é PWA standalone (`frontend/public/manifest.webmanifest:8`).
- SW registrado apenas em produção (`frontend/src/main.jsx:121`).
- SW intercepta **todos** os GET, exceto `/api/` (`frontend/public/sw.js:29-33`),
  incluindo a navegação e as fontes do Google.
- Para navegação não há cache-first nem timeout: é network-first puro.

## 2. Escopo da correção

### 2.1 `frontend/public/sw.js` (correção principal)

- Bump do cache: `munaretto-v4` → `munaretto-v5` (o `activate` remove as
  versões antigas).
- Helper `comTimeout(promise, ms)` (corrida com `setTimeout` + `clearTimeout`).
- Reescrever o handler `fetch` por classe de requisição:
  - **Navegação** (`request.mode === 'navigate'`): `fetch` com timeout de
    ~3,5s; sucesso → responde e atualiza o cache; timeout/erro →
    `caches.match(request, { ignoreSearch: true })` →
    `caches.match('/index.html')` → `caches.match('/')` → `Response.error()`.
  - **Assets com hash** (`/assets/*.js|css`): cache-first + revalidação em
    background (imutáveis; o `index.html` controla a versão).
  - **Demais GET** (fontes, imagens, manifest): stale-while-revalidate;
    cache miss → falha normal (nunca devolver `index.html` para recurso que
    não é navegação).
  - Sempre clonar a resposta antes de `cache.put`; só cachear `response.ok`.
- Manter `install`/`activate`, `skipWaiting()` e `clients.claim()` existentes.
- Garantir que o `respondWith` sempre resolva um `Response` válido.

### 2.2 `frontend/index.html` (fonte não bloqueante)

- Trocar o stylesheet do Google Fonts por carregamento assíncrono:
  `rel="preconnect"` (manter) + `rel="preload" as="style"` +
  `onload="this.rel='stylesheet'"`, com fallback `<noscript>`.
- Fallback natural para a fonte do sistema quando a rede falhar.

### 2.3 Anti-tela-branca (recomendado e aprovado)

- Placeholder dentro do `<div id="root">` ("Carregando…", com estilo inline) —
  o React o substitui ao montar.
- Watchdog no `frontend/src/main.jsx`: após ~10s, se o app não montou, exibir
  aviso com botão **"Limpar dados e recarregar"**, reaproveitando
  `limparDadosLocais()` (já existe em `main.jsx:14`).

### 2.4 Testes

- **SW** (novo `frontend/src/sw.test.js`): importar `public/sw.js` com
  `self`/`fetch`/`caches` mockados, capturar listeners e validar:
  - navegação com fetch pendurado → após o timeout serve o `/index.html` do
    cache;
  - navegação 200 → responde e atualiza o cache;
  - asset `/assets/x.js` → serve do cache sem esperar a rede.
- **Rodar:** `npm run lint`, `npm test`, `npm run build`.
- Não há mudanças de backend/banco.

## 3. Verificação manual (obrigatória)

- DevTools → Network: modo **Offline** e **Slow 3G** com latência/blocking
  para simular lie-fi; abrir o PWA e confirmar render ≤4s vindo do cache.
- Application → Service Workers: confirmar SW novo ativo e cache
  `munaretto-v5`.
- Aparelho real: abrir com dados móveis fracos (deve abrir) e depois sem dados
  (deve abrir offline).

## 4. Deploy e operação

- Deploy do frontend (Vercel).
- Usuários precisam abrir o app **uma vez com rede boa** para instalar o novo
  SW.
- Sem mudanças de backend/banco.

## 5. Riscos

- SW mal atualizado pode servir `index.html` antigo — mitigado pelo bump do
  cache e por navegação network-first com timeout + fallback de cache.
- Assets com hash em cache-first são seguros: o `index.html` controla a versão.
- O placeholder não pode atrapalhar o React StrictMode (o React substitui o
  conteúdo do root ao montar).

## 6. Critérios de aceite

- (a) Com rede "lie-fi" simulada, o app abre do cache em ≤4s (sem tela
  branca).
- (b) Com dados móveis ligados e rede boa, abre normalmente e atualiza os
  caches.
- (c) Offline total: abre o shell e o Modo Campo continua funcionando.
