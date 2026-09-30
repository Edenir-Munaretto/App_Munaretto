// Testes do service worker (frontend/public/sw.js).
// Cobre a correção da tela branca: navegação network-first com timeout +
// abort do fetch pendurado em lie-fi, fallback para o shell em cache e
// cache-first para assets com hash.
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGEM = 'https://app.test';

function normalizar(req) {
  return typeof req === 'string' ? new URL(req, ORIGEM).href : req.url;
}

function respostaFalsa(corpo, { ok = true, status = 200 } = {}) {
  const resposta = {
    ok,
    status,
    corpo,
    clone: () => respostaFalsa(corpo, { ok, status }),
  };
  return resposta;
}

function criarCachesMock(iniciais = {}) {
  const armazenamento = new Map();
  Object.entries(iniciais).forEach(([url, resposta]) => {
    armazenamento.set(normalizar(url), resposta);
  });

  function buscar(req, opcoes = {}) {
    const chave = normalizar(req);
    if (armazenamento.has(chave)) return armazenamento.get(chave);
    if (opcoes.ignoreSearch) {
      const semQuery = new URL(chave);
      semQuery.search = '';
      return armazenamento.get(semQuery.href);
    }
    return undefined;
  }

  const cache = {
    put: vi.fn(async (req, resposta) => {
      armazenamento.set(normalizar(req), resposta);
    }),
    match: vi.fn(async (req, opcoes) => buscar(req, opcoes)),
  };

  return {
    open: vi.fn(async () => cache),
    match: vi.fn(async (req, opcoes) => buscar(req, opcoes)),
    keys: vi.fn(async () => ['munaretto-v5']),
    delete: vi.fn(async () => true),
    __armazenamento: armazenamento,
    __cache: cache,
  };
}

let listeners;
let cachesMock;
let fetchMock;

async function prepararSW({ cacheInicial = {}, fetch: fetchImpl } = {}) {
  listeners = new Map();
  cachesMock = criarCachesMock(cacheInicial);
  fetchMock = vi.fn(fetchImpl || (() => Promise.reject(new Error('sem rede'))));

  vi.stubGlobal('self', {
    addEventListener: vi.fn((tipo, handler) => listeners.set(tipo, handler)),
    location: { origin: ORIGEM },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  });
  vi.stubGlobal('caches', cachesMock);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('Response', { error: () => respostaFalsa(null, { ok: false, status: 0 }) });

  vi.resetModules();
  await import('../public/sw.js');
}

function disparar(request) {
  const handler = listeners.get('fetch');
  let respondida;
  handler({ request, respondWith: (promessa) => { respondida = promessa; } });
  return respondida;
}

describe('sw.js — resiliência da navegação', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('registra o handler de fetch', async () => {
    await prepararSW();
    expect(listeners.has('fetch')).toBe(true);
  });

  it('navegação pendurada: aborta o fetch no timeout e serve o shell do cache', async () => {
    vi.useFakeTimers();
    let sinal;
    await prepararSW({
      cacheInicial: { '/index.html': respostaFalsa('shell') },
      fetch: (_req, opcoes = {}) => {
        sinal = opcoes.signal;
        return new Promise((_, reject) => {
          opcoes.signal.addEventListener('abort', () => reject(new Error('Aborted')));
        });
      },
    });

    const promessa = disparar({ method: 'GET', mode: 'navigate', url: `${ORIGEM}/` });
    await vi.advanceTimersByTimeAsync(3000);
    const resposta = await promessa;

    expect(resposta.corpo).toBe('shell');
    expect(sinal.aborted).toBe(true);
  });

  it('navegação 200: responde a rede e atualiza o cache', async () => {
    await prepararSW({
      cacheInicial: { '/index.html': respostaFalsa('antigo') },
      fetch: () => Promise.resolve(respostaFalsa('novo')),
    });

    const resposta = await disparar({ method: 'GET', mode: 'navigate', url: `${ORIGEM}/` });

    expect(resposta.corpo).toBe('novo');
    await vi.waitFor(() => {
      expect(cachesMock.__cache.put).toHaveBeenCalled();
    });
    expect(cachesMock.__armazenamento.get(`${ORIGEM}/`).corpo).toBe('novo');
  });

  it('navegação 500: cai para o /index.html do cache', async () => {
    await prepararSW({
      cacheInicial: { '/index.html': respostaFalsa('shell') },
      fetch: () => Promise.resolve(respostaFalsa('erro', { ok: false, status: 500 })),
    });

    const resposta = await disparar({ method: 'GET', mode: 'navigate', url: `${ORIGEM}/qualquer` });

    expect(resposta.corpo).toBe('shell');
  });

  it('navegação sem cache e sem rede: devolve erro de rede (não branco silencioso)', async () => {
    await prepararSW();

    const resposta = await disparar({ method: 'GET', mode: 'navigate', url: `${ORIGEM}/x` });

    expect(resposta.ok).toBe(false);
    expect(resposta.status).toBe(0);
  });
});

describe('sw.js — assets com hash', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('asset em cache é servido sem esperar a rede', async () => {
    const urlAsset = `${ORIGEM}/assets/main-abc12345.js`;
    await prepararSW({
      cacheInicial: { [urlAsset]: respostaFalsa('js-cache') },
      fetch: () => new Promise(() => {}),
    });

    const resposta = await disparar({ method: 'GET', mode: 'cors', url: urlAsset });

    expect(resposta.corpo).toBe('js-cache');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('asset fora do cache propaga a falha normal de rede', async () => {
    await prepararSW();

    const promessa = disparar({
      method: 'GET',
      mode: 'cors',
      url: `${ORIGEM}/assets/main-abc12345.js`,
    });

    await expect(promessa).rejects.toThrow('sem rede');
  });
});
