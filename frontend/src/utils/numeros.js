// Parser único de números decimais no padrão brasileiro.
//
// Regras (evitam o bug de "25.000" virar 25):
//  - com vírgula: pontos são separadores de milhar ("1.234,56" -> 1234.56);
//  - sem vírgula e com vários pontos: milhares ("1.234.567" -> 1234567);
//  - um único ponto com exatamente 3 dígitos depois: milhar ("25.000" -> 25000);
//  - um único ponto com 1-2 dígitos depois: decimal ("25.5" -> 25.5);
//  - vazio/inválido -> 0.
export function parseDecimalBR(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  let str = String(value).trim().replace(/[R$\s]/g, '').replace(/[^\d.,-]/g, '');
  if (!str) return 0;

  const temVirgula = str.includes(',');
  const pontos = (str.match(/\./g) || []).length;

  if (temVirgula) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (pontos > 1) {
    str = str.replace(/\./g, '');
  } else if (pontos === 1) {
    const [inteiro, decimal] = str.split('.');
    if (decimal.length === 3 && inteiro.length > 0) {
      str = `${inteiro}${decimal}`;
    }
  }

  const num = parseFloat(str);
  return Number.isFinite(num) ? num : 0;
}
