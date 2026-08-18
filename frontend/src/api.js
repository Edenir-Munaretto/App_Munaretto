export const API_URL = import.meta.env.VITE_API_URL || 'https://app-munaretto-1.onrender.com/api';

const TOKEN_KEY = 'munaretto_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
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
  } catch (e) {
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
      });
      if (res.ok) {
        const data = await res.json();
        if (data.token) setToken(data.token);
        return { ok: true, data };
      }
      return { ok: false };
    } catch (err) {
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

export async function apiFetch(url, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(url, { ...options, headers });

  // 401 com token presente = sessão expirada/inválida. Desloga e avisa o app.
  if (res.status === 401 && token) {
    clearToken();
    localStorage.removeItem('munaretto_usuario');
    window.dispatchEvent(new CustomEvent('auth:unauthorized'));
  }

  return res;
}
