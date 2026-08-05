import React, { useState } from 'react';
import { LogIn, Lock, Mail, AlertTriangle } from 'lucide-react';
import { API_URL, apiFetch } from '../api';

function Login({ onLogin, mensagemExpirada = false }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErro('');

    // Validações no cliente antes do envio
    const emailLimpo = email.trim();
    if (!emailLimpo) {
      setErro('Informe seu e-mail.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLimpo)) {
      setErro('Informe um e-mail válido.');
      return;
    }
    if (!senha) {
      setErro('Informe sua senha.');
      return;
    }
    if (senha.length < 4) {
      setErro('A senha deve ter pelo menos 4 caracteres.');
      return;
    }

    setLoading(true);

    try {
      const res = await apiFetch(`${API_URL}/usuarios/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailLimpo, senha })
      });

      if (res.ok) {
        const data = await res.json();
        onLogin(data);
      } else if (res.status === 401) {
        setErro('E-mail ou senha incorretos.');
      } else if (res.status === 403) {
        setErro('Usuário inativo. Contate o administrador.');
      } else if (res.status === 429) {
        setErro('Muitas tentativas de login. Aguarde um pouco e tente novamente.');
      } else {
        setErro('Não foi possível entrar. Tente novamente mais tarde.');
      }
    } catch (err) {
      console.error(err);
      setErro('Erro de conexão. Verifique se o servidor está online.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-primary-950 p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="bg-slate-900 px-8 py-6 flex flex-col items-center gap-2">
            <span className="text-3xl">📄</span>
            <h1 className="font-extrabold text-xl tracking-wider bg-gradient-to-r from-primary-400 to-emerald-400 bg-clip-text text-transparent uppercase">
              Munaretto
            </h1>
            <p className="text-xs text-slate-400">Acesse o sistema para continuar</p>
          </div>

          <form onSubmit={handleSubmit} className="p-8 space-y-5">
            {erro && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-center gap-2">
                <AlertTriangle size={16} />
                {erro}
              </div>
            )}

            {mensagemExpirada && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-center gap-2">
                <AlertTriangle size={16} />
                Sua sessão expirou. Faça login novamente para continuar.
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">E-mail</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-2.5 text-slate-400" size={18} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="seu@email.com"
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">Senha</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-2.5 text-slate-400" size={18} />
                <input
                  type="password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 hover:bg-primary-700 text-white font-bold text-sm rounded-xl transition-all shadow-md shadow-primary-900/20 cursor-pointer disabled:opacity-60"
            >
              <LogIn size={16} />
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-slate-400 mt-4">Escritório Munaretto</p>
      </div>
    </div>
  );
}

export default Login;
