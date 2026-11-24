import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../api', () => ({
  API_URL: 'http://api.test',
  apiFetch: apiFetchMock,
  erroDaResposta: (dados, padrao) => dados?.detail || padrao,
}));

import MateriaisPorCliente from './MateriaisPorCliente';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MATERIAIS_INICIAIS = [
  { id: 1, cliente_nome: 'MARIA SILVA', categoria: 'cabo', quantidade: 10, descricao: 'CABO A' },
  { id: 2, cliente_nome: 'MARIA SILVA', categoria: 'poste', quantidade: 2, descricao: 'POSTE B' },
  { id: 3, cliente_nome: 'JOAO SOUZA', categoria: 'trafo', quantidade: 1, descricao: 'TRAFO C' },
];

const CLIENTES = [
  { id: 1, nome: 'MARIA SILVA', cpf_cnpj: '111', cidade: 'Cidade X' },
  { id: 2, nome: 'JOAO SOUZA', cpf_cnpj: '222', cidade: 'Cidade Y' },
  { id: 3, nome: 'MARIANA COSTA', cpf_cnpj: '333', cidade: 'Cidade Z' },
];

let container;
let raiz;
let materiaisServidor;

beforeEach(() => {
  materiaisServidor = MATERIAIS_INICIAIS.map((material) => ({ ...material }));
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation(async (url, options = {}) => {
    if (url.endsWith('/clientes/')) {
      return { ok: true, status: 200, json: async () => CLIENTES };
    }
    if (url.includes('/materiais/?cliente_nome=')) {
      const nome = decodeURIComponent(url.split('cliente_nome=')[1]);
      const antes = materiaisServidor.length;
      materiaisServidor = materiaisServidor.filter((material) => material.cliente_nome !== nome);
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, excluidos: antes - materiaisServidor.length }),
      };
    }
    if (url.endsWith('/materiais/') && (options.method || 'GET') === 'GET') {
      return { ok: true, status: 200, json: async () => materiaisServidor };
    }
    throw new Error(`Chamada inesperada: ${options.method || 'GET'} ${url}`);
  });
});

afterEach(() => {
  act(() => {
    raiz?.unmount();
  });
  container?.remove();
  container = null;
  raiz = null;
});

async function montar() {
  container = document.createElement('div');
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => {
    raiz.render(<MateriaisPorCliente usuarioAtual={{ permissoes: ['materiais', 'clientes'] }} />);
  });
  await act(async () => {});
}

async function clicar(elemento) {
  await act(async () => {
    elemento.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('MateriaisPorCliente', () => {
  it('filtra as sugestões de cliente enquanto digita e preenche o nome escolhido', async () => {
    await montar();

    const botaoNovo = [...container.querySelectorAll('button')]
      .find((botao) => botao.textContent.includes('Novo material'));
    await clicar(botaoNovo);

    const input = container.querySelector('#material-cliente');
    const listaAntes = input.parentElement.querySelector('ul');
    expect(listaAntes).toBeNull();

    const definirValor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    await act(async () => {
      definirValor.call(input, 'mari');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const lista = input.parentElement.querySelector('ul');
    expect(lista).not.toBeNull();
    const opcoes = [...lista.querySelectorAll('button')].map((botao) => botao.textContent);
    expect(opcoes.some((texto) => texto.includes('MARIA SILVA'))).toBe(true);
    expect(opcoes.some((texto) => texto.includes('MARIANA COSTA'))).toBe(true);
    expect(opcoes.some((texto) => texto.includes('JOAO SOUZA'))).toBe(false);

    const opcaoMariana = [...lista.querySelectorAll('button')]
      .find((botao) => botao.textContent.includes('MARIANA COSTA'));
    await act(async () => {
      opcaoMariana.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });

    expect(input.value).toBe('MARIANA COSTA');
    expect(input.parentElement.querySelector('ul')).toBeNull();
  });

  it('exclui o cliente e todos os materiais do grupo após confirmação', async () => {
    await montar();

    const botaoExcluirCliente = container.querySelector('[title="Excluir o cliente MARIA SILVA e todos os materiais"]');
    expect(botaoExcluirCliente).not.toBeNull();
    await clicar(botaoExcluirCliente);

    expect(container.textContent).toContain('Excluir cliente');
    expect(container.textContent).toContain('2 materiais lançados');
    expect(container.textContent).toContain('O cadastro em Clientes não será alterado.');

    const botaoConfirmar = [...container.querySelectorAll('button')]
      .find((botao) => botao.textContent.trim() === 'Excluir');
    await clicar(botaoConfirmar);
    await act(async () => {});

    const chamadaDelete = apiFetchMock.mock.calls.find(([, opcoes]) => opcoes?.method === 'DELETE');
    expect(chamadaDelete?.[0]).toBe('http://api.test/materiais/?cliente_nome=MARIA%20SILVA');

    expect(container.querySelector('[title="Excluir o cliente MARIA SILVA e todos os materiais"]')).toBeNull();
    expect(container.textContent).not.toContain('CABO A');
    expect(container.textContent).not.toContain('POSTE B');
    expect(container.textContent).toContain('TRAFO C');
  });
});
