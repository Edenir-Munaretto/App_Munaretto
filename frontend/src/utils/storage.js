// Armazenamento tolerante a bloqueio do navegador.
//
// Alguns aparelhos/WebViews negam localStorage/sessionStorage (cookies e dados
// do site bloqueados, origem opaca etc.) e o acesso direto lança SecurityError.
// Aqui o acesso nunca quebra o app: quando o navegador bloqueia, usamos um
// fallback em memória (válido apenas enquanto a página estiver aberta).

const memoria = new Map();

let _disponivel = null;

function _testarLocal() {
  try {
    const chave = '__munaretto_teste__';
    window.localStorage.setItem(chave, '1');
    window.localStorage.removeItem(chave);
    return true;
  } catch {
    return false;
  }
}

/** O navegador permite persistir dados (localStorage)? Resultado cacheado. */
export function storageDisponivel() {
  if (_disponivel === null) _disponivel = _testarLocal();
  return _disponivel;
}

export function lerLocal(chave) {
  if (storageDisponivel()) {
    try {
      const valor = window.localStorage.getItem(chave);
      if (valor !== null) return valor;
    } catch {
      /* cai para a memória */
    }
  }
  return memoria.has(chave) ? memoria.get(chave) : null;
}

export function gravarLocal(chave, valor) {
  memoria.set(chave, String(valor));
  if (!storageDisponivel()) return;
  try {
    window.localStorage.setItem(chave, String(valor));
  } catch {
    /* mantém apenas em memória */
  }
}

export function removerLocal(chave) {
  memoria.delete(chave);
  if (!storageDisponivel()) return;
  try {
    window.localStorage.removeItem(chave);
  } catch {
    /* já removido da memória */
  }
}

export function lerSessao(chave) {
  try {
    const valor = window.sessionStorage.getItem(chave);
    if (valor !== null) return valor;
  } catch {
    /* cai para a memória */
  }
  return memoria.has(chave) ? memoria.get(chave) : null;
}

export function gravarSessao(chave, valor) {
  memoria.set(chave, String(valor));
  try {
    window.sessionStorage.setItem(chave, String(valor));
  } catch {
    /* mantém apenas em memória */
  }
}
