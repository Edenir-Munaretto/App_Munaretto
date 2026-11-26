import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';

import ObraAutocomplete from './ObraAutocomplete';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const OBRAS = [
  {
    id: 1,
    nome: 'PS-123',
    obra_cliente: 'Cliente Alfa',
    endereco: 'Rua A, 10',
    cidade: 'Concórdia',
  },
  {
    id: 2,
    nome: 'Obra Beta',
    clientes: { nome: 'Construtora Beta' },
    endereco: 'Rua B, 20',
    cidade: 'Chapecó',
  },
  {
    id: 3,
    nome: 'PS-999',
    cliente_celesc: 'Celesc Regional',
    endereco: 'Rua C, 30',
    cidade: 'Joaçaba',
  },
];

function Wrapper() {
  const [selecionada, setSelecionada] = useState(null);
  return (
    <div>
      <ObraAutocomplete obras={OBRAS} value={selecionada?.id || ''} onChange={setSelecionada} />
      <span data-testid="selecionada">{selecionada?.nome || ''}</span>
    </div>
  );
}

const definirValor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

async function digitar(input, texto) {
  await act(async () => {
    definirValor.call(input, texto);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ObraAutocomplete', () => {
  let container;
  let root;
  let input;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<Wrapper />);
    });
    input = container.querySelector('input');
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('filtra pelo nome/Nota PS ou cliente e preenche a obra escolhida', async () => {
    await digitar(input, 'PS-1');
    let opcoes = [...container.querySelectorAll('ul button')].map((botao) => botao.textContent);
    expect(opcoes.some((texto) => texto.includes('PS-123'))).toBe(true);
    expect(opcoes.some((texto) => texto.includes('Obra Beta'))).toBe(false);

    const opcao = [...container.querySelectorAll('ul button')]
      .find((botao) => botao.textContent.includes('PS-123'));
    await act(async () => {
      opcao.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });

    expect(container.querySelector('[data-testid="selecionada"]').textContent).toBe('PS-123');
    expect(input.value).toBe('PS-123 — Cliente Alfa');
    expect(container.querySelector('ul')).toBeNull();

    await digitar(input, 'beta');
    opcoes = [...container.querySelectorAll('ul button')].map((botao) => botao.textContent);
    expect(opcoes.some((texto) => texto.includes('Obra Beta'))).toBe(true);
    expect(opcoes.some((texto) => texto.includes('PS-123'))).toBe(false);
  });

  it('seleciona pelo teclado e limpa o vínculo ao apagar o texto', async () => {
    await digitar(input, 'Beta');
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });

    expect(container.querySelector('[data-testid="selecionada"]').textContent).toBe('Obra Beta');
    expect(input.value).toBe('Obra Beta — Construtora Beta');

    await digitar(input, '');
    expect(container.querySelector('[data-testid="selecionada"]').textContent).toBe('');
    expect(container.querySelector('ul')).toBeNull();
  });
});
