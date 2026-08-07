import React, { useState, useEffect } from 'react';
import { Search, Plus, Edit2, Trash2, X, Check, AlertTriangle, Contact, Users, UserCheck, UserX, Power, RotateCcw } from 'lucide-react';
import { API_URL, apiFetch, erroDaResposta } from '../api';

function Funcionarios({ usuarioAtual }) {
  const [funcionarios, setFuncionarios] = useState([]);
  const [stats, setStats] = useState({ total: 0, ativos: 0, inativos: 0 });
  const [filtroStatus, setFiltroStatus] = useState('ativos');
  const [busca, setBusca] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ nome: '', cpf: '', cargo_id: '' });
  const [cargos, setCargos] = useState([]);

  const temSst = (usuarioAtual?.permissoes || []).includes('sst');

  useEffect(() => {
    fetchFuncionarios();
  }, [busca, filtroStatus]);

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    if (temSst) {
      apiFetch(`${API_URL}/sst/cargos`)
        .then(res => res.ok ? res.json() : [])
        .then(setCargos)
        .catch(() => setCargos([]));
    }
  }, [temSst]);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchStats = async () => {
    try {
      const res = await apiFetch(`${API_URL}/funcionarios/stats`);
      if (res.ok) setStats(await res.json());
    } catch (err) {
      console.error('Erro ao buscar estatísticas:', err);
    }
  };

  const fetchFuncionarios = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (busca) params.set('busca', busca);
      if (filtroStatus !== 'ativos') params.set('status', filtroStatus);
      const qs = params.toString();
      const url = `${API_URL}/funcionarios/${qs ? `?${qs}` : ''}`;
      const res = await apiFetch(url);
      if (res.ok) {
        setFuncionarios(await res.json());
      }
    } catch (err) {
      console.error('Erro ao buscar funcionários:', err);
      showToast('Erro de conexão ao buscar funcionários', 'error');
    } finally {
      setLoading(false);
    }
  };

  const openAddModal = () => {
    setEditingId(null);
    setForm({ nome: '', cpf: '', cargo_id: '' });
    setShowModal(true);
  };

  const openEditModal = (f) => {
    setEditingId(f.id);
    setForm({ nome: f.nome, cpf: f.cpf, cargo_id: f.cargo_id || '' });
    setShowModal(true);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.nome || !form.cpf) {
      showToast('Nome e CPF são obrigatórios.', 'error');
      return;
    }

    const payload = {
      nome: form.nome,
      cpf: form.cpf,
      cargo_id: form.cargo_id ? Number(form.cargo_id) : null
    };

    try {
      const method = editingId ? 'PUT' : 'POST';
      const url = editingId ? `${API_URL}/funcionarios/${editingId}` : `${API_URL}/funcionarios/`;

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const resData = await res.json();

      if (res.ok) {
        showToast(editingId ? 'Funcionário atualizado com sucesso!' : 'Funcionário cadastrado com sucesso!');
        setShowModal(false);
        fetchFuncionarios();
        fetchStats();
      } else {
        showToast(erroDaResposta(resData, 'Erro ao salvar funcionário.'), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro ao salvar funcionário.', 'error');
    }
  };

  const handleToggleStatus = async (f) => {
    const novoStatus = !f.ativo;
    const acao = novoStatus ? 'reativar' : 'inativar';
    if (!window.confirm(`Tem certeza que deseja ${acao} o funcionário "${f.nome}"?`)) return;

    try {
      const res = await apiFetch(`${API_URL}/funcionarios/${f.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: novoStatus })
      });

      if (res.ok) {
        showToast(novoStatus ? 'Funcionário reativado com sucesso!' : 'Funcionário inativado com sucesso!');
        fetchFuncionarios();
        fetchStats();
      } else {
        showToast('Erro ao alterar o status do funcionário.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao alterar o status do funcionário.', 'error');
    }
  };

  const handleDelete = async (id, nome) => {
    if (!window.confirm(`Tem certeza que deseja inativar o funcionário "${nome}"?`)) return;

    try {
      const res = await apiFetch(`${API_URL}/funcionarios/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Funcionário excluído com sucesso.');
        fetchFuncionarios();
        fetchStats();
      } else {
        showToast('Erro ao excluir funcionário.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao excluir funcionário.', 'error');
    }
  };

  const filtros = [
    { key: 'ativos', label: 'Ativos', icon: UserCheck },
    { key: 'inativos', label: 'Inativos', icon: UserX },
    { key: 'todos', label: 'Todos', icon: Users },
  ];

  const statCards = [
    { title: 'Funcionários Cadastrados', value: stats.total, icon: Users, color: 'from-blue-500 to-primary-600', iconColor: 'text-blue-500' },
    { title: 'Ativos', value: stats.ativos, icon: UserCheck, color: 'from-emerald-500 to-teal-600', iconColor: 'text-emerald-500' },
    { title: 'Inativos', value: stats.inativos, icon: UserX, color: 'from-rose-500 to-orange-500', iconColor: 'text-rose-500' },
  ];

  return (
    <div className="space-y-6 relative">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 p-4 rounded-xl shadow-xl flex items-center gap-3 border text-sm max-w-sm animate-in slide-in-from-top-4 duration-300 ${
          toast.type === 'error'
            ? 'bg-rose-50 border-rose-200 text-rose-800'
            : 'bg-emerald-50 border-emerald-200 text-emerald-800'
        }`}>
          <div className={`p-1 rounded-full ${toast.type === 'error' ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'}`}>
            {toast.type === 'error' ? <AlertTriangle size={16} /> : <Check size={16} />}
          </div>
          <p className="font-semibold">{typeof toast.message === 'string' ? toast.message : 'Erro inesperado.'}</p>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {statCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div key={idx} className={`bg-gradient-to-br ${card.color} text-white rounded-2xl p-5 shadow-md relative overflow-hidden`}>
              <div className="absolute right-0 bottom-0 top-0 w-1/3 bg-[radial-gradient(circle_at_right,rgba(255,255,255,0.2),transparent)] pointer-events-none" />
              <div className="relative z-10 flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-bold uppercase tracking-wider text-white/80">{card.title}</p>
                  <p className="text-3xl font-black">{card.value}</p>
                </div>
                <div className="p-3 rounded-xl bg-white/20">
                  <Icon size={24} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div className="relative w-full sm:w-96">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
            <Search size={18} />
          </span>
          <input
            type="text"
            placeholder="Buscar funcionário por nome ou CPF..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-slate-100 rounded-xl p-1">
            {filtros.map((f) => {
              const Icon = f.icon;
              return (
                <button
                  key={f.key}
                  onClick={() => setFiltroStatus(f.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    filtroStatus === f.key
                      ? 'bg-white text-primary-700 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Icon size={14} />
                  {f.label}
                </button>
              );
            })}
          </div>

          <button
            onClick={openAddModal}
            className="flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl font-semibold text-sm hover:bg-primary-700 transition-all shadow-md shadow-primary-900/10 cursor-pointer"
          >
            <Plus size={18} />
            Cadastrar Funcionário
          </button>
        </div>
      </div>

      {/* Lista */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-bold text-xs uppercase tracking-wider">
                <th className="px-3 py-3 md:px-6 md:py-4">Nome</th>
                <th className="px-3 py-3 md:px-6 md:py-4">CPF</th>
                {temSst && <th className="px-3 py-3 md:px-6 md:py-4">Cargo</th>}
                <th className="px-3 py-3 md:px-6 md:py-4">Status</th>
                <th className="px-3 py-3 md:px-6 md:py-4 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={temSst ? 5 : 4} className="text-center py-12 text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
                      <p className="text-xs">Buscando funcionários...</p>
                    </div>
                  </td>
                </tr>
              ) : funcionarios.length === 0 ? (
                <tr>
                  <td colSpan={temSst ? 5 : 4} className="text-center py-16 text-slate-400">
                    <Contact className="mx-auto mb-3 text-slate-300" size={40} />
                    <p className="font-semibold mt-2">Nenhum funcionário encontrado.</p>
                    <p className="text-xs mt-1">Cadastre funcionários para usar como lista ao lançar férias e no módulo SST.</p>
                  </td>
                </tr>
              ) : (
                funcionarios.map((f) => (
                  <tr key={f.id} className={`hover:bg-slate-50/50 transition-colors ${!f.ativo ? 'opacity-60' : ''}`}>
                    <td className="px-3 py-3 md:px-6 md:py-4 font-bold text-slate-900">{f.nome}</td>
                    <td className="px-3 py-3 md:px-6 md:py-4 font-mono text-xs">{f.cpf}</td>
                    {temSst && (
                      <td className="px-3 py-3 md:px-6 md:py-4">
                        {f.cargo_id ? (
                          <span className="px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 border border-primary-100 text-[10px] font-bold">
                            {cargos.find(c => c.id === f.cargo_id)?.nome || 'Cargo'}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">-</span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-3 md:px-6 md:py-4">
                      {f.ativo ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 text-[10px] font-bold">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Ativo
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-100 text-[10px] font-bold">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                          Inativo
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 md:px-6 md:py-4">
                      <div className="flex justify-center items-center gap-2">
                        <button
                          onClick={() => openEditModal(f)}
                          className="p-2 rounded bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-700 border border-slate-100 transition-colors"
                          title="Editar"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => handleToggleStatus(f)}
                          className={`p-2 rounded border transition-colors cursor-pointer ${
                            f.ativo
                              ? 'bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border-slate-100'
                              : 'bg-slate-50 hover:bg-emerald-50 text-slate-500 hover:text-emerald-700 border-slate-100'
                          }`}
                          title={f.ativo ? 'Inativar' : 'Reativar'}
                        >
                          {f.ativo ? <Power size={15} /> : <RotateCcw size={15} />}
                        </button>
                        <button
                          onClick={() => handleDelete(f.id, f.nome)}
                          className="p-2 rounded bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-100 transition-colors"
                          title="Excluir"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-slate-900 text-white px-3 py-3 md:px-6 md:py-4 flex items-center justify-between">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Contact className="text-primary-400" size={20} />
                {editingId ? 'Editar Funcionário' : 'Novo Funcionário'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white text-xl font-bold cursor-pointer">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Nome Completo *</label>
                <input
                  type="text"
                  name="nome"
                  value={form.nome}
                  onChange={handleInputChange}
                  required
                  placeholder="Ex: Maria da Silva"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">CPF *</label>
                <input
                  type="text"
                  name="cpf"
                  value={form.cpf}
                  onChange={handleInputChange}
                  required
                  placeholder="Apenas números ou formatado"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                />
              </div>

              {temSst && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Cargo / Função (Matriz SST)</label>
                  <select
                    name="cargo_id"
                    value={form.cargo_id}
                    onChange={handleInputChange}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
                  >
                    <option value="">Selecione o cargo...</option>
                    {cargos.map(c => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-400 mt-1 font-semibold">
                    Usado pelo módulo Segurança do Trabalho para sugerir os treinamentos obrigatórios.
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-all shadow-md shadow-primary-900/10 cursor-pointer"
                >
                  {editingId ? 'Salvar Alterações' : 'Cadastrar Funcionário'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Funcionarios;
