// Testes do helper de descarte em massa do modal de pendências.
// Regressão: a lista plana de erros fazia o "Descartar N com erro" não
// remover nada (o loop esperava {tipo, item}).
import { describe, expect, it } from 'vitest';

import { itensDescartaveis } from './ModalPendenciasSync';

const foto = (over = {}) => ({ id_local: 'f1', status: 'erro', classificacao: null, ...over });
const operacao = (over = {}) => ({ id_local: 'o1', status: 'erro', classificacao: null, ...over });

describe('itensDescartaveis', () => {
  it('empacota fotos e operações no formato {tipo, item}', () => {
    const r = itensDescartaveis([foto()], [operacao()]);
    expect(r).toEqual([
      { tipo: 'foto', item: foto() },
      { tipo: 'operacao', item: operacao() },
    ]);
  });

  it('inclui apenas erros retryáveis (exclui pendentes e conflitos)', () => {
    const r = itensDescartaveis(
      [
        foto({ id_local: 'pendente', status: 'pendente' }),
        foto({ id_local: 'conflito', classificacao: 'conflito' }),
        foto({ id_local: 'erro-foto' }),
      ],
      [
        operacao({ id_local: 'conflito-op', classificacao: 'conflito' }),
        operacao({ id_local: 'erro-op' }),
      ],
    );
    expect(r.map(e => [e.tipo, e.item.id_local])).toEqual([
      ['foto', 'erro-foto'],
      ['operacao', 'erro-op'],
    ]);
  });

  it('tolera listas vazias, nulas ou itens inválidos', () => {
    expect(itensDescartaveis()).toEqual([]);
    expect(itensDescartaveis(null, undefined)).toEqual([]);
    expect(itensDescartaveis([null], [undefined])).toEqual([]);
  });
});
