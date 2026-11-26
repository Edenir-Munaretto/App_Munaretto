import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../api', () => ({
  API_URL: 'http://api.test',
  apiFetch: apiFetchMock,
  erroDaResposta: (dados, padrao) => dados?.detail || padrao,
}));

import Inspecoes from './Inspecoes';
import { limparTudoLocal } from '../offline/db';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const resposta = (json) => ({ ok: true, status: 200, json: async () => json });

describe('Inspecoes', () => {
  let container;
  let root;

  beforeEach(async () => {
    await limparTudoLocal();
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(async (url) => {
      if (String(url).endsWith('/inspecoes/opcoes')) {
        return resposta({
          atividades: [{ id: 1, nome: 'Segurança', ativo: true }],
          modelos: [
            {
              id: 1,
              atividade_id: 1,
              nome: 'Inspeção de Segurança',
              ativo: true,
              itens: [
                {
                  id: 11,
                  grupo_ordem: 1,
                  grupo_nome: 'Verificações',
                  ordem: 1,
                  classificacao: '1.1',
                  pergunta: 'EPIs conferidos?',
                  exige_foto: false,
                },
              ],
            },
          ],
          obras: [],
          funcionarios: [],
          equipes: [],
        });
      }
      if (String(url).endsWith('/inspecoes/')) return resposta([]);
      return resposta({});
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('renderiza a lista e o formulário de nova inspeção', async () => {
    await act(async () => {
      root.render(
        <Inspecoes
          usuarioAtual={{ id: 7, nome: 'Técnico', permissoes: ['inspecoes'] }}
        />,
      );
    });
    for (let i = 0; i < 20 && container.textContent.includes('Carregando inspeções'); i += 1) {
      // Cada espera em um act próprio permite o React processar o estado
      // assíncrono (IndexedDB + apiFetch).
      await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
    }

    expect(container.textContent).toContain('Inspeções');
    expect(container.textContent).toContain('Nova Inspeção');
    expect(container.textContent).toContain('Nenhuma inspeção encontrada');
  });
});
