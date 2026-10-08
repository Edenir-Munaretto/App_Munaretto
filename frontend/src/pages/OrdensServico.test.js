// Testes do semáforo de execução da O.S (contagem por dia de calendário).
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LIMITE_SUGESTOES_SERVICO, mensagemChecklistInicio, situacaoExecucao, sugestoesServico,
} from './OrdensServico';

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

describe('mensagemChecklistInicio', () => {
  it('cita apenas os grupos de liberação ainda pendentes (linha viva: 1 e 2)', () => {
    const resumo = {
      grupos_liberacao: [1, 2],
      grupos: [
        { grupo: 1, nome: 'Preparação', respondidos: 9, total: 9, completo: true },
        { grupo: 2, nome: 'Bloqueio e Sinalização', respondidos: 1, total: 2, completo: false },
      ],
    };
    const texto = mensagemChecklistInicio(resumo);
    expect(texto).toContain('Grupo 2 - Bloqueio e Sinalização (1/2)');
    expect(texto).not.toContain('Grupo 1');
  });

  it('usa o grupo 1 como padrão quando o resumo não informa a liberação', () => {
    const resumo = { grupos: [{ grupo: 1, nome: 'Preparação', respondidos: 0, total: 2, completo: false }] };
    expect(mensagemChecklistInicio(resumo)).toContain('Grupo 1 - Preparação (0/2)');
  });

  it('cai na mensagem genérica quando não há pendências', () => {
    expect(mensagemChecklistInicio({ grupos: [] })).toBe(
      'Preencha o checklist de início para liberar a execução.',
    );
  });
});

describe('sugestoesServico', () => {
  const produtos = [
    { id: 1, nome: 'POSTE DE CONCRETO 300daN', codigo: 'PST-01', codigo_especial: null },
    { id: 2, nome: 'Poste de madeira 11m', codigo: 'PST-02', codigo_especial: null },
    { id: 3, nome: 'POSTE DE CONCRETO 600daN', codigo: 'PST-03', codigo_especial: 'PST-03E' },
    { id: 4, nome: 'Cabo de aço', codigo: 'PST-04', codigo_especial: null },
    { id: 5, nome: 'Chave fusível', codigo: 'CHV-01', codigo_especial: 'CHV-01E' },
  ];

  it('retorna todas as correspondências (itens + total) por nome', () => {
    const catalogo = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1, nome: `POSTE ${i + 1}`, codigo: null, codigo_especial: null,
    }));
    const r = sugestoesServico(catalogo, 'poste');
    expect(r.itens).toHaveLength(20);
    expect(r.total).toBe(20);
  });

  it('limita a renderização ao teto de 100 e informa o total', () => {
    const catalogo = Array.from({ length: 250 }, (_, i) => ({
      id: i + 1, nome: `POSTE ${i + 1}`, codigo: null, codigo_especial: null,
    }));
    const r = sugestoesServico(catalogo, 'poste');
    expect(r.itens).toHaveLength(LIMITE_SUGESTOES_SERVICO);
    expect(r.total).toBe(250);
    expect(r.itens[0].id).toBe(1);
    expect(r.itens[LIMITE_SUGESTOES_SERVICO - 1].id).toBe(LIMITE_SUGESTOES_SERVICO);

    const curto = sugestoesServico(catalogo, 'poste', 10);
    expect(curto.itens).toHaveLength(10);
    expect(curto.total).toBe(250);
  });

  it('busca por nome (case-insensitive) e por código normal', () => {
    expect(sugestoesServico(produtos, 'poste').itens.map(p => p.id)).toEqual([1, 2, 3]);
    expect(sugestoesServico(produtos, 'PST-04').itens.map(p => p.id)).toEqual([4]);
  });

  it('busca também pelo código especial', () => {
    expect(sugestoesServico(produtos, 'chv-01e').itens.map(p => p.id)).toEqual([5]);
    expect(sugestoesServico(produtos, 'pst-03e').itens.map(p => p.id)).toEqual([3]);
  });

  it('ignora espaços nas bordas e retorna vazio para termo vazio', () => {
    expect(sugestoesServico(produtos, '  poste  ').itens.map(p => p.id)).toEqual([1, 2, 3]);
    expect(sugestoesServico(produtos, '   ')).toEqual({ itens: [], total: 0 });
    expect(sugestoesServico(null, 'poste')).toEqual({ itens: [], total: 0 });
  });
});
