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
import { dbGet, dbPut, limparTudoLocal } from '../offline/db';

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

  it('exclui no servidor e remove a cópia local da inspeção', async () => {
    const linhaServidor = {
      id: 42,
      codigo: 'INS-2026-0042',
      usuario_id: 7,
      status: 'rascunho',
      atividade_id: 1,
      atividade_nome: 'Segurança',
      modelo_id: 1,
      modelo_nome: 'Inspeção de Segurança',
      local_inspecao: 'Obra Centro',
      data_inspecao: '2026-11-26',
      inspetor_nome: 'Gestor',
      created_at: '2026-11-26T10:00:00Z',
    };
    await dbPut('insp_inspecoes', {
      id_local: 'insp-local-1',
      id_servidor: 42,
      codigo: 'INS-2026-0042',
      usuario_id: 7,
      status: 'rascunho',
      sync_estado: 'sincronizada',
      pendente_sync: false,
      sync_erro: null,
      atividade_id: 1,
      atividade_nome: 'Segurança',
      modelo_nome: 'Inspeção de Segurança',
      local_inspecao: 'Obra Centro',
      data_inspecao: '2026-11-26',
      inspetor_nome: 'Gestor',
      itens: [],
      assinantes: [],
      criado_em: '2026-11-26T10:00:00Z',
      atualizado_em: '2026-11-26T10:00:00Z',
    });

    let listaServidor = [linhaServidor];
    apiFetchMock.mockImplementation(async (url, options = {}) => {
      const alvo = String(url);
      if (alvo.endsWith('/inspecoes/opcoes')) {
        return resposta({ atividades: [], modelos: [], obras: [], funcionarios: [], equipes: [] });
      }
      if (alvo.endsWith('/inspecoes/')) return resposta(listaServidor);
      if (alvo.endsWith('/inspecoes/42') && options.method === 'DELETE') {
        listaServidor = [];
        return resposta({ success: true });
      }
      return resposta({});
    });

    await act(async () => {
      root.render(
        <Inspecoes
          usuarioAtual={{ id: 7, nome: 'Gestor', permissoes: ['inspecoes'] }}
        />,
      );
    });
    for (let i = 0; i < 20 && !container.textContent.includes('INS-2026-0042'); i += 1) {
      await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
    }
    expect(container.textContent).toContain('INS-2026-0042');

    const botaoExcluir = container.querySelector('button[title="Excluir"]');
    await act(async () => { botaoExcluir.click(); });
    const confirmar = Array.from(container.querySelectorAll('button'))
      .find((botao) => botao.textContent.trim() === 'Excluir');
    await act(async () => { confirmar.click(); });

    for (let i = 0; i < 40 && container.textContent.includes('INS-2026-0042'); i += 1) {
      await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
    }
    expect(container.textContent).not.toContain('INS-2026-0042');
    expect(await dbGet('insp_inspecoes', 'insp-local-1')).toBeUndefined();
  });
});
