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
