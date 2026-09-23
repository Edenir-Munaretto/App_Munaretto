// Testes do semáforo de execução da O.S (contagem por dia de calendário).
import { afterEach, describe, expect, it, vi } from 'vitest';

import { situacaoExecucao } from './OrdensServico';

const os = (over = {}) => ({ status: 'aberta', prazo_entrega: '2026-09-23', ...over });

/** Congela o relógio em 23/09/2026 10:00 (horário local). */
function agoraDeTeste() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 23, 10, 0, 0));
}

describe('situacaoExecucao', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('marca "Executa hoje" no dia do prazo, independentemente da hora', () => {
    agoraDeTeste();
    expect(situacaoExecucao(os()).label).toBe('Executa hoje');
  });

  it('conta 1d para amanhã e 3d no limite âmbar', () => {
    agoraDeTeste();
    expect(situacaoExecucao(os({ prazo_entrega: '2026-09-24' }))).toMatchObject({
      label: 'Executa em 1d',
      urgente: false,
      classe: expect.stringContaining('amber'),
    });
    expect(situacaoExecucao(os({ prazo_entrega: '2026-09-26' }))).toMatchObject({
      label: 'Executa em 3d',
      urgente: false,
      classe: expect.stringContaining('amber'),
    });
  });

  it('acima de 3 dias fica neutro', () => {
    agoraDeTeste();
    expect(situacaoExecucao(os({ prazo_entrega: '2026-09-27' }))).toMatchObject({
      label: 'Executa em 4d',
      urgente: false,
      classe: expect.stringContaining('slate'),
    });
  });

  it('prazo de ontem fica atrasado em 1d (não cai em "hoje")', () => {
    agoraDeTeste();
    expect(situacaoExecucao(os({ prazo_entrega: '2026-09-22' }))).toMatchObject({
      label: 'Execução atrasada (1d)',
      urgente: true,
      classe: expect.stringContaining('rose'),
    });
  });

  it('não gera badge para O.S encerrada, sem prazo ou prazo inválido', () => {
    expect(situacaoExecucao(os({ status: 'concluida' }))).toBeNull();
    expect(situacaoExecucao(os({ status: 'cancelada' }))).toBeNull();
    expect(situacaoExecucao(os({ prazo_entrega: null }))).toBeNull();
    expect(situacaoExecucao(os({ prazo_entrega: '2026-09' }))).toBeNull();
  });
});
