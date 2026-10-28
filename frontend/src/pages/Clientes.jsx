import React, { useState, useEffect } from 'react';
import { Search, Plus, Edit2, Trash2, Check, AlertTriangle, Users, ChevronLeft, ChevronRight, Building2, MapPin } from 'lucide-react';
import { API_URL, apiFetch, erroDaResposta } from '../api';
import ModalConfirmacao from '../components/ModalConfirmacao';
import ErroCarregamento from '../components/ErroCarregamento';
import { useFetchState } from '../hooks/useFetchState';

function Clientes() {
  const [clientes, setClientes] = useState([]);
  const [busca, setBusca] = useState('');
  const [loading, setLoading] = useState(true);
  const lista = useFetchState();
  const [toast, setToast] = useState(null);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
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

  // Exclusão com confirmação customizada
  const [excluindo, setExcluindo] = useState(null); // { id, nome }
  const [deleting, setDeleting] = useState(false);

  // Obras adicionais do cliente
  const [clienteObras, setClienteObras] = useState(null);

  // Paginação visual (50 por página)
  const REGISTROS_POR_PAGINA = 50;
  const [paginaAtual, setPaginaAtual] = useState(1);

  useEffect(() => {
    fetchClientes();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchClientes = async () => {
    lista.iniciar();
    try {
      const url = busca ? `${API_URL}/clientes/?busca=${encodeURIComponent(busca)}` : `${API_URL}/clientes/`;
      const res = await apiFetch(url, { retry: 2 });
      if (res.ok) {
        const data = await res.json();
        setClientes(data);
        lista.sucesso();
      } else {
        lista.falhar(erroDaResposta(await res.json().catch(() => null), 'Erro ao buscar clientes.'));
      }
    } catch (err) {
      console.error('Erro ao buscar clientes:', err);
      lista.falhar('Erro de conexão ao buscar clientes.');
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
      setSubmitting(true);
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
        showToast(erroDaResposta(resData, 'Erro ao salvar cliente.'), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro ao salvar cliente.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!excluindo) return;
    try {
      setDeleting(true);
      const res = await apiFetch(`${API_URL}/clientes/${excluindo.id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Cliente excluído com sucesso.');
        fetchClientes();
      } else {
        showToast('Erro ao excluir cliente.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao excluir cliente.', 'error');
    } finally {
      setDeleting(false);
      setExcluindo(null);
    }
  };

  // Paginação visual
  const totalPaginas = Math.max(1, Math.ceil(clientes.length / REGISTROS_POR_PAGINA));
  const paginaAtualSegura = Math.min(paginaAtual, totalPaginas);
  const clientesPagina = clientes.slice(
    (paginaAtualSegura - 1) * REGISTROS_POR_PAGINA,
    paginaAtualSegura * REGISTROS_POR_PAGINA
  );

  useEffect(() => {
    setPaginaAtual(1);
  }, [busca]);

  return (
    <div className="space-y-6 relative">

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[70] p-4 rounded-xl shadow-xl flex items-center gap-3 border text-sm max-w-sm animate-in slide-in-from-top-4 duration-300 ${
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
        <div className="hidden md:block overflow-x-auto">
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
) : lista.status === 'error' ? (
                <tr>
                  <td colSpan="6">
                    <ErroCarregamento mensagem={lista.erro} onTentarNovamente={fetchClientes} />
                  </td>
                </tr>
              ) : clientes.length === 0 ? (
                <tr>
                  <td colSpan="6" className="text-center py-16 text-slate-400">
                    <Users className="mx-auto mb-3 text-slate-300" size={40} />
                    <p className="font-semibold mt-2">Nenhum cliente ativo encontrado.</p>
                    <p className="text-xs mt-1">Cadastre um novo cliente no botão acima para iniciar.</p>
                  </td>
                </tr>
              ) : (
                clientesPagina.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-3 py-3 md:px-6 md:py-4 font-bold text-slate-900">{c.nome}</td>
                    <td className="px-3 py-3 md:px-6 md:py-4 font-mono text-xs">{c.cpf_cnpj}</td>
                    <td className="px-3 py-3 md:px-6 md:py-4 truncate max-w-[200px]">{c.endereco}</td>
                    <td className="px-3 py-3 md:px-6 md:py-4">{c.cidade || '-'}</td>
                    <td className="px-3 py-3 md:px-6 md:py-4 text-emerald-600 font-semibold">{c.valor_da_obra ? `R$ ${c.valor_da_obra}` : '-'}</td>
                    <td className="px-3 py-3 md:px-6 md:py-4">
                      <div className="flex justify-center items-center gap-2">
                        <button
                          onClick={() => setClienteObras(c)}
                          className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-primary-50 text-slate-500 hover:text-primary-700 border border-slate-100 transition-colors"
                          title="Obras adicionais"
                        >
                          <Building2 size={15} />
                        </button>
                        <button
                          onClick={() => openEditModal(c)}
                          className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-700 border border-slate-100 transition-colors"
                          title="Editar"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => setExcluindo({ id: c.id, nome: c.nome })}
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

        {/* Lista em cartões (mobile) */}
        <div className="md:hidden divide-y divide-slate-100">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs">Buscando clientes...</p>
            </div>
          ) : lista.status === 'error' ? (
            <ErroCarregamento mensagem={lista.erro} onTentarNovamente={fetchClientes} />
          ) : clientes.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Users className="mx-auto mb-3 text-slate-300" size={40} />
              <p className="font-semibold mt-2">Nenhum cliente ativo encontrado.</p>
              <p className="text-xs mt-1">Cadastre um novo cliente no botão acima para iniciar.</p>
            </div>
          ) : (
            clientesPagina.map((c) => (
              <div key={c.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-slate-900 text-sm truncate">{c.nome}</p>
                  <p className="font-mono text-xs text-slate-500 mt-0.5">{c.cpf_cnpj}</p>
                  {c.endereco && (
                    <p className="text-xs text-slate-600 mt-1 truncate">{c.endereco}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs">
                    {c.cidade && <span className="text-slate-500">📍 {c.cidade}</span>}
                    <span className="text-emerald-600 font-semibold">
                      {c.valor_da_obra ? `R$ ${c.valor_da_obra}` : '-'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setClienteObras(c)}
                    className="w-11 h-11 flex items-center justify-center rounded bg-slate-50 hover:bg-primary-50 text-slate-500 hover:text-primary-700 border border-slate-100 transition-colors"
                    title="Obras adicionais"
                  >
                    <Building2 size={15} />
                  </button>
                  <button
                    onClick={() => openEditModal(c)}
                    className="w-11 h-11 flex items-center justify-center rounded bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-700 border border-slate-100 transition-colors"
                    title="Editar"
                  >
                    <Edit2 size={15} />
                  </button>
                  <button
                    onClick={() => setExcluindo({ id: c.id, nome: c.nome })}
                    className="w-11 h-11 flex items-center justify-center rounded bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-100 transition-colors"
                    title="Excluir"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Paginação */}
      {!loading && clientes.length > REGISTROS_POR_PAGINA && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-xs text-slate-500 font-semibold">
            Mostrando {((paginaAtualSegura - 1) * REGISTROS_POR_PAGINA) + 1}–
            {Math.min(paginaAtualSegura * REGISTROS_POR_PAGINA, clientes.length)} de {clientes.length} cliente(s)
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPaginaAtual(p => Math.max(1, p - 1))}
              disabled={paginaAtualSegura === 1}
              className="px-3 py-1.5 min-h-11 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all cursor-pointer disabled:opacity-40 flex items-center gap-1"
            >
              <ChevronLeft size={14} />
              Anterior
            </button>
            <span className="text-xs font-bold text-slate-600 px-2">
              {paginaAtualSegura} / {totalPaginas}
            </span>
            <button
              onClick={() => setPaginaAtual(p => Math.min(totalPaginas, p + 1))}
              disabled={paginaAtualSegura === totalPaginas}
              className="px-3 py-1.5 min-h-11 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all cursor-pointer disabled:opacity-40 flex items-center gap-1"
            >
              Próximo
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

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
                className="text-slate-400 hover:text-white text-xl font-bold cursor-pointer"
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
                  disabled={submitting}
                  className="px-5 py-2 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-all shadow-md shadow-primary-900/10 cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  {submitting ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    editingId ? 'Salvar Alterações' : 'Cadastrar Cliente'
                  )}
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

      {/* Modal de confirmação de exclusão */}
      <ModalConfirmacao
        aberto={excluindo != null}
        titulo="Inativar cliente"
        mensagem={excluindo ? `Tem certeza que deseja inativar o cliente "${excluindo.nome}"? Esta ação não pode ser desfeita.` : ''}
        loading={deleting}
        onConfirmar={handleDelete}
        onCancelar={() => setExcluindo(null)}
      />

      {clienteObras && (
        <ModalObrasCliente
          cliente={clienteObras}
          onFechar={() => setClienteObras(null)}
          showToast={showToast}
        />
      )}

    </div>
  );
}

// ---------------------------------------------------------------------------
// Obras adicionais do cliente (tabela `obras_cliente`).
// A primeira obra continua no cadastro do cliente; aqui ficam as seguintes.
// ---------------------------------------------------------------------------
const OBRA_CLIENTE_VAZIA = {
  nome: '',
  nota_ps: '',
  endereco: '',
  cidade: '',
  cep: '',
  valor_da_obra: '',
  valor_de_devolucao: ''
};

function ModalObrasCliente({ cliente, onFechar, showToast }) {
  const [obras, setObras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [formAberto, setFormAberto] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(null);
  const [deletando, setDeletando] = useState(false);
  const [formData, setFormData] = useState(OBRA_CLIENTE_VAZIA);

  const carregarObras = async () => {
    setLoading(true);
    setErro('');
    try {
      const res = await apiFetch(`${API_URL}/clientes/${cliente.id}/obras`);
      if (!res.ok) {
        setErro(erroDaResposta(await res.json().catch(() => null), 'Erro ao buscar obras.'));
        return;
      }
      setObras(await res.json());
    } catch {
      setErro('Erro de conexão ao buscar obras.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarObras();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente.id]);

  const abrirNovaObra = () => {
    setEditandoId(null);
    setFormData(OBRA_CLIENTE_VAZIA);
    setFormAberto(true);
  };

  const abrirEdicao = (obra) => {
    setEditandoId(obra.id);
    setFormData({
      nome: obra.nome || '',
      nota_ps: obra.nota_ps || '',
      endereco: obra.endereco || '',
      cidade: obra.cidade || '',
      cep: obra.cep || '',
      valor_da_obra: obra.valor_da_obra || '',
      valor_de_devolucao: obra.valor_de_devolucao || ''
    });
    setFormAberto(true);
  };

  const salvarObra = async (e) => {
    e.preventDefault();
    if (!formData.nome.trim()) {
      showToast('Informe a identificação da obra.', 'error');
      return;
    }
    try {
      setSalvando(true);
      const url = editandoId
        ? `${API_URL}/clientes/${cliente.id}/obras/${editandoId}`
        : `${API_URL}/clientes/${cliente.id}/obras`;
      const res = await apiFetch(url, {
        method: editandoId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const dados = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(erroDaResposta(dados, 'Erro ao salvar obra.'), 'error');
        return;
      }
      showToast(editandoId ? 'Obra atualizada com sucesso!' : 'Obra cadastrada com sucesso!');
      setFormAberto(false);
      setEditandoId(null);
      setFormData(OBRA_CLIENTE_VAZIA);
      carregarObras();
    } catch {
      showToast('Erro de conexão ao salvar obra.', 'error');
    } finally {
      setSalvando(false);
    }
  };

  const confirmarExclusao = async () => {
    if (!excluindo) return;
    try {
      setDeletando(true);
      const res = await apiFetch(
        `${API_URL}/clientes/${cliente.id}/obras/${excluindo.id}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        showToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao excluir obra.'), 'error');
        return;
      }
      showToast('Obra excluída com sucesso.');
      setExcluindo(null);
      carregarObras();
    } catch {
      showToast('Erro de conexão ao excluir obra.', 'error');
    } finally {
      setDeletando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[92vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-bold text-lg flex items-center gap-2">
              <Building2 size={18} /> Obras de {cliente.nome}
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              A primeira obra fica no cadastro do cliente. Aqui ficam as obras adicionais.
            </p>
          </div>
          <button
            onClick={onFechar}
            className="text-slate-400 hover:text-white cursor-pointer text-xl font-bold"
            title="Fechar"
          >
            &times;
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {!formAberto && (
            <div className="flex justify-end">
              <button
                onClick={abrirNovaObra}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-xs font-bold hover:bg-primary-700 transition-all shadow-sm cursor-pointer"
              >
                <Plus size={14} /> Nova obra
              </button>
            </div>
          )}

          {formAberto && (
            <form onSubmit={salvarObra} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">
                  {editandoId ? 'Editar obra' : 'Nova obra'}
                </h4>
                <button
                  type="button"
                  onClick={() => { setFormAberto(false); setEditandoId(null); }}
                  className="text-slate-400 hover:text-slate-700 cursor-pointer"
                  title="Cancelar"
                >
                  &times;
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">Identificação da Obra *</label>
                  <input
                    type="text"
                    value={formData.nome}
                    onChange={e => setFormData({ ...formData, nome: e.target.value })}
                    required
                    placeholder="Ex: Obra Residencial Centro"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">Nota PS / Projeto</label>
                  <input
                    type="text"
                    value={formData.nota_ps}
                    onChange={e => setFormData({ ...formData, nota_ps: e.target.value })}
                    placeholder="Ex: 400774969"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">CEP</label>
                  <input
                    type="text"
                    value={formData.cep}
                    onChange={e => setFormData({ ...formData, cep: e.target.value })}
                    placeholder="Ex: 89600-000"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">Endereço da Obra</label>
                  <input
                    type="text"
                    value={formData.endereco}
                    onChange={e => setFormData({ ...formData, endereco: e.target.value })}
                    placeholder="Rua, Número, Bairro"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">Cidade</label>
                  <input
                    type="text"
                    value={formData.cidade}
                    onChange={e => setFormData({ ...formData, cidade: e.target.value })}
                    placeholder="Ex: Joaçaba"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">Valor da Obra (R$)</label>
                  <input
                    type="text"
                    value={formData.valor_da_obra}
                    onChange={e => setFormData({ ...formData, valor_da_obra: e.target.value })}
                    placeholder="Ex: 25.000,00"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-emerald-700 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">Valor de Devolução (R$)</label>
                  <input
                    type="text"
                    value={formData.valor_de_devolucao}
                    onChange={e => setFormData({ ...formData, valor_de_devolucao: e.target.value })}
                    placeholder="Ex: 500,00"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-amber-700 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => { setFormAberto(false); setEditandoId(null); }}
                  className="px-3 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-100 transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando}
                  className="px-4 py-2 bg-primary-600 text-white rounded-xl text-xs font-bold hover:bg-primary-700 transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                >
                  {salvando ? 'Salvando...' : editandoId ? 'Salvar Alterações' : 'Cadastrar Obra'}
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-400">
              <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs">Buscando obras...</p>
            </div>
          ) : erro ? (
            <ErroCarregamento mensagem={erro} onTentarNovamente={carregarObras} />
          ) : obras.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Building2 className="mx-auto mb-3 text-slate-300" size={40} />
              <p className="font-semibold">Nenhuma obra adicional cadastrada.</p>
              <p className="text-xs mt-1">Use “Nova obra” para cadastrar a segunda obra deste cliente.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {obras.map((obra) => (
                <div key={obra.id} className="border border-slate-200 rounded-2xl p-4 hover:border-primary-200 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 text-sm truncate">{obra.nome}</p>
                      {obra.nota_ps && (
                        <p className="text-[11px] text-slate-500 font-mono mt-0.5">Nota PS: {obra.nota_ps}</p>
                      )}
                      {(obra.endereco || obra.cidade) && (
                        <p className="flex items-start gap-1 text-[11px] text-slate-500 mt-1">
                          <MapPin size={11} className="mt-0.5 shrink-0" />
                          <span>{[obra.endereco, obra.cidade].filter(Boolean).join(' · ')}</span>
                        </p>
                      )}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px]">
                        <span className="text-emerald-700 font-bold">
                          Valor: {obra.valor_da_obra ? `R$ ${obra.valor_da_obra}` : '-'}
                        </span>
                        <span className="text-amber-700 font-bold">
                          Devolução: {obra.valor_de_devolucao ? `R$ ${obra.valor_de_devolucao}` : '-'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => abrirEdicao(obra)}
                        className="w-10 h-10 flex items-center justify-center rounded bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-700 border border-slate-100 transition-colors cursor-pointer"
                        title="Editar obra"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => setExcluindo(obra)}
                        className="w-10 h-10 flex items-center justify-center rounded bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-100 transition-colors cursor-pointer"
                        title="Excluir obra"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ModalConfirmacao
        aberto={excluindo != null}
        titulo="Excluir obra"
        mensagem={excluindo ? `Tem certeza que deseja excluir a obra "${excluindo.nome}"?` : ''}
        loading={deletando}
        onConfirmar={confirmarExclusao}
        onCancelar={() => setExcluindo(null)}
      />
    </div>
  );
}

export default Clientes;
