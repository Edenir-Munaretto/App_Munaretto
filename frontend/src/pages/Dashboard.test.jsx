import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../api', () => ({
  API_URL: 'http://api.test',
  apiFetch: apiFetchMock,
}));

import Dashboard from './Dashboard';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let raiz;

const ALERTA_MARIA = {
  nome: 'Maria',
  data_limite: '01/12/2026',
  dias_restantes: 15,
  gravidade: 'warning',
  mensagem: 'Faltam 15 dias para o limite de gozo de Maria (01/12/2026).',
};

function respostaResumo(alertas) {
  return {
    ok: true,
    json: async () => ({
      funcionarios: { total: 0, ativos: 0 },
      ferias: { ativas: 0 },
      asos: {},
      cursos: {},
      alertas_ferias: alertas,
    }),
  };
}

async function montar(componente) {
  container = document.createElement('div');
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => {
    raiz.render(componente);
  });
  await act(async () => {});
}

function contarMensagem(mensagem) {
  return [...container.querySelectorAll('p')].filter((p) => p.textContent === mensagem).length;
}

beforeEach(() => {
  apiFetchMock.mockReset();
});

afterEach(() => {
  act(() => {
    raiz?.unmount();
  });
  container?.remove();
  container = null;
  raiz = null;
});

describe('Dashboard', () => {
  it('não duplica alerta presente no prop e no resumo', async () => {
    apiFetchMock.mockResolvedValue(respostaResumo([ALERTA_MARIA]));
    await montar(<Dashboard alerts={[ALERTA_MARIA]} />);

    expect(contarMensagem(ALERTA_MARIA.mensagem)).toBe(1);
    expect(container.textContent).toContain('1 Alertas');
  });

  it('exibe alerta do resumo quando o prop está vazio (fallback)', async () => {
    apiFetchMock.mockResolvedValue(respostaResumo([ALERTA_MARIA]));
    await montar(<Dashboard alerts={[]} />);

    expect(contarMensagem(ALERTA_MARIA.mensagem)).toBe(1);
    expect(container.textContent).toContain('1 Alertas');
  });

  it('mantém alertas distintos das duas fontes', async () => {
    const outro = {
      ...ALERTA_MARIA,
      nome: 'João',
      mensagem: 'URGENTE: João precisa tirar férias até 01/12/2026!',
    };
    apiFetchMock.mockResolvedValue(respostaResumo([ALERTA_MARIA]));
    await montar(<Dashboard alerts={[outro]} />);

    expect(container.textContent).toContain('2 Alertas');
    expect(contarMensagem(ALERTA_MARIA.mensagem)).toBe(1);
    expect(contarMensagem(outro.mensagem)).toBe(1);
  });
});
