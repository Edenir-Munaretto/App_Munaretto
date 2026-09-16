// Testes das opções de resiliência do apiFetch (retry automático em GET).
// Cobre: erro de rede/timeout, 5xx transitório, 4xx definitivo e a garantia de
// que métodos de escrita (POST) nunca são repetidos automaticamente.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, clearToken, enviarArquivoComProgresso, getToken, setToken } from './api';

const resposta = (status) => ({ ok: status < 400, status });

describe('apiFetch — retry automático', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('repete GET em erro de rede e devolve a resposta da tentativa que funcionou', async () => {
    const ok = resposta(200);
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(ok);

    const res = await apiFetch('http://api.teste/os', { retry: 1, retryDelay: 1 });

    expect(res).toBe(ok);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('repete GET em 5xx (instância acordando) e devolve a resposta seguinte', async () => {
    const erro = resposta(502);
    const ok = resposta(200);
    fetch.mockResolvedValueOnce(erro).mockResolvedValueOnce(ok);

    const res = await apiFetch('http://api.teste/os', { retry: 1, retryDelay: 1 });

    expect(res).toBe(ok);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('não repete em 4xx (resposta definitiva)', async () => {
    const erro = resposta(400);
    fetch.mockResolvedValueOnce(erro);

    const res = await apiFetch('http://api.teste/os', { retry: 2, retryDelay: 1 });

    expect(res).toBe(erro);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('esgota as tentativas e propaga o último erro de rede', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(apiFetch('http://api.teste/os', { retry: 1, retryDelay: 1 })).rejects.toThrow(
      'Failed to fetch'
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('nunca repete POST, mesmo com retry informado', async () => {
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(
      apiFetch('http://api.teste/os', { method: 'POST', retry: 2, retryDelay: 1 })
    ).rejects.toThrow('Failed to fetch');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sem retry informado mantém o comportamento antigo (uma única chamada)', async () => {
    const ok = resposta(200);
    fetch.mockResolvedValueOnce(ok);

    const res = await apiFetch('http://api.teste/os');

    expect(res).toBe(ok);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('enviarArquivoComProgresso — upload com progresso real', () => {
  let instancias;

  class XHRFake {
    constructor() {
      this.upload = {};
      this.headers = {};
      instancias.push(this);
    }
    open(metodo, url) { this.metodo = metodo; this.url = url; }
    setRequestHeader(nome, valor) { this.headers[nome] = valor; }
    send(body) { this.body = body; }
  }

  beforeEach(() => {
    instancias = [];
    vi.stubGlobal('XMLHttpRequest', XHRFake);
    setToken('token-de-teste');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearToken();
  });

  it('faz POST autenticado com timeout maior e resolve { ok, status, json }', async () => {
    const promessa = enviarArquivoComProgresso('http://api.teste/upload', new FormData());
    const xhr = instancias[0];

    expect(xhr.metodo).toBe('POST');
    expect(xhr.url).toBe('http://api.teste/upload');
    expect(xhr.headers.Authorization).toBe('Bearer token-de-teste');
    expect(xhr.timeout).toBe(120000);

    xhr.status = 201;
    xhr.responseText = '{"id": 7}';
    xhr.onload();

    const res = await promessa;
    expect(res.ok).toBe(true);
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ id: 7 });
  });

  it('informa o progresso do upload em porcentagem (ignora total desconhecido)', () => {
    const progressos = [];
    enviarArquivoComProgresso('http://api.teste/upload', new FormData(), {
      onProgress: (p) => progressos.push(p),
    });
    const xhr = instancias[0];

    xhr.upload.onprogress({ lengthComputable: true, loaded: 25, total: 100 });
    xhr.upload.onprogress({ lengthComputable: true, loaded: 100, total: 100 });
    xhr.upload.onprogress({ lengthComputable: false, loaded: 10, total: 0 });

    expect(progressos).toEqual([25, 100]);
  });

  it('rejeita com erro de timeout e de rede', async () => {
    const porTimeout = enviarArquivoComProgresso('http://api.teste/upload', new FormData());
    instancias[0].ontimeout();
    await expect(porTimeout).rejects.toThrow('timeout');

    const porRede = enviarArquivoComProgresso('http://api.teste/upload', new FormData());
    instancias[1].onerror();
    await expect(porRede).rejects.toThrow('network');
  });

  it('em 401 desloga e avisa o app (auth:unauthorized)', async () => {
    const avisado = vi.fn();
    window.addEventListener('auth:unauthorized', avisado);

    const promessa = enviarArquivoComProgresso('http://api.teste/upload', new FormData());
    const xhr = instancias[0];
    xhr.status = 401;
    xhr.onload();

    const res = await promessa;
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(getToken()).toBeNull();
    expect(avisado).toHaveBeenCalledTimes(1);

    window.removeEventListener('auth:unauthorized', avisado);
  });
});
