// Testes das regras de normalização de imagem (canvas/bitmap não existem no
// jsdom, então cobrimos as decisões puras).
import { describe, expect, it } from 'vitest';

import { mimeFotoPermitido, precisaConverterFoto } from './imagem';

describe('imagem (formato aceito pelo backend)', () => {
  it('aceita apenas JPG, PNG e WEBP', () => {
    expect(mimeFotoPermitido('image/jpeg')).toBe(true);
    expect(mimeFotoPermitido('image/png')).toBe(true);
    expect(mimeFotoPermitido('image/webp')).toBe(true);
    expect(mimeFotoPermitido('image/heic')).toBe(false);
    expect(mimeFotoPermitido('application/pdf')).toBe(false);
    expect(mimeFotoPermitido(undefined)).toBe(false);
  });

  it('só dispensa o canvas para JPEG dentro do limite', () => {
    expect(precisaConverterFoto('image/jpeg', 1600, 1200)).toBe(false);
    expect(precisaConverterFoto('image/jpeg', 2400, 1200)).toBe(true);
    expect(precisaConverterFoto('image/png', 800, 600)).toBe(true);
    expect(precisaConverterFoto('image/webp', 800, 600)).toBe(true);
    expect(precisaConverterFoto('image/heic', 800, 600)).toBe(true);
  });
});
