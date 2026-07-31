import React, { useState, useEffect } from 'react';
import { Search, Plus, Edit2, Trash2, X, Check, AlertTriangle, Printer, FileCheck2, FileX2 } from 'lucide-react';
import { API_URL } from '../App';

function Recebimentos() {
  const [recebimentos, setRecebimentos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [busca, setBusca] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [buscaCliente, setBuscaCliente] = useState('');
  const [sugestoesAbertas, setSugestoesAbertas] = useState(false);
  const [formData, setFormData] = useState({
    nome_cliente: '',
    data_inicio: '',
    valor_da_obra: 0,
    valor_de_devolucao: 0,
    pag_cliente: 0,
    emissao_nf: '',
    nota_ps: '',
    cessao: 'nao'
  });

  useEffect(() => {
    fetchRecebimentos();
    fetchClientes();
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchRecebimentos = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/recebimentos/`);
      if (res.ok) {
        const data = await res.json();
        setRecebimentos(data);
      }
    } catch (err) {
      console.error(err);
      showToast('Erro ao buscar recebimentos.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchClientes = async () => {
    try {
      const res = await fetch(`${API_URL}/clientes/`);
      if (res.ok) {
        setClientes(await res.json());
      }
    } catch (err) {
      console.error('Erro ao buscar clientes:', err);
    }
  };

  const parseCurrencyBR = (value) => {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value;
    const cleaned = String(value).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  };

  const pagCliente = () =>
    (parseFloat(formData.valor_da_obra) || 0) - (parseFloat(formData.valor_de_devolucao) || 0);

  const sugestoesClientes = buscaCliente.trim()
    ? clientes.filter(c => c.nome.toLowerCase().includes(buscaCliente.toLowerCase())).slice(0, 8)
    : [];

  const selecionarCliente = (cliente) => {
    setBuscaCliente(cliente.nome);
    setSugestoesAbertas(false);
    setFormData(prev => ({
      ...prev,
      nome_cliente: cliente.nome || '',
      valor_da_obra: parseCurrencyBR(cliente.valor_da_obra),
      valor_de_devolucao: parseCurrencyBR(cliente.valor_de_devolucao)
    }));
  };

  const openAddModal = () => {
    setEditingId(null);
    setBuscaCliente('');
    setSugestoesAbertas(false);
    setFormData({
      nome_cliente: '',
      data_inicio: '',
      valor_da_obra: 0,
      valor_de_devolucao: 0,
      pag_cliente: 0,
      emissao_nf: '',
      nota_ps: '',
      cessao: 'nao'
    });
    setShowModal(true);
  };

  const openEditModal = (r) => {
    setEditingId(r.id);
    setBuscaCliente(r.nome_cliente || '');
    setSugestoesAbertas(false);
    setFormData({
      nome_cliente: r.nome_cliente || '',
      data_inicio: r.data_inicio || '',
      valor_da_obra: r.valor_da_obra || 0,
      valor_de_devolucao: r.valor_de_devolucao || 0,
      pag_cliente: r.pag_cliente || 0,
      emissao_nf: r.emissao_nf || '',
      nota_ps: r.nota_ps || '',
      cessao: r.cessao || 'nao'
    });
    setShowModal(true);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    const numericFields = ['valor_da_obra', 'valor_de_devolucao'];
    setFormData(prev => ({
      ...prev,
      [name]: numericFields.includes(name) ? parseFloat(value) || 0 : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.nome_cliente) {
      showToast('Nome do cliente é obrigatório.', 'error');
      return;
    }

    const payload = {
      ...formData,
      pag_cliente: pagCliente(),
      valor_da_obra: parseFloat(formData.valor_da_obra) || 0,
      valor_de_devolucao: parseFloat(formData.valor_de_devolucao) || 0
    };

    try {
      const method = editingId ? 'PUT' : 'POST';
      const url = editingId ? `${API_URL}/recebimentos/${editingId}` : `${API_URL}/recebimentos/`;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const resData = await res.json();

      if (res.ok) {
        showToast(editingId ? 'Recebimento atualizado com sucesso!' : 'Recebimento cadastrado com sucesso!');
        setShowModal(false);
        fetchRecebimentos();
      } else {
        showToast(resData.detail || 'Erro ao salvar recebimento.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao salvar recebimento.', 'error');
    }
  };

  const handleDelete = async (id, nome) => {
    if (!window.confirm(`Tem certeza que deseja excluir o recebimento de "${nome}"?`)) return;

    try {
      const res = await fetch(`${API_URL}/recebimentos/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Recebimento excluído com sucesso.');
        fetchRecebimentos();
      } else {
        showToast('Erro ao excluir recebimento.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao excluir recebimento.', 'error');
    }
  };

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
  };

  const filteredRecebimentos = recebimentos.filter(r => {
    const searchLower = busca.toLowerCase();
    const nameMatch = (r.nome_cliente || '').toLowerCase().includes(searchLower);
    const cessaoMatch = (r.cessao || '').toLowerCase().includes(searchLower);
    return nameMatch || cessaoMatch;
  });

  const totalComNF = recebimentos
    .filter(r => r.emissao_nf)
    .reduce((s, r) => s + (parseFloat(r.valor_da_obra) || 0), 0);
  const totalSemNF = recebimentos
    .filter(r => !r.emissao_nf)
    .reduce((s, r) => s + (parseFloat(r.valor_da_obra) || 0), 0);
  const qtdComNF = recebimentos.filter(r => r.emissao_nf).length;
  const qtdSemNF = recebimentos.filter(r => !r.emissao_nf).length;

  return (
    <div className="space-y-6">
      
      {/* Estilos para impressão */}
      <style dangerouslySetInnerHTML={{__html: `
        @media print {
          @page {
            margin: 8mm;
          }
          body {
            background-color: white !important;
            color: black !important;
          }
          aside, header, button, input, select, .print\\:hidden, .no-print {
            display: none !important;
          }
          main {
            padding: 0 !important;
            margin: 0 !important;
          }
          .flex-1.overflow-y-auto {
            overflow: visible !important;
            height: auto !important;
          }
          .print-full-width {
            width: 100% !important;
            max-width: 100% !important;
            border: none !important;
            box-shadow: none !important;
          }
          table {
            width: 100% !important;
            border-collapse: collapse !important;
          }
          th, td {
            border: 1px solid #cbd5e1 !important;
            padding: 4px 6px !important;
            font-size: 8px !important;
          }
        }
      `}} />

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
          <p className="font-semibold">{toast.message}</p>
        </div>
      )}

      {/* Cabeçalho exclusivo para Impressão */}
      <div className="hidden print:block mb-4 border-b border-slate-300 pb-3">
        <h2 className="text-xl font-bold text-slate-800 uppercase tracking-wide">Controle de Recebimentos</h2>
        <p className="text-xs text-slate-500 mt-1">
          Gerado em: {new Date().toLocaleDateString('pt-BR')}
          {busca && ` | Busca: "${busca}"`}
        </p>
      </div>

      {/* Header Actions */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-2xl border border-slate-100 shadow-sm print:hidden">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3.5 top-3 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Buscar por nome do cliente ou cessão..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all text-sm"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <button
            onClick={() => window.print()}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm rounded-xl transition-all border border-slate-200 cursor-pointer w-full sm:w-auto"
          >
            <Printer size={16} />
            Imprimir
          </button>
          <button
            onClick={openAddModal}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-bold text-sm rounded-xl transition-all shadow-md shadow-primary-900/10 cursor-pointer w-full sm:w-auto"
          >
            <Plus size={18} />
            Novo Recebimento
          </button>
        </div>
      </div>

      {/* Resumo Emissão NF */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 print-full-width">
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
            <FileCheck2 size={24} />
          </div>
          <div>
            <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">Clientes com Emissão NF</span>
            <span className="block text-xl font-extrabold text-emerald-700">{formatCurrency(totalComNF)}</span>
            <span className="block text-xs text-slate-400 font-semibold">{qtdComNF} cliente(s)</span>
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
            <FileX2 size={24} />
          </div>
          <div>
            <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">Clientes sem Emissão NF</span>
            <span className="block text-xl font-extrabold text-amber-700">{formatCurrency(totalSemNF)}</span>
            <span className="block text-xs text-slate-400 font-semibold">{qtdSemNF} cliente(s)</span>
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden print-full-width">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-bold text-xs uppercase tracking-wider">
                <th className="px-6 py-4">Cliente</th>
                <th className="px-6 py-4">Data Início</th>
                <th className="px-6 py-4">Valor da Obra</th>
                <th className="px-6 py-4">Valor Devolução</th>
                <th className="px-6 py-4">Pag. Cliente</th>
                <th className="px-6 py-4">Emissão NF</th>
                <th className="px-6 py-4">Nota PS</th>
                <th className="px-6 py-4 text-center">Cessão</th>
                <th className="px-6 py-4 text-center print:hidden">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan="9" className="text-center py-12 text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
                      <p className="text-xs">Carregando recebimentos...</p>
                    </div>
                  </td>
                </tr>
              ) : filteredRecebimentos.length === 0 ? (
                <tr>
                  <td colSpan="9" className="text-center py-16 text-slate-400">
                    <span className="text-3xl">💰</span>
                    <p className="font-semibold mt-2">Nenhum recebimento encontrado.</p>
                    <p className="text-xs mt-1">Cadastre um novo recebimento no botão acima.</p>
                  </td>
                </tr>
              ) : (
                filteredRecebimentos.map((r) => {
                  const pag = (parseFloat(r.valor_da_obra) || 0) - (parseFloat(r.valor_de_devolucao) || 0);
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 font-bold text-slate-900">{r.nome_cliente}</td>
                      <td className="px-6 py-4">{formatDate(r.data_inicio)}</td>
                      <td className="px-6 py-4 font-semibold">{formatCurrency(r.valor_da_obra)}</td>
                      <td className="px-6 py-4 text-amber-600 font-semibold">{formatCurrency(r.valor_de_devolucao)}</td>
                      <td className="px-6 py-4 text-emerald-600 font-bold">{formatCurrency(pag)}</td>
                      <td className="px-6 py-4">{formatDate(r.emissao_nf)}</td>
                      <td className="px-6 py-4">{r.nota_ps || '-'}</td>
                      <td className="px-6 py-4 text-center">
                        <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                          r.cessao === 'sim' 
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                            : 'bg-slate-50 text-slate-500 border-slate-200'
                        }`}>
                          {r.cessao === 'sim' ? 'Sim' : 'Não'}
                        </span>
                      </td>
                      <td className="px-6 py-4 print:hidden">
                        <div className="flex justify-center items-center gap-2">
                          <button
                            onClick={() => openEditModal(r)}
                            className="p-2 rounded bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-700 border border-slate-100 transition-colors"
                            title="Editar"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => handleDelete(r.id, r.nome_cliente)}
                            className="p-2 rounded bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-100 transition-colors"
                            title="Excluir"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
              <h3 className="font-bold text-lg">
                {editingId ? 'Editar Recebimento' : 'Novo Recebimento'}
              </h3>
              <button 
                onClick={() => setShowModal(false)} 
                className="text-slate-400 hover:text-white text-xl font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="col-span-1 md:col-span-2 relative">
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Cliente Cadastrado (pré-preenchimento)</label>
                  <input
                    type="text"
                    value={buscaCliente}
                    onChange={(e) => {
                      setBuscaCliente(e.target.value);
                      setSugestoesAbertas(true);
                    }}
                    onFocus={() => setSugestoesAbertas(true)}
                    onBlur={() => setTimeout(() => setSugestoesAbertas(false), 150)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && sugestoesClientes.length > 0) {
                        e.preventDefault();
                        selecionarCliente(sugestoesClientes[0]);
                      }
                    }}
                    placeholder="Digite o nome do cliente..."
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
                  />
                  {sugestoesAbertas && sugestoesClientes.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
                      {sugestoesClientes.map((c) => (
                        <button
                          type="button"
                          key={c.id}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selecionarCliente(c);
                          }}
                          className="w-full text-left px-3.5 py-2.5 text-sm hover:bg-primary-50 cursor-pointer border-b border-slate-50 last:border-b-0"
                        >
                          <span className="font-semibold text-slate-700">{c.nome}</span>
                          <span className="block text-[10px] text-slate-400">{c.cpf_cnpj}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-slate-400 mt-1">
                    Digite o nome e selecione a sugestão para preencher nome, valor da obra e valor de devolução automaticamente.
                  </p>
                </div>

                <div className="col-span-1 md:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Nome do Cliente *</label>
                  <input
                    type="text"
                    name="nome_cliente"
                    value={formData.nome_cliente}
                    onChange={handleInputChange}
                    required
                    placeholder="Ex: Edenir Munaretto"
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Data Início</label>
                  <input
                    type="date"
                    name="data_inicio"
                    value={formData.data_inicio}
                    onChange={handleInputChange}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Emissão NF</label>
                  <input
                    type="date"
                    name="emissao_nf"
                    value={formData.emissao_nf}
                    onChange={handleInputChange}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                  />
                </div>

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

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Valor da Obra (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    name="valor_da_obra"
                    value={formData.valor_da_obra}
                    onChange={handleInputChange}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold text-emerald-700"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Valor de Devolução (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    name="valor_de_devolucao"
                    value={formData.valor_de_devolucao}
                    onChange={handleInputChange}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold text-amber-700"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Pag. Cliente</label>
                  <input
                    type="text"
                    value={formatCurrency(pagCliente())}
                    readOnly
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-primary-750"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Cessão</label>
                  <select
                    name="cessao"
                    value={formData.cessao}
                    onChange={handleInputChange}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
                  >
                    <option value="nao">Não</option>
                    <option value="sim">Sim</option>
                  </select>
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
                  {editingId ? 'Salvar Alterações' : 'Cadastrar Recebimento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Recebimentos;
