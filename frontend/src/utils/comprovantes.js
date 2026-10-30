import { parseDecimalBR } from './numeros';

export const CAMPOS_TOTAIS = [
  'valor_total',
  'base_calculo',
  'valor_inss',
  'valor_iss',
  'valor_liquido',
  'valor_pago',
  'valor_juros',
];

export function calcularValorLiquido(valorTotal, valorInss, valorIss) {
  const total = parseDecimalBR(valorTotal);
  const inss = parseDecimalBR(valorInss);
  const iss = parseDecimalBR(valorIss);
  return Math.round((total - inss - iss) * 100) / 100;
}

export function precisaAjusteManualLiquido(valorLiquido, valorTotal, valorInss, valorIss) {
  const informado = Number(valorLiquido) || 0;
  return Math.abs(informado - calcularValorLiquido(valorTotal, valorInss, valorIss)) > 0.005;
}

export function somarTotais(itens) {
  const totais = Object.fromEntries(CAMPOS_TOTAIS.map((campo) => [campo, 0]));

  for (const item of itens) {
    for (const campo of CAMPOS_TOTAIS) {
      const valor = Number(item[campo]);
      if (Number.isFinite(valor)) {
        totais[campo] = Math.round((totais[campo] + valor) * 100) / 100;
      }
    }
  }

  return totais;
}
