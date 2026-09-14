// Testes das opções de resiliência do apiFetch (retry automático em GET).
// Cobre: erro de rede/timeout, 5xx transitório, 4xx definitivo e a garantia de
// que métodos de escrita (POST) nunca são repetidos automaticamente.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './api';

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
