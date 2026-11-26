export const ROTULO_STATUS = {
  rascunho: 'Rascunho',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};

export const ROTULO_RESPOSTA = {
  conforme: 'Conforme',
  nao_conforme: 'Não Conforme',
  na: 'N/A',
};

export const CORES_STATUS = {
  rascunho: 'bg-amber-50 text-amber-700 border-amber-200',
  concluida: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelada: 'bg-rose-50 text-rose-700 border-rose-200',
};

export function formatarData(valor) {
  if (!valor) return '-';
  try {
    return new Date(`${valor}T12:00:00`).toLocaleDateString('pt-BR');
  } catch {
    return String(valor);
  }
}

export function formatarDataHora(valor) {
  if (!valor) return '-';
  try {
    return new Date(valor).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(valor);
  }
}

export function hojeISO() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

export function capturarGeolocalizacao() {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    let finalizado = false;
    const encerrar = (valor) => {
      if (!finalizado) {
        finalizado = true;
        resolve(valor);
      }
    };
    const timer = setTimeout(() => encerrar(null), 5000);
    navigator.geolocation.getCurrentPosition(
      (posicao) => {
        clearTimeout(timer);
        encerrar(`${posicao.coords.latitude.toFixed(6)},${posicao.coords.longitude.toFixed(6)}`);
      },
      () => {
        clearTimeout(timer);
        encerrar(null);
      },
      { enableHighAccuracy: true, timeout: 4500, maximumAge: 60000 },
    );
  });
}
