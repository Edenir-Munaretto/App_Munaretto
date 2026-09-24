// Testes do motor de sincronização do Modo Campo: single-flight (toque
// duplo não dispara dois envios), anti-zumbi (item já removido pelo envio
// vencedor não volta para a fila) e retry automático de erros transitórios.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  API_URL: 'http://api.teste/api',
  apiFetch: vi.fn(),
  erroDaResposta: (_dados, fallback) => fallback,
}));

import { apiFetch } from '../api';
import { dbDel, dbGet, dbPut, limparTudoLocal } from './db';
import { sincronizar } from './sync';

const resposta = (json, status = 200) => ({ ok: status < 400, status, json: async () => json });

const chamadasSync = () =>
  apiFetch.mock.calls.filter((c) => String(c[0]).includes('/os/sincronizar'));

const operacao = (idLocal = 'op-1') => ({
  id_local: idLocal,
  tipo: 'checklist_resposta',
  os_id: 1,
  criado_em: '2026-09-24T10:00:00Z',
  payload: { item_id: 10, resposta: 'sim' },
  status: 'pendente',
  tentativas: 0,
});

describe('sincronizar', () => {
  beforeEach(async () => {
    await limparTudoLocal();
    apiFetch.mockReset();
  });

  it('coalesce o toque duplo em UMA sincronização', async () => {
    await dbPut('fila', operacao('op-1'));

    let liberar;
    apiFetch.mockImplementation((url) => {
      if (String(url).includes('/os/sincronizar')) {
        return new Promise((resolve) => {
          liberar = () => resolve(resposta({ resultados: [{ id_local: 'op-1', ok: true }] }));
        });
      }
      return Promise.resolve(resposta([]));
    });

    const p1 = sincronizar();
    const p2 = sincronizar();
    await vi.waitFor(() => expect(liberar).toBeTypeOf('function'));
    liberar();

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2); // mesmo resumo para os dois chamadores
    expect(chamadasSync()).toHaveLength(1);
    expect(await dbGet('fila', 'op-1')).toBeUndefined();
  });

  it('não ressuscita item que a execução vencedora já removeu (anti-zumbi)', async () => {
    await dbPut('fila', operacao('op-2'));

    let primeira = true;
    apiFetch.mockImplementation(async (url) => {
      if (String(url).includes('/os/sincronizar') && primeira) {
        primeira = false;
        // O envio vencedor apaga o item enquanto este lote está em voo.
        await dbDel('fila', 'op-2');
        return resposta({
          resultados: [
            {
              id_local: 'op-2',
              ok: false,
              status: 409,
              erro: 'Operação já está sendo processada por outra sincronização. Reenvie o lote.',
            },
          ],
        });
      }
      return resposta({ resultados: [] });
    });

    const r = await sincronizar();

    // O 409 transitório não pode recriar o item que o vencedor apagou.
    expect(await dbGet('fila', 'op-2')).toBeUndefined();
    expect(r.falhas).toHaveLength(0);
  });

  it('reenvia uma vez erros transitórios e limpa a fila', async () => {
    await dbPut('fila', operacao('op-3'));

    let tentativas = 0;
    apiFetch.mockImplementation(async (url) => {
      if (String(url).includes('/os/sincronizar')) {
        tentativas += 1;
        if (tentativas === 1) {
          return resposta({
            resultados: [
              { id_local: 'op-3', ok: false, status: 500, erro: 'Erro interno ao aplicar a operação.' },
            ],
          });
        }
        return resposta({ resultados: [{ id_local: 'op-3', ok: true }] });
      }
      return resposta({ resultados: [] });
    });

    const r = await sincronizar();
    expect(tentativas).toBe(2); // 1 tentativa + 1 retry automático
    expect(r.operacoesEnviadas).toBe(1);
    expect(r.falhas).toHaveLength(0);
    expect(await dbGet('fila', 'op-3')).toBeUndefined();
  });

  it('não faz retry quando há conflito definitivo (4xx)', async () => {
    await dbPut('fila', operacao('op-4'));

    let tentativas = 0;
    apiFetch.mockImplementation(async (url) => {
      if (String(url).includes('/os/sincronizar')) {
        tentativas += 1;
        return resposta({
          resultados: [{ id_local: 'op-4', ok: false, status: 422, erro: 'O.S encerrada.' }],
        });
      }
      return resposta({ resultados: [] });
    });

    const r = await sincronizar();
    expect(tentativas).toBe(1);
    expect(r.conflitos).toHaveLength(1);

    const item = await dbGet('fila', 'op-4');
    expect(item.status).toBe('erro');
    expect(item.classificacao).toBe('conflito');
  });
});
