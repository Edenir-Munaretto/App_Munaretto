import React, { useState, useEffect } from 'react';
import { Search, Plus, Edit2, Trash2, X, Check, AlertTriangle, Users, Briefcase } from 'lucide-react';
import { API_URL, apiFetch } from '../api';

function Clientes({ usuarioAtual }) {
  const [tab, setTab] = useState('clientes');
  const [clientes, setClientes] = useState([]);
  const [busca, setBusca] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  
  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    nome: '',
    cpf_cnpj: '',
    endereco: '',
    cidade: '',
    cep: '',
    nota_ps: '',
    valor_da_obra: '',
    valor_de_devolucao: ''
  });

  // Funcionários
  const [funcionarios, setFuncionarios] = useState([]);
  const [funcBusca, setFuncBusca] = useState('');
  const [funcLoading, setFuncLoading] = useState(true);
  const [showFuncModal, setShowFuncModal] = useState(false);
  const [funcEditingId, setFuncEditingId] = useState(null);
  const [funcForm, setFuncForm] = useState({ nome: '', cpf: '', cargo_id: '' });
  const [cargos, setCargos] = useState([]);
  const temSst = (usuarioAtual?.permissoes || []).includes('sst');

  useEffect(() => {
    fetchClientes();
  }, [busca]);

  useEffect(() => {
    fetchFuncionarios();
  }, [funcBusca]);

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

  const fetchClientes = async () => {
    try {
      setLoading(true);
      const url = busca ? `${API_URL}/clientes/?busca=${encodeURIComponent(busca)}` : `${API_URL}/clientes/`;
      const res = await apiFetch(url);
      if (res.ok) {
        const data = await res.json();
        setClientes(data);
      }
    } catch (err) {
      console.error('Erro ao buscar clientes:', err);
      showToast('Erro de conexão ao buscar clientes', 'error');
    } finally {
      setLoading(false);
    }
  };

  const openAddModal = () => {
    setEditingId(null);
    setFormData({
      nome: '',
      cpf_cnpj: '',
      endereco: '',
      cidade: '',
      cep: '',
      nota_ps: '',
      valor_da_obra: '',
      valor_de_devolucao: ''
    });
    setShowModal(true);
  };

  const openEditModal = (cliente) => {
    setEditingId(cliente.id);
    setFormData({
      nome: cliente.nome,
      cpf_cnpj: cliente.cpf_cnpj,
      endereco: cliente.endereco,
      cidade: cliente.cidade || '',
      cep: cliente.cep || '',
      nota_ps: cliente.nota_ps || '',
      valor_da_obra: cliente.valor_da_obra || '',
      valor_de_devolucao: cliente.valor_de_devolucao || ''
    });
    setShowModal(true);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.nome || !formData.cpf_cnpj || !formData.endereco) {
      showToast('Nome, CPF/CNPJ e Endereço são obrigatórios.', 'error');
      return;
    }

    try {
      const method = editingId ? 'PUT' : 'POST';
      const url = editingId ? `${API_URL}/clientes/${editingId}` : `${API_URL}/clientes/`;
      
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const resData = await res.json();

      if (res.ok) {
        showToast(editingId ? 'Cliente atualizado com sucesso!' : 'Cliente cadastrado com sucesso!');
        setShowModal(false);
        fetchClientes();
      } else {
        showToast(resData.detail || 'Erro ao salvar cliente.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro ao salvar cliente.', 'error');
    }
  };

  const handleDelete = async (id, nome) => {
    if (!window.confirm(`Tem certeza que deseja inativar o cliente "${nome}"?`)) return;

    try {
      const res = await apiFetch(`${API_URL}/clientes/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Cliente excluído com sucesso.');
        fetchClientes();
      } else {
        showToast('Erro ao excluir cliente.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao excluir cliente.', 'error');
    }
  };

  // ---- Funcionários ----
  const fetchFuncionarios = async () => {
    try {
      setFuncLoading(true);
      const url = funcBusca ? `${API_URL}/funcionarios/?busca=${encodeURIComponent(funcBusca)}` : `${API_URL}/funcionarios/`;
      const res = await apiFetch(url);
      if (res.ok) {
        const data = await res.json();
        setFuncionarios(data);
      }
    } catch (err) {
      console.error('Erro ao buscar funcionários:', err);
      showToast('Erro de conexão ao buscar funcionários', 'error');
    } finally {
      setFuncLoading(false);
    }
  };

  const openAddFuncModal = () => {
    setFuncEditingId(null);
    setFuncForm({ nome: '', cpf: '', cargo_id: '' });
    setShowFuncModal(true);
  };

  const openEditFuncModal = (f) => {
    setFuncEditingId(f.id);
    setFuncForm({ nome: f.nome, cpf: f.cpf, cargo_id: f.cargo_id || '' });
    setShowFuncModal(true);
  };

  const handleFuncInputChange = (e) => {
    const { name, value } = e.target;
    setFuncForm(prev => ({ ...prev, [name]: value }));
  };

  const handleFuncSubmit = async (e) => {
    e.preventDefault();
    if (!funcForm.nome || !funcForm.cpf) {
      showToast('Nome e CPF são obrigatórios.', 'error');
      return;
    }

    const payload = {
      nome: funcForm.nome,
      cpf: funcForm.cpf,
      cargo_id: funcForm.cargo_id ? Number(funcForm.cargo_id) : null
    };

    try {
      const method = funcEditingId ? 'PUT' : 'POST';
      const url = funcEditingId ? `${API_URL}/funcionarios/${funcEditingId}` : `${API_URL}/funcionarios/`;

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const resData = await res.json();

      if (res.ok) {
        showToast(funcEditingId ? 'Funcionário atualizado com sucesso!' : 'Funcionário cadastrado com sucesso!');
        setShowFuncModal(false);
        fetchFuncionarios();
      } else {
        showToast(resData.detail || 'Erro ao salvar funcionário.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro ao salvar funcionário.', 'error');
    }
  };

  const handleFuncDelete = async (id, nome) => {
    if (!window.confirm(`Tem certeza que deseja inativar o funcionário "${nome}"?`)) return;

    try {
      const res = await apiFetch(`${API_URL}/funcionarios/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Funcionário excluído com sucesso.');
        fetchFuncionarios();
      } else {
        showToast('Erro ao excluir funcionário.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao excluir funcionário.', 'error');
    }
  };

  return (
    <div className="space-y-6 relative">
      
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 p-4 rounded-xl shadow-xl flex items-center gap-3 border text-sm max-w-sm animate-in slide-in-from-top-4 duration-300 ${
          toast.type === 'error' 
            ? 'bg-rose-50 border-rose-200 text-rose-800' 
            : 'bg-emerald-50 border-emerald-200 text-emerald-800'
        }`}>
          <div className={`p-1 rounded-full ${toast.type === 'error' ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'}`}>
            {toast.type === 'error' ? <AlertTriangle size={16} /> : <Check size={16} />}
          </div>
          <p className="font-semibold">{toast.message}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setTab('clientes')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold border transition-all ${
            tab === 'clientes'
              ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Users size={16} />
          Clientes
        </button>
        <button
          onClick={() => setTab('funcionarios')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold border transition-all ${
            tab === 'funcionarios'
              ? 'bg-primary-600 border-primary-600 text-white shadow-md shadow-primary-900/10'
              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Briefcase size={16} />
          Funcionários
        </button>
      </div>

      {tab === 'clientes' && (
        <>
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        
        {/* Search */}
        <div className="relative w-full sm:w-96">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
            <Search size={18} />
          </span>
          <input
            type="text"
            placeholder="Buscar por nome, CPF ou CNPJ..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all text-sm"
          />
        </div>

        {/* Add Button */}
        <button
          onClick={openAddModal}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl font-semibold text-sm hover:bg-primary-700 transition-all shadow-md shadow-primary-900/10 cursor-pointer"
        >
          <Plus size={18} />
          Cadastrar Cliente
        </button>
      </div>

      {/* List / Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-bold text-xs uppercase tracking-wider">
                <th className="px-3 py-3 md:px-6 md:py-4">Nome</th>
                <th className="px-3 py-3 md:px-6 md:py-4">CPF/CNPJ</th>
                <th className="px-3 py-3 md:px-6 md:py-4">Endereço</th>
                <th className="px-3 py-3 md:px-6 md:py-4">Cidade</th>
                <th className="px-3 py-3 md:px-6 md:py-4">Valor Obra</th>
                <th className="px-3 py-3 md:px-6 md:py-4 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan="6" className="text-center py-12 text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
                      <p className="text-xs">Buscando clientes...</p>
                    </div>
                  </td>
                </tr>
              ) : clientes.length === 0 ? (
                <tr>
                  <td colSpan="6" className="text-center py-16 text-slate-400">
                    <span className="text-3xl">👥</span>
                    <p className="font-semibold mt-2">Nenhum cliente ativo encontrado.</p>
                    <p className="text-xs mt-1">Cadastre um novo cliente no botão acima para iniciar.</p>
                  </td>
                </tr>
              ) : (
                clientes.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-3 py-3 md:px-6 md:py-4 font-bold text-slate-900">{c.nome}</td>
                    <td className="px-3 py-3 md:px-6 md:py-4 font-mono text-xs">{c.cpf_cnpj}</td>
                    <td className="px-3 py-3 md:px-6 md:py-4 truncate max-w-[200px]">{c.endereco}</td>
                    <td className="px-3 py-3 md:px-6 md:py-4">{c.cidade || '-'}</td>
                    <td className="px-3 py-3 md:px-6 md:py-4 text-emerald-600 font-semibold">{c.valor_da_obra ? `R$ ${c.valor_da_obra}` : '-'}</td>
                    <td className="px-3 py-3 md:px-6 md:py-4">
                      <div className="flex justify-center items-center gap-2">
                        <button
                          onClick={() => openEditModal(c)}
                          className="p-2 rounded bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-700 border border-slate-100 transition-colors"
                          title="Editar"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => handleDelete(c.id, c.nome)}
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

      {/* CRUD MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            
            {/* Header */}
            <div className="bg-slate-900 text-white px-3 py-3 md:px-6 md:py-4 flex items-center justify-between">
              <h3 className="font-bold text-lg">
                {editingId ? '👤 Editar Cadastro de Cliente' : '👤 Novo Cadastro de Cliente'}
              </h3>
              <button 
                onClick={() => setShowModal(false)} 
                className="text-slate-400 hover:text-white text-xl font-bold"
              >
                &times;
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Informações Cadastrais</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  
                  {/* Nome */}
                  <div className="col-span-1 md:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Nome Completo *</label>
                    <input
                      type="text"
                      name="nome"
                      value={formData.nome}
                      onChange={handleInputChange}
                      required
                      placeholder="Ex: Edenir Munaretto"
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                    />
                  </div>

                  {/* CPF/CNPJ */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">CPF ou CNPJ *</label>
                    <input
                      type="text"
                      name="cpf_cnpj"
                      value={formData.cpf_cnpj}
                      onChange={handleInputChange}
                      required
                      placeholder="Apenas números ou formatado"
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                    />
                  </div>

                  {/* Cidade */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Cidade</label>
                    <input
                      type="text"
                      name="cidade"
                      value={formData.cidade}
                      onChange={handleInputChange}
                      placeholder="Ex: Joaçaba"
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                    />
                  </div>

                  {/* Endereço */}
                  <div className="col-span-1 md:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Endereço Completo *</label>
                    <input
                      type="text"
                      name="endereco"
                      value={formData.endereco}
                      onChange={handleInputChange}
                      required
                      placeholder="Rua, Número, Bairro, CEP"
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                    />
                  </div>

                  {/* CEP */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">CEP</label>
                    <input
                      type="text"
                      name="cep"
                      value={formData.cep}
                      onChange={handleInputChange}
                      placeholder="Ex: 89600-000"
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                    />
                  </div>

                  {/* Nota PS */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Nota PS</label>
                    <input
                      type="text"
                      name="nota_ps"
                      value={formData.nota_ps}
                      onChange={handleInputChange}
                      placeholder="Nota fiscal ou de serviço"
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                    />
                  </div>

                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Dados Financeiros e Contratuais</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  
                  {/* Valor da Obra */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Valor da Obra (R$)</label>
                    <input
                      type="text"
                      name="valor_da_obra"
                      value={formData.valor_da_obra}
                      onChange={handleInputChange}
                      placeholder="Ex: 25.000,00"
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold text-emerald-700"
                    />
                  </div>

                  {/* Valor de Devolução */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Valor de Devolução (R$)</label>
                    <input
                      type="text"
                      name="valor_de_devolucao"
                      value={formData.valor_de_devolucao}
                      onChange={handleInputChange}
                      placeholder="Ex: 500,00"
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold text-amber-700"
                    />
                  </div>

                </div>
              </div>

              {/* Action Buttons */}
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
                  {editingId ? 'Salvar Alterações' : 'Cadastrar Cliente'}
                </button>
              </div>

            </form>

          </div>
        </div>
      )}
        </>
      )}

      {tab === 'funcionarios' && (
        <>
          {/* Header Funcionários */}
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">

            <div className="relative w-full sm:w-96">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <Search size={18} />
              </span>
              <input
                type="text"
                placeholder="Buscar funcionário por nome ou CPF..."
                value={funcBusca}
                onChange={(e) => setFuncBusca(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all text-sm"
              />
            </div>

            <button
              onClick={openAddFuncModal}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl font-semibold text-sm hover:bg-primary-700 transition-all shadow-md shadow-primary-900/10 cursor-pointer"
            >
              <Plus size={18} />
              Cadastrar Funcionário
            </button>
          </div>

          {/* Lista Funcionários */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-bold text-xs uppercase tracking-wider">
                    <th className="px-3 py-3 md:px-6 md:py-4">Nome</th>
                    <th className="px-3 py-3 md:px-6 md:py-4">CPF</th>
                    {temSst && <th className="px-3 py-3 md:px-6 md:py-4">Cargo</th>}
                    <th className="px-3 py-3 md:px-6 md:py-4 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {funcLoading ? (
                    <tr>
                      <td colSpan={temSst ? 4 : 3} className="text-center py-12 text-slate-400">
                        <div className="flex flex-col items-center justify-center gap-3">
                          <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
                          <p className="text-xs">Buscando funcionários...</p>
                        </div>
                      </td>
                    </tr>
                  ) : funcionarios.length === 0 ? (
                    <tr>
                      <td colSpan={temSst ? 4 : 3} className="text-center py-16 text-slate-400">
                        <span className="text-3xl">🧑‍🏭</span>
                        <p className="font-semibold mt-2">Nenhum funcionário cadastrado.</p>
                        <p className="text-xs mt-1">Cadastre funcionários para usar como lista ao lançar férias.</p>
                      </td>
                    </tr>
                  ) : (
                    funcionarios.map((f) => (
                      <tr key={f.id} className="hover:bg-slate-50/50 transition-colors">
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
                          <div className="flex justify-center items-center gap-2">
                            <button
                              onClick={() => openEditFuncModal(f)}
                              className="p-2 rounded bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-700 border border-slate-100 transition-colors"
                              title="Editar"
                            >
                              <Edit2 size={15} />
                            </button>
                            <button
                              onClick={() => handleFuncDelete(f.id, f.nome)}
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

          {/* Modal Funcionário */}
          {showFuncModal && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="bg-slate-900 text-white px-3 py-3 md:px-6 md:py-4 flex items-center justify-between">
                  <h3 className="font-bold text-lg">
                    {funcEditingId ? '🧑‍🏭 Editar Funcionário' : '🧑‍🏭 Novo Funcionário'}
                  </h3>
                  <button
                    onClick={() => setShowFuncModal(false)}
                    className="text-slate-400 hover:text-white text-xl font-bold"
                  >
                    &times;
                  </button>
                </div>

                <form onSubmit={handleFuncSubmit} className="p-6 space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Nome Completo *</label>
                    <input
                      type="text"
                      name="nome"
                      value={funcForm.nome}
                      onChange={handleFuncInputChange}
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
                      value={funcForm.cpf}
                      onChange={handleFuncInputChange}
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
                        value={funcForm.cargo_id}
                        onChange={handleFuncInputChange}
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
                      onClick={() => setShowFuncModal(false)}
                      className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-all cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-all shadow-md shadow-primary-900/10 cursor-pointer"
                    >
                      {funcEditingId ? 'Salvar Alterações' : 'Cadastrar Funcionário'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}

    </div>
  );
}

export default Clientes;
