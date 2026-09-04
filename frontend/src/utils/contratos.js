// Unidade de valor por contrato/tipo de O.S — fonte única dos rótulos.
// Construção usa USC; Manutenção e Linha Viva usam ULV.
export const UNIDADE_POR_TIPO = {
  construcao: 'USC',
  manutencao: 'ULV',
  linha_viva: 'ULV',
};

export function unidadeContrato(tipo) {
  return UNIDADE_POR_TIPO[tipo] || 'USC';
}

/** Rótulo do fator do serviço: 'USC normal', 'ULV especial', etc. */
export function rotuloFator(tipo, subtipo = 'normal') {
  const unidade = unidadeContrato(tipo);
  return subtipo === 'especial' ? `${unidade} especial` : `${unidade} normal`;
}
