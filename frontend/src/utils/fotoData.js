// Data/hora REAL da captura da foto (EXIF), independente do momento em que o
// arquivo é enviado/sincronizado. Precisa rodar ANTES de `comprimirImagem`:
// o canvas reencoda a imagem e descarta os metadados EXIF.
//
// Ordem de confiança:
//   1. DateTimeOriginal (ou CreateDate/ModifyDate) do EXIF;
//   2. lastModified do arquivo (câmera costuma gravar o horário da captura);
//   3. agora (se o arquivo não tiver nenhuma data plausível).
import exifr from 'exifr';

const TAGS_DATA = ['DateTimeOriginal', 'CreateDate', 'ModifyDate', 'OffsetTimeOriginal', 'OffsetTimeDigitized', 'OffsetTime'];
const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;

function dataPlausivel(data) {
  if (!(data instanceof Date)) return false;
  const ms = data.getTime();
  return Number.isFinite(ms) && ms > 0 && ms <= Date.now() + TOLERANCIA_FUTURO_MS;
}

// EXIF usa "AAAA:MM:DD HH:MM:SS" (sem fuso). Aceita também "-" e "T".
function converterDataExif(valor, offset) {
  if (typeof valor !== 'string') return null;
  const m = valor.trim().match(/^(\d{4})[-:](\d{2})[-:](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, ano, mes, dia, hora, minuto, segundo] = m.map(Number);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hora > 23 || minuto > 59 || segundo > 59) {
    return null;
  }
  const dataLocal = `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
    + `T${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}:${String(segundo).padStart(2, '0')}`;
  // Com OffsetTimeOriginal (ex.: "-03:00") o instante é exato; sem offset,
  // interpreta no fuso local do aparelho (mesmo fuso usado pela câmera na
  // maioria dos casos).
  const data = offset ? new Date(`${dataLocal}${offset}`) : new Date(ano, mes - 1, dia, hora, minuto, segundo);
  return Number.isNaN(data.getTime()) ? null : data;
}

function normalizarOffset(valor) {
  if (typeof valor !== 'string') return null;
  const m = valor.trim().match(/^([+-])(\d{2}):?(\d{2})/);
  return m ? `${m[1]}${m[2]}:${m[3]}` : null;
}

function fallbackArquivo(arquivo) {
  const lastModified = Number(arquivo?.lastModified);
  if (Number.isFinite(lastModified) && lastModified > 0) {
    const data = new Date(lastModified);
    if (dataPlausivel(data)) return data.toISOString();
  }
  return new Date().toISOString();
}

/** Retorna a data/hora real da captura em ISO 8601 (UTC). Nunca lança erro. */
export async function dataCapturaDaFoto(arquivo) {
  if (!arquivo || typeof arquivo !== 'object') return new Date().toISOString();
  try {
    const dados = await exifr.parse(arquivo, {
      pick: TAGS_DATA,
      reviveValues: false,
      translateValues: false,
      silentErrors: true,
    });
    const bruta = dados?.DateTimeOriginal || dados?.CreateDate || dados?.ModifyDate;
    const offset = normalizarOffset(
      dados?.OffsetTimeOriginal || dados?.OffsetTimeDigitized || dados?.OffsetTime,
    );
    const data = converterDataExif(bruta, offset);
    if (dataPlausivel(data)) return data.toISOString();
  } catch {
    /* EXIF ausente/indisponível: segue para os fallbacks */
  }
  return fallbackArquivo(arquivo);
}
