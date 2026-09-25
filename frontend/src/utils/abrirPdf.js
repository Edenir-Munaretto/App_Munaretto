import { API_URL, apiFetch, erroDaResposta } from '../api';

// Abre uma aba imediatamente (evita bloqueio de popup) e navega para o PDF
// gerado (o download exige o token, então usamos fetch + blob URL).
export async function abrirPdfAutenticado(caminho, mostrarToast) {
  const janela = window.open('', '_blank');
  try {
    const res = await apiFetch(`${API_URL}${caminho}`);
    if (!res.ok) {
      janela?.close();
      mostrarToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao gerar o PDF.'), 'error');
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    janela?.location.replace(url);
    // Libera a blob URL depois de a aba nova carregar (revogar antes pode
    // cancelar a leitura do PDF).
    setTimeout(() => window.URL.revokeObjectURL(url), 120000);
  } catch {
    janela?.close();
    mostrarToast('Erro de conexão ao gerar o PDF.', 'error');
  }
}
