// Testes do domínio offline do Modo Campo (merge/poda do pacote, resumo do
// checklist, dono do pacote e cache de fotos).
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  API_URL: 'http://api.teste/api',
  apiFetch: vi.fn(),
  erroDaResposta: (_dados, fallback) => fallback,
}));

import { apiFetch } from '../api';
import { dbGet, dbPut, limparTudoLocal } from './db';
import {
  atualizarPacoteCampo,
  cachearFotosChecklist,
  donoPacote,
  recalcularResumo,
  salvarDonoPacote,
} from './offline';

const resposta = (json) => ({ ok: true, json: async () => json });

/** Simula o servidor para os endpoints usados pelo pacote de campo. */
function servidor({ lista = [], detalhes = {}, checklists = {}, produtos = [] } = {}) {
  apiFetch.mockImplementation(async (url) => {
    const alvo = String(url);
    if (alvo.includes('/os/?limit=')) return resposta(lista);
    if (alvo.includes('/os/produtos')) return resposta(produtos);
    const chk = alvo.match(/\/os\/(\d+)\/checklist$/);
    if (chk) return resposta(checklists[Number(chk[1])] ?? { itens: [], resumo: { total: 0, respondidos: 0 } });
    const det = alvo.match(/\/os\/(\d+)$/);
    if (det) return resposta(detalhes[Number(det[1])] ?? { id: Number(det[1]), status: 'aberta' });
    return { ok: false, json: async () => null };
  });
}

describe('recalcularResumo', () => {
  it('conta apenas respostas válidas (sim/nao/na) e preserva os nomes dos grupos', () => {
    const itens = [
      { id: 1, grupo: 1, resposta: { resposta: 'sim' } },
      { id: 2, grupo: 1, resposta: null },
      { id: 3, grupo: 2, resposta: { resposta: 'na' } },
      { id: 4, grupo: 2, resposta: { resposta: '' } }, // inválida não conta
    ];
    const r = recalcularResumo(itens, {
      grupos: [{ grupo: 1, nome: 'Preparação' }, { grupo: 2, nome: 'Chegada' }],
    });
    expect(r.total).toBe(4);
    expect(r.respondidos).toBe(2);
    expect(r.completo).toBe(false);
    expect(r.inicio_liberado).toBe(false);
    expect(r.grupos[0]).toMatchObject({ grupo: 1, nome: 'Preparação', total: 2, respondidos: 1, completo: false });
    expect(r.grupos[1]).toMatchObject({ grupo: 2, total: 2, respondidos: 1, completo: false });
  });

  it('libera o início quando o grupo 1 está completo', () => {
    const r = recalcularResumo([{ id: 1, grupo: 1, resposta: { resposta: 'sim' } }]);
    expect(r.inicio_liberado).toBe(true);
    expect(r.completo).toBe(true);
  });
});

describe('atualizarPacoteCampo', () => {
  beforeEach(async () => {
    await limparTudoLocal();
    apiFetch.mockReset();
  });

  it('adiciona O.S novas com detalhe e checklist', async () => {
    servidor({
      lista: [{ id: 1, codigo: 'OS-1', status: 'aberta' }],
      detalhes: { 1: { id: 1, codigo: 'OS-1', status: 'aberta' } },
      checklists: { 1: { itens: [{ id: 10, grupo: 1 }], resumo: { total: 1, respondidos: 0 } } },
    });
    const r = await atualizarPacoteCampo();
    expect(r.novas).toBe(1);
    expect(await dbGet('os_lista', 1)).toMatchObject({ id: 1, status: 'aberta' });
    expect(await dbGet('os', 1)).toMatchObject({ id: 1 });
    expect(await dbGet('checklist', 1)).toMatchObject({ itens: [{ id: 10, grupo: 1 }] });
  });

  it('atualiza existentes sem pendência e protege as com pendência local', async () => {
    await dbPut('os_lista', { id: 1, os_id: 1, codigo: 'OS-1', status: 'aberta' });
    await dbPut('os', { id: 1, os_id: 1, codigo: 'OS-1', status: 'aberta' });
    await dbPut('os_lista', { id: 2, os_id: 2, codigo: 'OS-2', status: 'aberta' });
    await dbPut('os', { id: 2, os_id: 2, codigo: 'OS-2', status: 'aberta' });
    // O.S 2 tem operação pendente: o estado otimista não pode ser sobrescrito.
    await dbPut('fila', { id_local: 'op-1', os_id: 2, tipo: 'status', payload: {}, status: 'pendente' });

    servidor({
      lista: [{ id: 1, codigo: 'OS-1', status: 'em_andamento' }, { id: 2, codigo: 'OS-2', status: 'em_andamento' }],
      detalhes: { 1: { id: 1, status: 'em_andamento' }, 2: { id: 2, status: 'em_andamento' } },
      checklists: {
        1: { itens: [], resumo: { total: 0, respondidos: 0 } },
        2: { itens: [], resumo: { total: 0, respondidos: 0 } },
      },
    });
    const r = await atualizarPacoteCampo();
    expect(r.atualizadas).toBe(1);
    expect((await dbGet('os_lista', 1)).status).toBe('em_andamento');
    expect((await dbGet('os_lista', 2)).status).toBe('aberta'); // protegida
    expect((await dbGet('os', 2)).status).toBe('aberta');
  });

  it('poda O.S que saíram da lista ativa e não têm pendência', async () => {
    await dbPut('os_lista', { id: 5, os_id: 5, codigo: 'OS-5', status: 'aberta' });
    await dbPut('os', { id: 5, os_id: 5, codigo: 'OS-5' });
    await dbPut('checklist', { os_id: 5, itens: [], resumo: {} });
    await dbPut('os_lista', { id: 6, os_id: 6, codigo: 'OS-6', status: 'aberta' });
    await dbPut('fila', { id_local: 'op-6', os_id: 6, tipo: 'status', payload: {}, status: 'pendente' });

    servidor({ lista: [] });
    const r = await atualizarPacoteCampo();
    expect(r.removidas).toBe(1);
    expect(await dbGet('os_lista', 5)).toBeUndefined();
    expect(await dbGet('os_lista', 6)).toMatchObject({ id: 6 }); // pendente não poda
  });
});

describe('dono do pacote', () => {
  beforeEach(async () => { await limparTudoLocal(); });

  it('salva e lê o usuário dono do pacote', async () => {
    await salvarDonoPacote({ id: 7, email: 'campo@x.com', nome: 'Campo' });
    expect(await donoPacote()).toMatchObject({
      usuario_id: 7,
      usuario_email: 'campo@x.com',
      usuario_nome: 'Campo',
    });
  });
});

describe('cachearFotosChecklist', () => {
  beforeEach(async () => {
    await limparTudoLocal();
    apiFetch.mockReset();
  });

  it('baixa e guarda a foto do item e não rebaixa o que já está em cache', async () => {
    apiFetch.mockImplementation(async (url) => {
      if (String(url).includes('/fotos/10/arquivo')) {
        return { ok: true, blob: async () => new Blob(['x'], { type: 'image/jpeg' }) };
      }
      return { ok: false, json: async () => null };
    });
    await cachearFotosChecklist(1, [{ id: 10, fotos: [{ id: 10, mime_type: 'image/jpeg' }] }]);
    expect(await dbGet('fotos_cache', 10)).toMatchObject({ id: 10, os_id: 1, mime_type: 'image/jpeg' });

    const chamadas = apiFetch.mock.calls.length;
    await cachearFotosChecklist(1, [{ id: 10, fotos: [{ id: 10, mime_type: 'image/jpeg' }] }]);
    expect(apiFetch.mock.calls.length).toBe(chamadas);
  });
});
