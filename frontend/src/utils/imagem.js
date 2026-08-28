// Redimensiona/comprime imagens ANTES do upload (canvas no navegador):
// reduz fotos de celular para no máx. `maxLado` px e converte para JPEG,
// economizando armazenamento e tempo de envio (inclusive na fila offline).
export async function comprimirImagem(arquivo, maxLado = 1600, qualidade = 0.82) {
  if (!arquivo || !arquivo.type || !arquivo.type.startsWith('image/')) return arquivo;
  try {
    const bitmap = await createImageBitmap(arquivo);
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
    if (escala >= 1) {
      bitmap.close();
      return arquivo;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * escala));
    canvas.height = Math.max(1, Math.round(bitmap.height * escala));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', qualidade));
    if (!blob) return arquivo;
    return new File([blob], arquivo.name.replace(/\.(png|webp)$/i, '.jpg') || 'foto.jpg', { type: 'image/jpeg' });
  } catch {
    return arquivo; // fallback: envia o original
  }
}
