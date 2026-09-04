// Polyfills para navegadores/WebViews Android antigas (Chrome < 103).
// Importado no topo do main.jsx — roda antes de qualquer uso.

if (typeof window !== 'undefined' && !window.AbortSignal?.timeout) {
  window.AbortSignal.timeout = (ms) => {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(new DOMException('A requisição estourou o tempo.', 'TimeoutError')), ms);
    controle.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
    return controle.signal;
  };
}
