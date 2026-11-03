export const CAMPOS_TOTAIS = [
  'valor_total',
  'base_calculo',
  'valor_inss',
  'valor_iss',
  'valor_liquido',
  'valor_pago',
  'valor_juros',
];

/** Remove tudo que não for dígito (CPF/CNPJ formatado ou com espaços). */
export function digitosDocumento(valor) {
  return String(valor ?? '').replace(/\D/g, '');
}

/** Pessoa física = CPF (11 dígitos). CNPJ (14) = pessoa jurídica. */
export function ehPessoaFisica(itemOuDocumento) {
  const documento = typeof itemOuDocumento === 'string'
    ? itemOuDocumento
    : itemOuDocumento?.cnpj;
  return digitosDocumento(documento).length === 11;
}

/** ISS que realmente entra na composição do valor pago (PF nunca desconta). */
export function issDescontado(item) {
  if (ehPessoaFisica(item)) return 0;
  return Number(item?.valor_iss) || 0;
}

/** ISS destacado na nota, mas sem desconto (informativo para PF). */
export function issNaoDescontado(item) {
  if (!ehPessoaFisica(item)) return 0;
  return Number(item?.valor_iss) || 0;
}

/** Diferença bruta: Total - INSS - ISS descontado - Líquido. */
export function calcularDiferencaOutrosImpostos(item) {
  const total = Number(item?.valor_total) || 0;
  const inss = Number(item?.valor_inss) || 0;
  const iss = issDescontado(item);
  const liquido = Number(item?.valor_liquido) || 0;
  return Math.round((total - inss - iss - liquido) * 100) / 100;
}

/** Outros/IBS/CBS calculado (nunca negativo). */
export function calcularOutrosIbsCbs(item) {
  return Math.max(0, calcularDiferencaOutrosImpostos(item));
}

/** Divergência que sobra depois de considerar o Outros/IBS/CBS calculado. */
export function calcularDivergencia(item) {
  const total = Number(item?.valor_total) || 0;
  const inss = Number(item?.valor_inss) || 0;
  const iss = issDescontado(item);
  const outros = calcularOutrosIbsCbs(item);
  const liquido = Number(item?.valor_liquido) || 0;
  return Math.round((total - inss - iss - outros - liquido) * 100) / 100;
}

export function temDivergencia(item) {
  return Math.abs(calcularDivergencia(item)) > 0.005;
}

/** Mantido por compatibilidade: sinaliza diferença negativa em notas PJ. */
export function temImpostoNaoDescontado(item) {
  return !ehPessoaFisica(item) && calcularDiferencaOutrosImpostos(item) < -0.005;
}

export function somarTotais(itens) {
  const totais = Object.fromEntries(CAMPOS_TOTAIS.map((campo) => [campo, 0]));
  totais.outros_ibs_cbs = 0;
  totais.iss_descontado = 0;
  totais.iss_nao_descontado = 0;
  totais.divergencia = 0;
  totais.divergencia_abs = 0;
  totais.nfs_divergentes = 0;

  for (const item of itens) {
    for (const campo of CAMPOS_TOTAIS) {
      const valor = Number(item[campo]);
      if (Number.isFinite(valor)) {
        totais[campo] = Math.round((totais[campo] + valor) * 100) / 100;
      }
    }

    totais.outros_ibs_cbs = Math.round((totais.outros_ibs_cbs + calcularOutrosIbsCbs(item)) * 100) / 100;
    totais.iss_descontado = Math.round((totais.iss_descontado + issDescontado(item)) * 100) / 100;
    totais.iss_nao_descontado = Math.round((totais.iss_nao_descontado + issNaoDescontado(item)) * 100) / 100;

    const divergencia = calcularDivergencia(item);
    totais.divergencia = Math.round((totais.divergencia + divergencia) * 100) / 100;
    totais.divergencia_abs = Math.round((totais.divergencia_abs + Math.abs(divergencia)) * 100) / 100;
    if (item?.tipo_documento === 'Nota Fiscal' && Math.abs(divergencia) > 0.005) {
      totais.nfs_divergentes += 1;
    }
  }

  return totais;
}
