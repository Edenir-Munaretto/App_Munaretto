import React from 'react'
import ReactDOM from 'react-dom/client'
// Polyfills ANTES do App: módulos como o de O.S avaliam APIs no escopo do
// módulo (ex.: Object.fromEntries), então o polyfill precisa rodar primeiro.
import './utils/polyfills.js'
import App from './App.jsx'
import './index.css'

// Overlay global de erros (também em produção): qualquer crash fora do
// ErrorBoundary mostra a mensagem/stack na tela em vez de "tela branca".
// É dispensável e oferece a limpeza dos dados locais — sem isso o usuário de
// campo ficaria preso numa parede vermelha sem saída.

async function limparDadosLocais() {
  try { localStorage.clear(); } catch { /* bloqueado */ }
  try { sessionStorage.clear(); } catch { /* bloqueado */ }
  const tarefas = [];
  try {
    if (window.indexedDB && indexedDB.databases) {
      tarefas.push(
        indexedDB.databases().then((bancos) =>
          Promise.all(
            bancos
              .filter((b) => b && b.name)
              .map(
                (b) =>
                  new Promise((resolve) => {
                    const req = indexedDB.deleteDatabase(b.name);
                    req.onsuccess = req.onerror = req.onblocked = () => resolve();
                  }),
              ),
          ),
        ),
      );
    }
  } catch { /* sem IndexedDB */ }
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      tarefas.push(
        navigator.serviceWorker.getRegistrations().then((registros) =>
          Promise.all(registros.map((r) => r.unregister())),
        ),
      );
    }
  } catch { /* sem service worker */ }
  try {
    if (window.caches && caches.keys) {
      tarefas.push(caches.keys().then((chaves) => Promise.all(chaves.map((c) => caches.delete(c)))));
    }
  } catch { /* sem cache storage */ }
  // Best-effort com teto de tempo: a página não pode ficar presa limpando.
  await Promise.race([
    Promise.all(tarefas).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}

function exibirErroGlobal(mensagem, stack) {
  console.error('Erro não tratado:', mensagem, stack);
  if (document.getElementById('erro-global-overlay')) return;

  const div = document.createElement('div');
  div.id = 'erro-global-overlay';
  div.style.cssText =
    'position:fixed;inset:0;z-index:99999;background:#7f1d1d;color:#fff;' +
    'padding:24px;overflow:auto;font:13px/1.6 ui-monospace,monospace;';

  const titulo = document.createElement('div');
  titulo.style.cssText = 'font-weight:bold;font-size:15px;margin-bottom:6px;';
  titulo.textContent = 'Erro inesperado no aplicativo';

  const dica = document.createElement('div');
  dica.style.cssText = 'margin-bottom:12px;opacity:.9;';
  dica.textContent = 'Copie esta mensagem e envie ao suporte:';

  const pre = document.createElement('pre');
  pre.style.cssText = 'white-space:pre-wrap;word-break:break-word;margin:0 0 18px 0;';
  pre.textContent =
    `${String(mensagem || '')}\n\n${String(stack || '')}\n\n` +
    `UA: ${navigator.userAgent}\nURL: ${location.href}`;

  const botoes = document.createElement('div');
  botoes.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;';

  const btnContinuar = document.createElement('button');
  btnContinuar.textContent = 'Continuar mesmo assim';
  btnContinuar.style.cssText =
    'background:#fff;color:#7f1d1d;border:0;border-radius:8px;padding:10px 16px;' +
    'font-weight:bold;cursor:pointer;';
  btnContinuar.onclick = () => div.remove();

  const btnLimpar = document.createElement('button');
  btnLimpar.textContent = 'Limpar dados e recarregar';
  btnLimpar.style.cssText =
    'background:#450a0a;color:#fff;border:1px solid #fca5a5;border-radius:8px;' +
    'padding:10px 16px;font-weight:bold;cursor:pointer;';
  btnLimpar.onclick = async () => {
    btnLimpar.disabled = true;
    btnLimpar.textContent = 'Limpando...';
    await limparDadosLocais();
    window.location.reload();
  };

  botoes.append(btnContinuar, btnLimpar);
  div.append(titulo, dica, pre, botoes);
  document.body.appendChild(div);
}

window.addEventListener('error', (evento) => exibirErroGlobal(evento.message, evento.error?.stack));
window.addEventListener('unhandledrejection', (evento) => {
  const motivo = evento.reason;
  exibirErroGlobal(motivo?.message || String(motivo), motivo?.stack);
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('Erro ao registrar service worker:', err);
    });
  });
}
