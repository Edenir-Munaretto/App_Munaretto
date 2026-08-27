import React, { useState, useEffect } from 'react';
import { Search, Plus, Edit2, Trash2, Check, AlertTriangle, UserCog } from 'lucide-react';
import { API_URL, apiFetch, erroDaResposta } from '../api';
import { MODULOS } from '../modules';
import ModalConfirmacao from '../components/ModalConfirmacao';
import ErroCarregamento from '../components/ErroCarregamento';
import { useFetchState } from '../hooks/useFetchState';

function Configuracoes({ usuarioAtual, onUsuarioAtualizado }) {
  const [usuarios, setUsuarios] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [busca, setBusca] = useState('');
  const [loading, setLoading] = useState(true);
  const lista = useFetchState();
  const [toast, setToast] = useState(null);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [confirmarExclusao, setConfirmarExclusao] = useState(null);
  const [formData, setFormData] = useState({
    nome: '',
    email: '',
    senha: '',
    ativo: true,
    permissoes: [],
    funcionario_id: ''
  });

  useEffect(() => {
    fetchUsuarios();
    fetchFuncionarios();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchFuncionarios = async () => {
    try {
      const res = await apiFetch(`${API_URL}/funcionarios/`);
      if (res.ok) setFuncionarios(await res.json());
    } catch (err) {
      console.error('Erro ao buscar funcionários:', err);
    }
  };

  const fetchUsuarios = async () => {
    try {
      setLoading(true);
      lista.iniciar();
      const res = await apiFetch(`${API_URL}/usuarios/`);
      if (res.ok) {
        setUsuarios(await res.json());
        lista.sucesso();
      } else {
        lista.falhar('Erro ao buscar usuários.');
      }
    } catch (err) {
      console.error(err);
      lista.falhar('Erro de conexão ao buscar usuários.');
    } finally {
      setLoading(false);
    }
  };

  const openAddModal = () => {
    setEditingId(null);
    setFormData({
      nome: '',
      email: '',
      senha: '',
      ativo: true,
      permissoes: [],
      funcionario_id: ''
    });
    setShowModal(true);
  };

  const openEditModal = (u) => {
    setEditingId(u.id);
    setFormData({
      nome: u.nome || '',
      email: u.email || '',
      senha: '',
      ativo: u.ativo,
      permissoes: u.permissoes || [],
      funcionario_id: u.funcionario_id != null ? String(u.funcionario_id) : ''
    });
    setShowModal(true);
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const togglePermissao = (id) => {
    setFormData(prev => ({
      ...prev,
      permissoes: prev.permissoes.includes(id)
        ? prev.permissoes.filter(p => p !== id)
        : [...prev.permissoes, id]
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.nome || !formData.email) {
      showToast('Nome e e-mail são obrigatórios.', 'error');
      return;
    }
    if (!editingId && !formData.senha) {
      showToast('Defina uma senha para o novo usuário.', 'error');
      return;
    }

    const payload = {
      nome: formData.nome,
      email: formData.email,
      senha: formData.senha,
      ativo: formData.ativo,
      permissoes: formData.permissoes,
      funcionario_id: formData.funcionario_id ? Number(formData.funcionario_id) : null
    };

    try {
      const method = editingId ? 'PUT' : 'POST';
      const url = editingId ? `${API_URL}/usuarios/${editingId}` : `${API_URL}/usuarios/`;

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const resData = await res.json();

      if (res.ok) {
        showToast(editingId ? 'Usuário atualizado com sucesso!' : 'Usuário cadastrado com sucesso!');
        setShowModal(false);
        fetchUsuarios();
        // Se o próprio usuário logado teve permissões alteradas, atualiza a sessão na hora.
        if (onUsuarioAtualizado) onUsuarioAtualizado();
      } else {
        showToast(erroDaResposta(resData, 'Erro ao salvar usuário.'), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao salvar usuário.', 'error');
    }
  };

  const handleDelete = (id, nome) => {
    if (usuarioAtual && usuarioAtual.id === id) {
      showToast('Você não pode excluir o próprio usuário logado.', 'error');
      return;
    }
    setConfirmarExclusao({ id, nome });
  };

  const excluirUsuario = async () => {
    if (!confirmarExclusao) return;
    try {
      const res = await apiFetch(`${API_URL}/usuarios/${confirmarExclusao.id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Usuário excluído com sucesso.');
        fetchUsuarios();
      } else {
        showToast('Erro ao excluir usuário.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao excluir usuário.', 'error');
    } finally {
      setConfirmarExclusao(null);
    }
  };

  const filteredUsuarios = usuarios.filter(u => {
    const searchLower = busca.toLowerCase();
    return (u.nome || '').toLowerCase().includes(searchLower) ||
      (u.email || '').toLowerCase().includes(searchLower);
  });

  const nomeFuncionario = (id) => {
    if (!id) return null;
    const f = funcionarios.find(f => f.id === id);
    return f ? f.nome : 'Funcionário removido';
  };

  return (
    <div className="space-y-6">
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

      {/* Header Actions */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3.5 top-3 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Buscar por nome ou e-mail..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all text-sm"
          />
        </div>
        <button
          onClick={openAddModal}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl font-semibold text-sm hover:bg-primary-700 transition-all shadow-md shadow-primary-900/10 cursor-pointer"
        >
          <Plus size={18} />
          Novo Usuário
        </button>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-bold text-xs uppercase tracking-wider">
                <th className="px-3 py-3 md:px-6 md:py-4">Nome</th>
                <th className="px-3 py-3 md:px-6 md:py-4">E-mail</th>
                <th className="px-3 py-3 md:px-6 md:py-4">Funcionário vinculado</th>
                <th className="px-3 py-3 md:px-6 md:py-4">Módulos</th>
                <th className="px-3 py-3 md:px-6 md:py-4 text-center">Status</th>
                <th className="px-3 py-3 md:px-6 md:py-4 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan="6" className="text-center py-12 text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
                      <p className="text-xs">Carregando usuários...</p>
                    </div>
                  </td>
                </tr>
              ) : lista.status === 'error' ? (
                <tr>
                  <td colSpan="6">
                    <ErroCarregamento mensagem={lista.erro} onTentarNovamente={fetchUsuarios} />
                  </td>
                </tr>
              ) : filteredUsuarios.length === 0 ? (
                <tr>
                  <td colSpan="6" className="text-center py-16 text-slate-400">
                    <span className="text-3xl">👤</span>
                    <p className="font-semibold mt-2">Nenhum usuário encontrado.</p>
                    <p className="text-xs mt-1">Cadastre um novo usuário no botão acima.</p>
                  </td>
                </tr>
              ) : (
                filteredUsuarios.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-3 py-3 md:px-6 md:py-4 font-bold text-slate-900">
                      {u.nome}
                      {usuarioAtual && usuarioAtual.id === u.id && (
                        <span className="ml-2 text-[9px] font-bold text-primary-600 bg-primary-50 border border-primary-100 rounded-full px-2 py-0.5">VOCÊ</span>
                      )}
                    </td>
                    <td className="px-3 py-3 md:px-6 md:py-4 text-xs">{u.email}</td>
                    <td className="px-3 py-3 md:px-6 md:py-4 text-xs">
                      {nomeFuncionario(u.funcionario_id) ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100 text-[10px] font-bold">
                          {nomeFuncionario(u.funcionario_id)}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 md:px-6 md:py-4">
                      <div className="flex flex-wrap gap-1 max-w-md">
                        {(u.permissoes || []).map((p) => {
                          const mod = MODULOS.find(m => m.id === p);
                          return mod ? (
                            <span key={p} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 text-[9px] font-bold">
                              {mod.label}
                            </span>
                          ) : null;
                        })}
                      </div>
                    </td>
                    <td className="px-3 py-3 md:px-6 md:py-4 text-center">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                        u.ativo 
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                          : 'bg-rose-50 text-rose-600 border-rose-100'
                      }`}>
                        {u.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-3 py-3 md:px-6 md:py-4">
                      <div className="flex justify-center items-center gap-2">
                        <button
                          onClick={() => openEditModal(u)}
                          className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-700 border border-slate-100 transition-colors"
                          title="Editar"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => handleDelete(u.id, u.nome)}
                          className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-100 transition-colors"
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
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden animate-in fade-in zoom-in duration-200 max-h-[90vh] flex flex-col">
            <div className="bg-slate-900 text-white px-3 py-3 md:px-6 md:py-4 flex items-center justify-between">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <UserCog className="text-primary-400" size={20} />
                {editingId ? 'Editar Usuário' : 'Novo Usuário'}
              </h3>
              <button 
                onClick={() => setShowModal(false)} 
                className="text-slate-400 hover:text-white text-xl font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="col-span-1 md:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Nome *</label>
                  <input
                    type="text"
                    name="nome"
                    value={formData.nome}
                    onChange={handleInputChange}
                    required
                    placeholder="Nome do usuário"
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">E-mail *</label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    required
                    placeholder="usuario@email.com"
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Funcionário vinculado</label>
                  <select
                    name="funcionario_id"
                    value={formData.funcionario_id}
                    onChange={handleInputChange}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm bg-white"
                  >
                    <option value="">Nenhum (somente gestor)</option>
                    {funcionarios.map(f => (
                      <option key={f.id} value={f.id}>{f.nome}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-400 mt-1 font-semibold">
                    Responsável de equipe: vincula o login ao funcionário para acessar as O.S da equipe.
                  </p>
                  {funcionarios.length === 0 && (
                    <p className="text-[10px] text-rose-500 mt-1 font-bold">
                      Nenhum funcionário cadastrado — cadastre em Funcionários para poder vincular.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Senha {editingId ? '(deixe vazio para manter)' : '*'}
                  </label>
                  <input
                    type="password"
                    name="senha"
                    value={formData.senha}
                    onChange={handleInputChange}
                    required={!editingId}
                    placeholder={editingId ? '••••••••' : 'Mínimo 4 caracteres'}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                  />
                </div>

                <div className="col-span-1 md:col-span-2 flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                  <input
                    type="checkbox"
                    name="ativo"
                    checked={formData.ativo}
                    onChange={handleInputChange}
                    className="w-4 h-4 accent-primary-600 cursor-pointer"
                  />
                  <label className="text-sm font-semibold text-slate-700 cursor-pointer">Usuário ativo (pode acessar o sistema)</label>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Acesso aos Módulos</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {MODULOS.map((mod) => (
                    <label
                      key={mod.id}
                      className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all cursor-pointer ${
                        formData.permissoes.includes(mod.id)
                          ? 'bg-primary-50 border-primary-200'
                          : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={formData.permissoes.includes(mod.id)}
                        onChange={() => togglePermissao(mod.id)}
                        className="w-4 h-4 accent-primary-600 cursor-pointer"
                      />
                      <span className="text-sm font-semibold text-slate-700">{mod.label}</span>
                    </label>
                  ))}
                </div>
              </div>

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
                  {editingId ? 'Salvar Alterações' : 'Cadastrar Usuário'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ModalConfirmacao
        aberto={confirmarExclusao != null}
        titulo="Excluir usuário"
        mensagem={`Tem certeza que deseja excluir o usuário "${confirmarExclusao?.nome || ''}"? Esta ação não pode ser desfeita.`}
        onConfirmar={excluirUsuario}
        onCancelar={() => setConfirmarExclusao(null)}
      />
    </div>
  );
}

export default Configuracoes;
