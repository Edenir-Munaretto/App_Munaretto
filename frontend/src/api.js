import { gravarLocal, lerLocal, removerLocal } from './utils/storage';

export const API_URL = import.meta.env.VITE_API_URL || 'https://app-munaretto-1.onrender.com/api';

const TOKEN_KEY = 'munaretto_token';

export function getToken() {
  return lerLocal(TOKEN_KEY);
}

export function setToken(token) {
  gravarLocal(TOKEN_KEY, token);
}

export function clearToken() {
  removerLocal(TOKEN_KEY);
}

// Decodifica o payload de um JWT sem validar a assinatura (apenas para leitura do `exp`).
export function decodificarToken(token) {
  if (!token) return null;
  try {
    const payloadBase64 = token.split('.')[1];
    if (!payloadBase64) return null;
    const base64 = payloadBase64.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Segundos restantes até a expiração do token (0 ou negativo = expirado).
export function segundosAteExpiracao() {
  const token = getToken();
  const payload = decodificarToken(token);
  if (!payload || !payload.exp) return 0;
  return Math.floor(payload.exp - Date.now() / 1000);
}

let renovacaoEmAndamento = null;

// Renova a sessão emitindo um novo token. Evita chamadas concorrentes.
export async function renovarSessao() {
  if (renovacaoEmAndamento) return renovacaoEmAndamento;
  renovacaoEmAndamento = (async () => {
    try {
      const res = await fetch(`${API_URL}/usuarios/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        // Timeout próprio: sem ele a promise ficava pendurada em rede morta
        // e travava o botão "Renovar sessão".
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.token) setToken(data.token);
        return { ok: true, data };
      }
      return { ok: false };
    } catch {
      return { ok: false };
    } finally {
      renovacaoEmAndamento = null;
    }
  })();
  return renovacaoEmAndamento;
}

// Converte a resposta de erro do backend em um texto seguro.
// O FastAPI/Pydantic pode retornar `detail` como string OU como array de
// objetos {type, loc, msg, input, ctx} (erro 422). Renderizar esse array
// diretamente quebra o React (error #31). Este helper normaliza tudo.
export function erroDaResposta(resData, fallback = 'Erro inesperado.') {
  if (!resData) return fallback;
  if (typeof resData === 'string') return resData;
  const detail = resData.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const msgs = detail.map(e => e.msg || e.message || JSON.stringify(e));
    return msgs.filter(Boolean).join(' ');
  }
  if (typeof resData.message === 'string') return resData.message;
  return fallback;
}

const ATRASO_RETRY_PADRAO = 800;
const TIMEOUT_PADRAO = 30000;

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function apiFetch(url, options = {}) {
  const {
    retry = 0,
    retryDelay = ATRASO_RETRY_PADRAO,
    timeoutMs = TIMEOUT_PADRAO,
    ...rest
  } = options;
  const metodo = (rest.method || 'GET').toUpperCase();
  const maxTentativas = metodo === 'GET' ? Math.max(0, retry) : 0;

  let ultimoErro;
  for (let tentativa = 0; tentativa <= maxTentativas; tentativa += 1) {
    const token = getToken();
    const headers = { ...(rest.headers || {}) };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    // Timeout padrão de 30s para não travar em WiFi sem internet; chamadas com
    // sinal próprio (sonda curta, upload de foto, sincronização) o substituem.
    const sinal = rest.signal || AbortSignal.timeout(timeoutMs);
    try {
      const res = await fetch(url, { ...rest, headers, signal: sinal });

      // 401 com token presente = sessão expirada/inválida. Desloga e avisa o app.
      if (res.status === 401 && token) {
        clearToken();
        removerLocal('munaretto_usuario');
        window.dispatchEvent(new CustomEvent('auth:unauthorized'));
      }

      if (res.status >= 500 && tentativa < maxTentativas) {
        await esperar(retryDelay * (tentativa + 1));
        continue;
      }

      return res;
    } catch (err) {
      ultimoErro = err;
      if (tentativa >= maxTentativas || rest.signal?.aborted) throw err;
      await esperar(retryDelay * (tentativa + 1));
    }
  }
  throw ultimoErro;
}
