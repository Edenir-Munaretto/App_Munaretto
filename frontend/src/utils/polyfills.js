// Polyfills para navegadores/WebViews Android antigas (Chrome < 103).
// Importado ANTES do App no main.jsx — módulos avaliam APIs no escopo do
// módulo (ex.: Object.fromEntries), então o polyfill precisa rodar primeiro.

if (typeof Object.fromEntries !== 'function') {
  Object.fromEntries = (iteravel) => {
    const obj = {};
    for (const [chave, valor] of iteravel) obj[chave] = valor;
    return obj;
  };
}

if (typeof window !== 'undefined' && !window.AbortSignal?.timeout) {
  window.AbortSignal.timeout = (ms) => {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(new DOMException('A requisição estourou o tempo.', 'TimeoutError')), ms);
    controle.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
    return controle.signal;
  };
}
