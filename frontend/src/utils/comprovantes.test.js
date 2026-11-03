import { describe, expect, it } from 'vitest';
import {
  calcularDiferencaOutrosImpostos,
  calcularDivergencia,
  calcularOutrosIbsCbs,
  digitosDocumento,
  ehPessoaFisica,
  issDescontado,
  issNaoDescontado,
  somarTotais,
  temDivergencia,
  temImpostoNaoDescontado,
} from './comprovantes';

const PF = '123.456.789-00';
const PJ = '12.345.678/0001-90';

describe('ehPessoaFisica', () => {
  it('identifica CPF com 11 dígitos e CNPJ com 14', () => {
    expect(ehPessoaFisica({ cnpj: PF })).toBe(true);
    expect(ehPessoaFisica({ cnpj: PJ })).toBe(false);
    expect(ehPessoaFisica(PF)).toBe(true);
  });

  it('remove máscara e espaços antes de contar os dígitos', () => {
    expect(digitosDocumento(' 123.456.789-00 ')).toBe('12345678900');
    expect(ehPessoaFisica({ cnpj: ' 123.456.789-00 ' })).toBe(true);
    expect(ehPessoaFisica({ cnpj: '' })).toBe(false);
  });
});

describe('ISS efetivo por tipo de pessoa', () => {
  it('não desconta ISS de pessoa física, mas mantém o valor informativo', () => {
    const item = { cnpj: PF, valor_iss: 250 };
    expect(issDescontado(item)).toBe(0);
    expect(issNaoDescontado(item)).toBe(250);
  });

  it('desconta ISS de pessoa jurídica', () => {
    const item = { cnpj: PJ, valor_iss: 250 };
    expect(issDescontado(item)).toBe(250);
    expect(issNaoDescontado(item)).toBe(0);
  });
});

describe('calcularDiferencaOutrosImpostos', () => {
  it('calcula a diferença positiva além de INSS e ISS (PJ)', () => {
    expect(
      calcularDiferencaOutrosImpostos({
        cnpj: PJ,
        valor_total: 5000,
        valor_inss: 550,
        valor_iss: 250,
        valor_liquido: 4000,
      })
    ).toBe(200);
  });

  it('ignora o ISS na diferença de pessoa física', () => {
    expect(
      calcularDiferencaOutrosImpostos({
        cnpj: PF,
        valor_total: 1000,
        valor_inss: 0,
        valor_iss: 50,
        valor_liquido: 1000,
      })
    ).toBe(0);
  });

  it('mantém outros descontos reais de pessoa física', () => {
    expect(
      calcularDiferencaOutrosImpostos({
        cnpj: PF,
        valor_total: 1000,
        valor_inss: 0,
        valor_iss: 50,
        valor_liquido: 900,
      })
    ).toBe(100);
  });
});

describe('calcularOutrosIbsCbs', () => {
  it('mantém o valor positivo quando há outros impostos (PJ)', () => {
    expect(
      calcularOutrosIbsCbs({
        cnpj: PJ,
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
        cnpj: PJ,
        valor_total: 1000,
        valor_inss: 0,
        valor_iss: 50,
        valor_liquido: 1000,
      })
    ).toBe(0);
  });

  it('zera ISS não descontado de pessoa física', () => {
    expect(
      calcularOutrosIbsCbs({
        cnpj: PF,
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

describe('calcularDivergencia', () => {
  it('não acusa divergência na PF com ISS não descontado', () => {
    const item = {
      cnpj: PF,
      valor_total: 1000,
      valor_inss: 0,
      valor_iss: 50,
      valor_liquido: 1000,
    };
    expect(calcularDivergencia(item)).toBe(0);
    expect(temDivergencia(item)).toBe(false);
  });

  it('acusa divergência quando o líquido não fecha com Total - INSS - Outros', () => {
    const item = {
      cnpj: PF,
      valor_total: 1000,
      valor_inss: 0,
      valor_iss: 50,
      valor_liquido: 1009,
    };
    expect(calcularDivergencia(item)).toBe(-9);
    expect(temDivergencia(item)).toBe(true);
  });

  it('acusa divergência quando PJ não desconta o ISS', () => {
    const item = {
      cnpj: PJ,
      valor_total: 1000,
      valor_inss: 0,
      valor_iss: 50,
      valor_liquido: 1000,
    };
    expect(calcularDivergencia(item)).toBe(-50);
    expect(temDivergencia(item)).toBe(true);
  });
});

describe('temImpostoNaoDescontado (compatibilidade)', () => {
  it('sinaliza somente diferença negativa de pessoa jurídica', () => {
    const base = { valor_total: 1000, valor_inss: 0, valor_iss: 50, valor_liquido: 1000 };
    expect(temImpostoNaoDescontado({ ...base, cnpj: PJ })).toBe(true);
    expect(temImpostoNaoDescontado({ ...base, cnpj: PF })).toBe(false);
  });
});

describe('somarTotais', () => {
  it('soma os campos e separa ISS descontado de pessoa física', () => {
    const totais = somarTotais([
      {
        tipo_documento: 'Nota Fiscal',
        cnpj: PF,
        valor_total: 1000,
        base_calculo: 1000,
        valor_inss: 0,
        valor_iss: 50,
        valor_liquido: 1000,
        valor_pago: 0,
        valor_juros: 0,
      },
      {
        tipo_documento: 'Nota Fiscal',
        cnpj: PJ,
        valor_total: 5000,
        base_calculo: 5000,
        valor_inss: 550,
        valor_iss: 250,
        valor_liquido: 4000,
        valor_pago: 0,
        valor_juros: 0,
      },
    ]);

    expect(totais).toEqual({
      valor_total: 6000,
      base_calculo: 6000,
      valor_inss: 550,
      valor_iss: 300,
      valor_liquido: 5000,
      valor_pago: 0,
      valor_juros: 0,
      outros_ibs_cbs: 200,
      iss_descontado: 250,
      iss_nao_descontado: 50,
      divergencia: 0,
      divergencia_abs: 0,
      nfs_divergentes: 0,
    });
  });

  it('conta NFs com divergência', () => {
    const totais = somarTotais([
      {
        tipo_documento: 'Nota Fiscal',
        cnpj: PF,
        valor_total: 1000,
        valor_inss: 0,
        valor_iss: 50,
        valor_liquido: 1009,
        valor_pago: 0,
        valor_juros: 0,
      },
    ]);

    expect(totais.nfs_divergentes).toBe(1);
    expect(totais.divergencia).toBe(-9);
    expect(totais.divergencia_abs).toBe(9);
  });

  it('ignora campos nulos ou ausentes nos totais brutos', () => {
    const totais = somarTotais([
      { tipo_documento: 'Nota Fiscal', cnpj: PJ, valor_total: 100, valor_liquido: null, valor_iss: 0, valor_inss: 0 },
      { tipo_documento: 'Nota Fiscal', cnpj: PJ, valor_total: 50, valor_liquido: 50, valor_iss: 0, valor_inss: 0 },
    ]);

    expect(totais.valor_total).toBe(150);
    expect(totais.valor_liquido).toBe(50);
    expect(totais.outros_ibs_cbs).toBe(100);
  });
});
