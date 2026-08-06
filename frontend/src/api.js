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
