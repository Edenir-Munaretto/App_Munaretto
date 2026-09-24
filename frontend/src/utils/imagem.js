// Redimensiona/comprime imagens ANTES do upload (canvas no navegador):
// reduz fotos de celular para no máx. `maxLado` px e garante um formato que o
// backend aceita (routers/os.py: MIMES_FOTO_PERMITIDOS), economizando
// armazenamento/tempo de envio e evitando conflito 400 por MIME no sync.

// Mesma lista de `MIMES_FOTO_PERMITIDOS` do backend.
const MIMES_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];

export function mimeFotoPermitido(tipo) {
  return MIMES_PERMITIDOS.includes(String(tipo || '').toLowerCase());
}

// Só o JPEG dentro do limite dispensa a passagem pelo canvas; qualquer outro
// formato (inclusive PNG/WebP pequeno) é reconvertido para JPEG.
export function precisaConverterFoto(tipo, largura, altura, maxLado = 1600) {
  if (String(tipo || '').toLowerCase() !== 'image/jpeg') return true;
  return Math.max(Number(largura) || 0, Number(altura) || 0) > maxLado;
}

export async function comprimirImagem(arquivo, maxLado = 1600, qualidade = 0.82) {
  if (!arquivo || !arquivo.type || !arquivo.type.startsWith('image/')) return arquivo;
  try {
    const bitmap = await createImageBitmap(arquivo);
    // JPEG já dentro do limite: devolve o original (sem recompressão).
    if (!precisaConverterFoto(arquivo.type, bitmap.width, bitmap.height, maxLado)) {
      bitmap.close();
      return arquivo;
    }
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * escala));
    canvas.height = Math.max(1, Math.round(bitmap.height * escala));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', qualidade));
    if (!blob) return arquivo;
    return new File([blob], arquivo.name.replace(/\.(png|webp|heic|heif)$/i, '.jpg') || 'foto.jpg', {
      type: 'image/jpeg',
    });
  } catch {
    return arquivo; // fallback: o chamador valida o MIME antes de enfileirar
  }
}
