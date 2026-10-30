import { describe, expect, it } from 'vitest';
import {
  calcularDiferencaOutrosImpostos,
  calcularOutrosIbsCbs,
  somarTotais,
  temImpostoNaoDescontado,
} from './comprovantes';

describe('calcularDiferencaOutrosImpostos', () => {
  it('calcula a diferença positiva além de INSS e ISS', () => {
    expect(
      calcularDiferencaOutrosImpostos({
        valor_total: 5000,
        valor_inss: 550,
        valor_iss: 250,
        valor_liquido: 4000,
      })
    ).toBe(200);
  });

  it('retorna negativo quando o líquido é maior que total - impostos', () => {
    expect(
      calcularDiferencaOutrosImpostos({
        valor_total: 1000,
        valor_inss: 0,
        valor_iss: 50,
        valor_liquido: 1000,
      })
    ).toBe(-50);
  });
});

describe('calcularOutrosIbsCbs', () => {
  it('mantém o valor positivo quando há outros impostos', () => {
    expect(
      calcularOutrosIbsCbs({
        valor_total: 5000,
        valor_inss: 550,
        valor_iss: 250,
        valor_liquido: 4000,
      })
    ).toBe(200);
  });

  it('zera quando a diferença é negativa', () => {
    expect(
      calcularOutrosIbsCbs({
        valor_total: 1000,
        valor_inss: 0,
        valor_iss: 50,
        valor_liquido: 1000,
      })
    ).toBe(0);
  });

  it('trata campos vazios como zero', () => {
    expect(calcularOutrosIbsCbs({})).toBe(0);
  });
});

describe('temImpostoNaoDescontado', () => {
  it('sinaliza quando o líquido é maior que total - impostos', () => {
    expect(
      temImpostoNaoDescontado({
        valor_total: 1000,
        valor_inss: 0,
        valor_iss: 50,
        valor_liquido: 1000,
      })
    ).toBe(true);
  });

  it('não sinaliza quando há outros impostos positivos', () => {
    expect(
      temImpostoNaoDescontado({
        valor_total: 5000,
        valor_inss: 550,
        valor_iss: 250,
        valor_liquido: 4000,
      })
    ).toBe(false);
  });
});

describe('somarTotais', () => {
  it('soma os campos e os outros IBS/CBS positivos', () => {
    const totais = somarTotais([
      {
        valor_total: 5000,
        base_calculo: 5000,
        valor_inss: 550,
        valor_iss: 250,
        valor_liquido: 4000,
        valor_pago: 0,
        valor_juros: 0,
      },
      {
        valor_total: 1000.5,
        base_calculo: 1000.5,
        valor_inss: 100,
        valor_iss: 50,
        valor_liquido: 800.5,
        valor_pago: 850.5,
        valor_juros: 10,
      },
    ]);

    expect(totais).toEqual({
      valor_total: 6000.5,
      base_calculo: 6000.5,
      valor_inss: 650,
      valor_iss: 300,
      valor_liquido: 4800.5,
      valor_pago: 850.5,
      valor_juros: 10,
      outros_ibs_cbs: 250,
    });
  });

  it('não deixa os outros IBS/CBS ficarem negativos', () => {
    const totais = somarTotais([
      {
        valor_total: 1000,
        valor_inss: 0,
        valor_iss: 50,
        valor_liquido: 1000,
        valor_pago: 0,
        valor_juros: 0,
      },
    ]);

    expect(totais.outros_ibs_cbs).toBe(0);
  });

  it('ignora campos nulos ou ausentes nos totais brutos', () => {
    const totais = somarTotais([
      { valor_total: 100, valor_liquido: null },
      { valor_total: 50, valor_liquido: 50 },
    ]);

    expect(totais.valor_total).toBe(150);
    expect(totais.valor_liquido).toBe(50);
    expect(totais.outros_ibs_cbs).toBe(100);
  });
});
