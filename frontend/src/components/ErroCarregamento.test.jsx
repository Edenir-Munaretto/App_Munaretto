// O botão "Tentar novamente" não pode repassar o evento de clique para o
// callback: as funções de recarga dos módulos aceitam parâmetros opcionais
// (ex.: `fetchComprovantes(tipo = tipoFiltro, ...)`) e o evento virava o
// primeiro argumento — gerando `tipo_documento=[object Object]` no backend.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ErroCarregamento from './ErroCarregamento';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let raiz;

function montar(componente) {
  container = document.createElement('div');
  document.body.appendChild(container);
  raiz = createRoot(container);
  act(() => {
    raiz.render(componente);
  });
}

afterEach(() => {
  act(() => {
    raiz?.unmount();
  });
  container?.remove();
  container = null;
  raiz = null;
});

describe('ErroCarregamento', () => {
  it('chama onTentarNovamente sem argumentos (não repassa o evento)', () => {
    const tentar = vi.fn();
    montar(<ErroCarregamento mensagem="Falha de conexão." onTentarNovamente={tentar} />);

    const botao = container.querySelector('button');
    expect(botao).not.toBeNull();
    act(() => {
      botao.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(tentar).toHaveBeenCalledTimes(1);
    expect(tentar).toHaveBeenCalledWith();
  });

  it('não renderiza o botão quando não há callback', () => {
    montar(<ErroCarregamento mensagem="Falha de conexão." />);
    expect(container.querySelector('button')).toBeNull();
  });
});
