export const ROTULO_STATUS = {
  rascunho: 'Rascunho',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};

export const ROTULO_RESPOSTA = {
  conforme: 'Conforme',
  nao_conforme: 'Não Conforme',
  sim: 'Sim',
  nao: 'Não',
  na: 'N/A',
};

export const TIPO_RESPOSTA_PADRAO = 'conforme_nao_conforme_na';

export const ROTULOS_TIPO_RESPOSTA = {
  conforme_nao_conforme_na: 'Conforme / Não Conforme / N/A',
  sim_nao_na: 'Sim / Não / N/A',
};

export const RESPOSTAS_POR_TIPO = {
  conforme_nao_conforme_na: [
    { valor: 'conforme', rotulo: 'Conforme', tom: 'positivo' },
    { valor: 'nao_conforme', rotulo: 'Não Conforme', tom: 'negativo' },
    { valor: 'na', rotulo: 'N/A', tom: 'neutro' },
  ],
  sim_nao_na: [
    { valor: 'sim', rotulo: 'Sim', tom: 'neutro' },
    { valor: 'nao', rotulo: 'Não', tom: 'neutro' },
    { valor: 'na', rotulo: 'N/A', tom: 'neutro' },
  ],
};

export function respostasDoTipo(tipo) {
  return RESPOSTAS_POR_TIPO[tipo] || RESPOSTAS_POR_TIPO[TIPO_RESPOSTA_PADRAO];
}

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
