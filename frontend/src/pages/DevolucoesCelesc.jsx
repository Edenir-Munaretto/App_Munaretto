import React, { useState, useEffect } from 'react';
import { Search, Plus, Edit2, Trash2, Check, AlertTriangle, PackageCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { API_URL, apiFetch, erroDaResposta } from '../api';
import ModalConfirmacao from '../components/ModalConfirmacao';
import ErroCarregamento from '../components/ErroCarregamento';
import { useFetchState } from '../hooks/useFetchState';

const STATUS_FILTROS = ['Todos', 'Aberto', 'Fechado'];

const formatarData = (data) => {
  if (!data) return '—';
  return new Date(`${String(data).slice(0, 10)}T00:00:00`).toLocaleDateString('pt-BR');
};

const BadgeStatus = ({ status }) => (
  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
    status === 'Fechado'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : 'bg-amber-50 text-amber-700 border-amber-200'
  }`}>
    <span className={`w-1.5 h-1.5 rounded-full ${status === 'Fechado' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
    {status}
  </span>
);

function DevolucoesCelesc() {
  const [devolucoes, setDevolucoes] = useState([]);
  const [busca, setBusca] = useState('');
  const [statusFiltro, setStatusFiltro] = useState('Todos');
  const [loading, setLoading] = useState(true);
  const lista = useFetchState();
  const [toast, setToast] = useState(null);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    consumidor: '',
    nota_ps: '',
    data_entrega: '',
    data_devolucao: ''
  });

  // Exclusão com confirmação customizada
  const [excluindo, setExcluindo] = useState(null); // { id, consumidor }
  const [deleting, setDeleting] = useState(false);

  // Paginação visual (50 por página)
  const REGISTROS_POR_PAGINA = 50;
  const [paginaAtual, setPaginaAtual] = useState(1);

  useEffect(() => {
    fetchDevolucoes();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, statusFiltro]);

  useEffect(() => {
    setPaginaAtual(1);
  }, [busca, statusFiltro]);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchDevolucoes = async () => {
    lista.iniciar();
    try {
      const params = new URLSearchParams();
      if (busca) params.set('busca', busca);
      if (statusFiltro !== 'Todos') params.set('status', statusFiltro);
      const query = params.toString();
      const url = `${API_URL}/devolucoes-celesc/${query ? `?${query}` : ''}`;

      const res = await apiFetch(url, { retry: 2 });
      if (res.ok) {
        const data = await res.json();
        setDevolucoes(data);
        lista.sucesso();
      } else {
        lista.falhar(erroDaResposta(await res.json().catch(() => null), 'Erro ao buscar devoluções.'));
      }
    } catch (err) {
      console.error('Erro ao buscar devoluções:', err);
      lista.falhar('Erro de conexão ao buscar devoluções.');
    } finally {
      setLoading(false);
    }
  };

  const openAddModal = () => {
    setEditingId(null);
    setFormData({ consumidor: '', nota_ps: '', data_entrega: '', data_devolucao: '' });
    setShowModal(true);
  };

  const openEditModal = (devolucao) => {
    setEditingId(devolucao.id);
    setFormData({
      consumidor: devolucao.consumidor || '',
      nota_ps: devolucao.nota_ps || '',
      data_entrega: (devolucao.data_entrega || '').slice(0, 10),
      data_devolucao: (devolucao.data_devolucao || '').slice(0, 10)
    });
    setShowModal(true);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.consumidor.trim() || !formData.data_entrega) {
      showToast('Consumidor e Data de Entrega são obrigatórios.', 'error');
      return;
    }
    if (formData.data_devolucao && formData.data_devolucao < formData.data_entrega) {
      showToast('A data de devolução não pode ser anterior à data de entrega.', 'error');
      return;
    }

    try {
      setSubmitting(true);
      const method = editingId ? 'PUT' : 'POST';
      const url = editingId ? `${API_URL}/devolucoes-celesc/${editingId}` : `${API_URL}/devolucoes-celesc/`;

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consumidor: formData.consumidor.trim(),
          nota_ps: formData.nota_ps.trim() || null,
          data_entrega: formData.data_entrega,
          data_devolucao: formData.data_devolucao || null
        })
      });

      const resData = await res.json();

      if (res.ok) {
        showToast(editingId ? 'Devolução atualizada com sucesso!' : 'Devolução cadastrada com sucesso!');
        setShowModal(false);
        fetchDevolucoes();
      } else {
        showToast(erroDaResposta(resData, 'Erro ao salvar devolução.'), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro ao salvar devolução.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!excluindo) return;
    try {
      setDeleting(true);
      const res = await apiFetch(`${API_URL}/devolucoes-celesc/${excluindo.id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Devolução excluída com sucesso.');
        fetchDevolucoes();
      } else {
        showToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao excluir devolução.'), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao excluir devolução.', 'error');
    } finally {
      setDeleting(false);
      setExcluindo(null);
    }
  };

  // Paginação visual
  const totalPaginas = Math.max(1, Math.ceil(devolucoes.length / REGISTROS_POR_PAGINA));
  const paginaAtualSegura = Math.min(paginaAtual, totalPaginas);
  const devolucoesPagina = devolucoes.slice(
    (paginaAtualSegura - 1) * REGISTROS_POR_PAGINA,
    paginaAtualSegura * REGISTROS_POR_PAGINA
  );

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
          <p className="font-semibold">{typeof toast.message === 'string' ? toast.message : 'Erro inesperado.'}</p>
        </div>
      )}

      {/* Header Actions */}
      <div className="flex flex-col lg:flex-row gap-4 items-center justify-between bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">

        <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
          {/* Search */}
          <div className="relative w-full sm:w-80">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <Search size={18} />
            </span>
            <input
              type="text"
              placeholder="Buscar por consumidor ou Nota PS..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all text-sm"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            {STATUS_FILTROS.map((filtro) => (
              <button
                key={filtro}
                type="button"
                onClick={() => setStatusFiltro(filtro)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  statusFiltro === filtro
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {filtro}
              </button>
            ))}
          </div>
        </div>

        {/* Add Button */}
        <button
          onClick={openAddModal}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl font-semibold text-sm hover:bg-primary-700 transition-all shadow-md shadow-primary-900/10 cursor-pointer"
        >
          <Plus size={18} />
          Nova Devolução
        </button>
      </div>

      {/* List / Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-bold text-xs uppercase tracking-wider">
                <th className="px-3 py-3 md:px-6 md:py-4">Consumidor</th>
                <th className="px-3 py-3 md:px-6 md:py-4">Nota PS</th>
                <th className="px-3 py-3 md:px-6 md:py-4">Data de Entrega</th>
                <th className="px-3 py-3 md:px-6 md:py-4">Data de Devolução</th>
                <th className="px-3 py-3 md:px-6 md:py-4">Status</th>
                <th className="px-3 py-3 md:px-6 md:py-4 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan="6" className="text-center py-12 text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
                      <p className="text-xs">Buscando devoluções...</p>
                    </div>
                  </td>
                </tr>
              ) : lista.status === 'error' ? (
                <tr>
                  <td colSpan="6">
                    <ErroCarregamento mensagem={lista.erro} onTentarNovamente={fetchDevolucoes} />
                  </td>
                </tr>
              ) : devolucoes.length === 0 ? (
                <tr>
                  <td colSpan="6" className="text-center py-16 text-slate-400">
                    <PackageCheck className="mx-auto mb-3 text-slate-300" size={40} />
                    <p className="font-semibold mt-2">Nenhuma devolução encontrada.</p>
                    <p className="text-xs mt-1">Cadastre uma nova devolução no botão acima para iniciar.</p>
                  </td>
                </tr>
              ) : (
                devolucoesPagina.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-3 py-3 md:px-6 md:py-4 font-bold text-slate-900">{d.consumidor}</td>
                    <td className="px-3 py-3 md:px-6 md:py-4 font-mono text-xs">{d.nota_ps || '—'}</td>
                    <td className="px-3 py-3 md:px-6 md:py-4">{formatarData(d.data_entrega)}</td>
                    <td className="px-3 py-3 md:px-6 md:py-4">{formatarData(d.data_devolucao)}</td>
                    <td className="px-3 py-3 md:px-6 md:py-4"><BadgeStatus status={d.status} /></td>
                    <td className="px-3 py-3 md:px-6 md:py-4">
                      <div className="flex justify-center items-center gap-2">
                        <button
                          onClick={() => openEditModal(d)}
                          className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-700 border border-slate-100 transition-colors"
                          title="Editar"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => setExcluindo({ id: d.id, consumidor: d.consumidor })}
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
              <p className="text-xs">Buscando devoluções...</p>
            </div>
          ) : lista.status === 'error' ? (
            <ErroCarregamento mensagem={lista.erro} onTentarNovamente={fetchDevolucoes} />
          ) : devolucoes.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <PackageCheck className="mx-auto mb-3 text-slate-300" size={40} />
              <p className="font-semibold mt-2">Nenhuma devolução encontrada.</p>
              <p className="text-xs mt-1">Cadastre uma nova devolução no botão acima para iniciar.</p>
            </div>
          ) : (
            devolucoesPagina.map((d) => (
              <div key={d.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-slate-900 text-sm truncate">{d.consumidor}</p>
                  {d.nota_ps && (
                    <p className="font-mono text-xs text-slate-500 mt-0.5">Nota PS: {d.nota_ps}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-slate-600">
                    <span>Entrega: {formatarData(d.data_entrega)}</span>
                    <span>Devolução: {formatarData(d.data_devolucao)}</span>
                  </div>
                  <div className="mt-1.5"><BadgeStatus status={d.status} /></div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => openEditModal(d)}
                    className="w-11 h-11 flex items-center justify-center rounded bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-700 border border-slate-100 transition-colors"
                    title="Editar"
                  >
                    <Edit2 size={15} />
                  </button>
                  <button
                    onClick={() => setExcluindo({ id: d.id, consumidor: d.consumidor })}
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
      {!loading && devolucoes.length > REGISTROS_POR_PAGINA && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-xs text-slate-500 font-semibold">
            Mostrando {((paginaAtualSegura - 1) * REGISTROS_POR_PAGINA) + 1}–
            {Math.min(paginaAtualSegura * REGISTROS_POR_PAGINA, devolucoes.length)} de {devolucoes.length} devolução(ões)
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
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden animate-in fade-in zoom-in duration-200">

            {/* Header */}
            <div className="bg-slate-900 text-white px-3 py-3 md:px-6 md:py-4 flex items-center justify-between">
              <h3 className="font-bold text-lg">
                {editingId ? '📦 Editar Devolução' : '📦 Nova Devolução'}
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                {/* Consumidor */}
                <div className="col-span-1 md:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Consumidor *</label>
                  <input
                    type="text"
                    name="consumidor"
                    value={formData.consumidor}
                    onChange={handleInputChange}
                    required
                    placeholder="Nome do consumidor"
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                  />
                </div>

                {/* Nota PS */}
                <div className="col-span-1 md:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Nota PS</label>
                  <input
                    type="text"
                    name="nota_ps"
                    value={formData.nota_ps}
                    onChange={handleInputChange}
                    placeholder="Número da Nota PS"
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                  />
                </div>

                {/* Data de Entrega */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Data de Entrega *</label>
                  <input
                    type="date"
                    name="data_entrega"
                    value={formData.data_entrega}
                    onChange={handleInputChange}
                    required
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                  />
                </div>

                {/* Data de Devolução */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Data de Devolução</label>
                  <input
                    type="date"
                    name="data_devolucao"
                    value={formData.data_devolucao}
                    min={formData.data_entrega || undefined}
                    onChange={handleInputChange}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                  />
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    Deixe em branco para manter o status <strong>Aberto</strong>. Ao preencher, o registro passa para <strong>Fechado</strong>.
                  </p>
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
                    editingId ? 'Salvar Alterações' : 'Cadastrar Devolução'
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
        titulo="Excluir devolução"
        mensagem={excluindo ? `Tem certeza que deseja excluir a devolução de "${excluindo.consumidor}"? Esta ação não pode ser desfeita.` : ''}
        loading={deleting}
        onConfirmar={handleDelete}
        onCancelar={() => setExcluindo(null)}
      />

    </div>
  );
}

export default DevolucoesCelesc;
