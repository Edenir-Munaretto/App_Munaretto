import { describe, expect, it } from 'vitest';
import { calcularValorLiquido, precisaAjusteManualLiquido, somarTotais } from './comprovantes';

describe('calcularValorLiquido', () => {
  it('desconta INSS e ISS do valor total', () => {
    expect(calcularValorLiquido(5000, 550, 250)).toBe(4200);
  });

  it('aceita valores no padrão brasileiro', () => {
    expect(calcularValorLiquido('5.000,00', '550,00', '250,00')).toBe(4200);
  });

  it('trata campos vazios como zero', () => {
    expect(calcularValorLiquido('', null, undefined)).toBe(0);
  });
});

describe('precisaAjusteManualLiquido', () => {
  it('não marca manual quando o líquido gravado é igual à fórmula', () => {
    expect(precisaAjusteManualLiquido(4200, 5000, 550, 250)).toBe(false);
  });

  it('marca manual quando o líquido gravado diverge da fórmula', () => {
    expect(precisaAjusteManualLiquido(4000, 5000, 550, 250)).toBe(true);
  });

  it('marca manual quando o líquido gravado é zero e a fórmula não', () => {
    expect(precisaAjusteManualLiquido(0, 5000, 550, 250)).toBe(true);
  });

  it('não marca manual quando ambos são zero', () => {
    expect(precisaAjusteManualLiquido(null, 0, 0, 0)).toBe(false);
  });
});

describe('somarTotais', () => {
  it('soma valor total, base, impostos e líquido', () => {
    const totais = somarTotais([
      {
        valor_total: 5000,
        base_calculo: 5000,
        valor_inss: 550,
        valor_iss: 250,
        valor_liquido: 4200,
        valor_pago: 0,
        valor_juros: 0,
      },
      {
        valor_total: 1000.5,
        base_calculo: 1000.5,
        valor_inss: 100,
        valor_iss: 50,
        valor_liquido: 850.5,
        valor_pago: 850.5,
        valor_juros: 10,
      },
    ]);

    expect(totais).toEqual({
      valor_total: 6000.5,
      base_calculo: 6000.5,
      valor_inss: 650,
      valor_iss: 300,
      valor_liquido: 5050.5,
      valor_pago: 850.5,
      valor_juros: 10,
    });
  });

  it('ignora campos nulos ou ausentes', () => {
    const totais = somarTotais([
      { valor_total: 100, valor_liquido: null },
      { valor_total: 50 },
    ]);

    expect(totais.valor_total).toBe(150);
    expect(totais.valor_liquido).toBe(0);
    expect(totais.valor_inss).toBe(0);
  });
});
