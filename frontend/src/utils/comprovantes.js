export const CAMPOS_TOTAIS = [
  'valor_total',
  'base_calculo',
  'valor_inss',
  'valor_iss',
  'valor_liquido',
  'valor_pago',
  'valor_juros',
];

export function calcularDiferencaOutrosImpostos(item) {
  const total = Number(item?.valor_total) || 0;
  const inss = Number(item?.valor_inss) || 0;
  const iss = Number(item?.valor_iss) || 0;
  const liquido = Number(item?.valor_liquido) || 0;
  return Math.round((total - inss - iss - liquido) * 100) / 100;
}

export function calcularOutrosIbsCbs(item) {
  return Math.max(0, calcularDiferencaOutrosImpostos(item));
}

export function temImpostoNaoDescontado(item) {
  return calcularDiferencaOutrosImpostos(item) < -0.005;
}

export function somarTotais(itens) {
  const totais = Object.fromEntries(CAMPOS_TOTAIS.map((campo) => [campo, 0]));
  totais.outros_ibs_cbs = 0;

  for (const item of itens) {
    for (const campo of CAMPOS_TOTAIS) {
      const valor = Number(item[campo]);
      if (Number.isFinite(valor)) {
        totais[campo] = Math.round((totais[campo] + valor) * 100) / 100;
      }
    }
    totais.outros_ibs_cbs = Math.round((totais.outros_ibs_cbs + calcularOutrosIbsCbs(item)) * 100) / 100;
  }

  return totais;
}
