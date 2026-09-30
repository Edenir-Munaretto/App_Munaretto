// Service worker do App Munaretto (PWA offline-first leve).
//
// VERSÃO DO CACHE: incremente `CACHE` (ex.: munaretto-v2, v3...) a cada deploy
// do frontend — o activate remove as versões antigas automaticamente.

const CACHE = 'munaretto-v5';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/logo-munaretto.png', '/boneco-munaretto.png', '/favicon.ico', '/pwa-192.png', '/pwa-512.png'];
// Orçamento do critério de aceite (abrir em ≤4s): o timeout precisa sobrar
// margem para o parse do HTML e o primeiro paint depois da resposta.
const TIMEOUT_NAVEGACAO_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Pré-cache tolerante: se um asset falhar (ex.: png temporariamente
      // ausente), os demais continuam sendo cacheados — o addAll antigo
      // derrubava o install inteiro por causa de um único arquivo.
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

function ehAssetComHash(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === self.location.origin && /^\/assets\/.+\.(js|css)$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

// Assets com hash são imutáveis: migrá-los do cache anterior ANTES de apagá-lo
// evita uma janela sem JS/CSS caso o usuário volte a ficar offline logo após a
// atualização (eles só seriam recacheados na próxima navegação com rede).
async function migrarAssetsDoCacheAntigo() {
  const nomes = (await caches.keys()).filter((key) => key !== CACHE);
  if (nomes.length === 0) return;
  const atual = await caches.open(CACHE);
  await Promise.all(nomes.map(async (nome) => {
    try {
      const antigo = await caches.open(nome);
      const requisicoes = await antigo.keys();
      await Promise.all(requisicoes
        .filter((req) => ehAssetComHash(req.url))
        .map(async (req) => {
          if (await atual.match(req)) return;
          const resposta = await antigo.match(req);
          if (resposta) await atual.put(req, resposta);
        }));
    } catch { /* migração best-effort */ } finally {
      await caches.delete(nome).catch(() => {});
    }
  }));
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    migrarAssetsDoCacheAntigo()
      .catch(() => {})
      .then(() => self.clients.claim())
  );
});

// Corrida com timeout que ABORTA a requisição: em rede móvel "lie-fi" (DNS
// responde, mas TCP/TLS trava) o fetch não rejeita sozinho e penduraria o
// respondWith para sempre — era a causa da tela branca.
function comTimeout(promessa, ms, controller) {
  let timer;
  const estouro = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Timeout de ${ms}ms`));
    }, ms);
  });
  return Promise.race([promessa, estouro]).finally(() => clearTimeout(timer));
}

function guardarNaCache(request, response) {
  if (!response.ok) return;
  const copia = response.clone();
  caches.open(CACHE).then((cache) => cache.put(request, copia)).catch(() => {});
}

// Navegação: network-first com timeout. Sucesso atualiza o cache; 5xx,
// timeout ou falha de rede caem para o shell em cache (nunca tela branca).
// 4xx (ex.: 404) é resposta legítima do servidor e volta para o navegador.
async function responderNavegacao(request) {
  const controller = new AbortController();
  try {
    const response = await comTimeout(
      fetch(request, { signal: controller.signal }),
      TIMEOUT_NAVEGACAO_MS,
      controller,
    );
    if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
    guardarNaCache(request, response);
    return response;
  } catch {
    const cached = (await caches.match(request, { ignoreSearch: true }))
      || (await caches.match('/index.html'))
      || (await caches.match('/'));
    return cached || Response.error();
  }
}

// Assets com hash são imutáveis (o index.html controla a versão): cache-first
// com revalidação em background.
async function responderAsset(request) {
  const cached = await caches.match(request);
  const daRede = fetch(request).then((response) => {
    guardarNaCache(request, response);
    return response;
  });
  if (cached) {
    daRede.catch(() => {});
    return cached;
  }
  return daRede;
}

// Demais GET (fontes, imagens, manifest): stale-while-revalidate. Cache miss
// falha normalmente — nunca devolver index.html para recurso que não é
// navegação.
async function responderStaleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const daRede = fetch(request).then((response) => {
    guardarNaCache(request, response);
    return response;
  });
  if (cached) {
    daRede.catch(() => {});
    return cached;
  }
  return daRede;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  // Requisições da API nunca são cacheadas: os dados são dinâmicos e
  // autenticados, e uma cópia antiga em cache ficaria servida por tempo
  // indeterminado durante uma queda de rede.
  if (request.url.includes('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(responderNavegacao(request));
    return;
  }

  if (ehAssetComHash(request.url)) {
    event.respondWith(responderAsset(request));
    return;
  }

  event.respondWith(responderStaleWhileRevalidate(request));
});
