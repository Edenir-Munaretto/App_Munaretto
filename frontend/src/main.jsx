import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './utils/polyfills.js'

// Identificador do build em execução (para diagnóstico remoto — ex.: cache
// antigo do PWA/sandbox servindo uma versão velha).
try {
  const scripts = Array.from(document.scripts || []);
  const bundle = scripts.find(s => s.src && s.src.includes('/assets/') && s.src.endsWith('.js'));
  window.__APP_BUILD__ = bundle ? bundle.src.split('/').pop() : 'dev';
} catch {
  window.__APP_BUILD__ = 'desconhecido';
}

// Overlay global de erros (também em produção): qualquer crash fora do
// ErrorBoundary mostra a mensagem/stack na tela em vez de "tela branca".
function exibirErroGlobal(mensagem, stack) {
  console.error('Erro não tratado:', mensagem, stack);
  if (document.getElementById('erro-global-overlay')) return;
  const div = document.createElement('div');
  div.id = 'erro-global-overlay';
  div.style.cssText =
    'position:fixed;inset:0;z-index:99999;background:#7f1d1d;color:#fff;' +
    'padding:24px;overflow:auto;font:13px/1.6 ui-monospace,monospace;white-space:pre-wrap;';
  div.textContent =
    'Erro inesperado no aplicativo. Copie esta mensagem e envie ao suporte:\n\n' +
    `${String(mensagem || '')}\n\n${String(stack || '')}`;
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
