import { beforeEach, describe, expect, it, vi } from 'vitest';

const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));

vi.mock('exifr', () => ({ default: { parse }, parse }));

import { dataCapturaDaFoto } from './fotoData';

describe('dataCapturaDaFoto', () => {
  beforeEach(() => {
    parse.mockReset();
  });

  it('usa DateTimeOriginal com offset do EXIF', async () => {
    parse.mockResolvedValue({
      DateTimeOriginal: '2026:05:10 08:15:30',
      OffsetTimeOriginal: '-03:00',
    });

    await expect(dataCapturaDaFoto({ lastModified: 0 })).resolves.toBe('2026-05-10T11:15:30.000Z');
  });

  it('sem offset, interpreta no fuso local do aparelho', async () => {
    parse.mockResolvedValue({ DateTimeOriginal: '2026:05:10 08:15:30' });

    const esperado = new Date(2026, 4, 10, 8, 15, 30).toISOString();
    await expect(dataCapturaDaFoto({ lastModified: 0 })).resolves.toBe(esperado);
  });

  it('cai para lastModified quando não há EXIF', async () => {
    parse.mockResolvedValue(undefined);
    const lastModified = Date.UTC(2026, 4, 10, 11, 15, 30);

    await expect(dataCapturaDaFoto({ lastModified })).resolves.toBe(new Date(lastModified).toISOString());
  });

  it('ignora data futura do EXIF e usa lastModified', async () => {
    parse.mockResolvedValue({ DateTimeOriginal: '2999:01:01 00:00:00' });
    const lastModified = Date.UTC(2026, 4, 10, 11, 15, 30);

    await expect(dataCapturaDaFoto({ lastModified })).resolves.toBe(new Date(lastModified).toISOString());
  });

  it('nunca lança erro quando a leitura do EXIF falha', async () => {
    parse.mockRejectedValue(new Error('formato não suportado'));
    const lastModified = Date.UTC(2026, 4, 10, 11, 15, 30);

    await expect(dataCapturaDaFoto({ lastModified })).resolves.toBe(new Date(lastModified).toISOString());
  });
});
