import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { API_URL, apiFetch, erroDaResposta } from '../api';

// Bloqueio de primeiro acesso: o backend só libera as demais rotas depois que
// o usuário troca a senha temporária (flag `precisa_trocar_senha`).
export default function TrocaSenhaObrigatoria({ onConcluido, onSair }) {
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e) => {
    e.preventDefault();
    setErro('');
    if (novaSenha.length < 8) {
      setErro('A nova senha deve ter no mínimo 8 caracteres.');
      return;
    }
    if (novaSenha !== confirmar) {
      setErro('A confirmação não confere com a nova senha.');
      return;
    }
    try {
      setEnviando(true);
      const res = await apiFetch(`${API_URL}/usuarios/trocar-senha`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha_atual: senhaAtual, nova_senha: novaSenha }),
      });
      const dados = await res.json().catch(() => null);
      if (!res.ok) {
        setErro(erroDaResposta(dados, 'Não foi possível trocar a senha.'));
        return;
      }
      onConcluido?.();
    } catch {
      setErro('Erro de conexão. Verifique a internet e tente novamente.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
      <form onSubmit={enviar} className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-slate-200 p-6">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
            <KeyRound size={20} />
          </span>
          <div>
            <h1 className="text-lg font-bold text-slate-800">Troca de senha obrigatória</h1>
            <p className="text-xs text-slate-500">
              Este é seu primeiro acesso. Defina uma senha pessoal para continuar.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <div>
            <label htmlFor="senha-atual" className="block text-xs font-bold text-slate-600 mb-1">
              Senha atual (temporária)
            </label>
            <input
              id="senha-atual"
              type="password"
              autoComplete="current-password"
              value={senhaAtual}
              onChange={(e) => setSenhaAtual(e.target.value)}
              required
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label htmlFor="nova-senha" className="block text-xs font-bold text-slate-600 mb-1">
              Nova senha (mínimo 8 caracteres)
            </label>
            <input
              id="nova-senha"
              type="password"
              autoComplete="new-password"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              required
              minLength={8}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label htmlFor="confirmar-senha" className="block text-xs font-bold text-slate-600 mb-1">
              Confirmar nova senha
            </label>
            <input
              id="confirmar-senha"
              type="password"
              autoComplete="new-password"
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              required
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        {erro && (
          <p className="mt-4 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700">
            {erro}
          </p>
        )}

        <button
          type="submit"
          disabled={enviando}
          className="mt-6 w-full min-h-11 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold transition-colors disabled:opacity-50"
        >
          {enviando ? 'Salvando...' : 'Salvar nova senha'}
        </button>
        <button
          type="button"
          onClick={onSair}
          className="mt-2 w-full min-h-11 rounded-xl text-slate-500 hover:text-slate-700 text-xs font-semibold"
        >
          Sair e entrar com outro usuário
        </button>
      </form>
    </div>
  );
}
