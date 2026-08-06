import React, { useState, useEffect } from 'react';
import { LineChart, Plus, Trash2, FileDown, Check, AlertTriangle, Calculator, UserCheck } from 'lucide-react';
import { API_URL, apiFetch } from '../api';

function FluxoCaixa() {
  const [closings, setClosings] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // Form Fields State
  const [formData, setFormData] = useState({
    mes_referencia: '',
    rendimento_usina1: 0,
    rendimento_usina2: 0,
    rendimento_usina3: 0,
    despesa_contabilidade: 0,
    despesa_internet: 0,
    despesa_lavagem: 0,
    despesa_manutencao: 0,
    despesa_imposto: 0,
    despesa_taxa: 0,
    despesa_diversas: 0
  });

  useEffect(() => {
    fetchClosings();
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchClosings = async () => {
    try {
      setLoading(true);
      const res = await apiFetch(`${API_URL}/fluxo-caixa/`);
      if (res.ok) {
        const data = await res.json();
        setClosings(data);
      }
    } catch (err) {
      console.error(err);
      showToast('Erro ao buscar lançamentos de fluxo.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'mes_referencia' ? value : parseFloat(value) || 0
    }));
  };

  // Real-time calculations
  const totalRendimentos = formData.rendimento_usina1 + formData.rendimento_usina2 + formData.rendimento_usina3;
  const totalDespesas = (
    formData.despesa_contabilidade + formData.despesa_internet + formData.despesa_lavagem +
    formData.despesa_manutencao + formData.despesa_imposto + formData.despesa_taxa + formData.despesa_diversas
  );
  const totalLiquido = totalRendimentos - totalDespesas;

  const sociosConfig = [
    { name: 'Marlene', pct: 0.30, share: totalLiquido * 0.30 },
    { name: 'João B.', pct: 0.30, share: totalLiquido * 0.30 },
    { name: 'Demarco', pct: 0.25, share: totalLiquido * 0.25 },
    { name: 'Nei Rigo', pct: 0.10, share: totalLiquido * 0.10 },
    { name: 'Gilmar T.', pct: 0.05, share: totalLiquido * 0.05 },
  ];

  const handleSelectClosing = (item) => {
    setSelectedId(item.id);
    setFormData({
      mes_referencia: item.mes_referencia,
      rendimento_usina1: item.rendimento_usina1,
      rendimento_usina2: item.rendimento_usina2,
      rendimento_usina3: item.rendimento_usina3,
      despesa_contabilidade: item.despesa_contabilidade,
      despesa_internet: item.despesa_internet,
      despesa_lavagem: item.despesa_lavagem,
      despesa_manutencao: item.despesa_manutencao,
      despesa_imposto: item.despesa_imposto,
      despesa_taxa: item.despesa_taxa,
      despesa_diversas: item.despesa_diversas
    });
  };

  const handleClearForm = () => {
    setSelectedId(null);
    setFormData({
      mes_referencia: '',
      rendimento_usina1: 0,
      rendimento_usina2: 0,
      rendimento_usina3: 0,
      despesa_contabilidade: 0,
      despesa_internet: 0,
      despesa_lavagem: 0,
      despesa_manutencao: 0,
      despesa_imposto: 0,
      despesa_taxa: 0,
      despesa_diversas: 0
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.mes_referencia) {
      showToast('O Mês de Referência é obrigatório.', 'error');
      return;
    }

    try {
      const method = selectedId ? 'PUT' : 'POST';
      const url = selectedId ? `${API_URL}/fluxo-caixa/${selectedId}` : `${API_URL}/fluxo-caixa/`;

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (res.ok) {
        showToast(selectedId ? 'Lançamento atualizado!' : 'Lançamento salvo com sucesso!');
        handleClearForm();
        fetchClosings();
      } else {
        showToast('Erro ao salvar lançamento financeiro.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao salvar fluxo.', 'error');
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    if (!window.confirm(`Tem certeza que deseja deletar o fechamento de "${formData.mes_referencia}"?`)) return;

    try {
      const res = await apiFetch(`${API_URL}/fluxo-caixa/${selectedId}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Fechamento excluído com sucesso.');
        handleClearForm();
        fetchClosings();
      } else {
        showToast('Erro ao excluir fechamento.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro ao excluir fechamento.', 'error');
    }
  };

  const triggerPdfDownload = async (id, mesRef, socio = null) => {
    let url = `${API_URL}/fluxo-caixa/${id}/relatorio`;
    if (socio) url += `?socio=${encodeURIComponent(socio)}`;

    try {
      const res = await apiFetch(url);
      if (!res.ok) {
        showToast('Erro ao gerar o relatório.', 'error');
        return;
      }
      const blob = await res.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `Relatorio_${socio || 'Geral'}_${(mesRef || 'mensal').replace(/\//g, '-')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(objectUrl);
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao gerar o relatório.', 'error');
    }
  };

  const formatBRL = (val) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
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
          <p className="font-semibold">{typeof toast.message === 'string' ? toast.message : 'Erro inesperado.'}</p>
        </div>
      )}

      {/* Main Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Form: Yield/Expenses Inputs & Split Realtime Calculator */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm lg:col-span-2 space-y-6">
          
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Calculator className="text-primary-500" />
              Calculadora & Fechamento Financeiro
            </h3>
            {selectedId && (
              <button
                onClick={handleClearForm}
                className="flex items-center gap-1 text-xs font-bold text-primary-600 hover:text-primary-700 bg-primary-50 px-3 py-1.5 rounded-lg cursor-pointer"
              >
                <Plus size={14} />
                Novo Lançamento
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            
            {/* Header: Referência do Mês */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Mês de Referência *</label>
                <input
                  type="text"
                  name="mes_referencia"
                  required
                  value={formData.mes_referencia}
                  onChange={handleInputChange}
                  placeholder="Ex: Janeiro/2026 ou 2026-01"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-bold text-slate-900"
                />
              </div>
            </div>

            {/* Content: Rendimentos e Despesas */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Rendimentos */}
              <div className="bg-slate-50 p-4 rounded-xl space-y-3 border border-slate-100">
                <h4 className="text-xs font-bold text-emerald-800 uppercase tracking-wider flex items-center justify-between">
                  Rendimentos (R$)
                  <span className="text-xs font-black">{formatBRL(totalRendimentos)}</span>
                </h4>
                
                {[
                  { name: 'rendimento_usina1', label: 'Rendimento Usina 1' },
                  { name: 'rendimento_usina2', label: 'Rendimento Usina 2' },
                  { name: 'rendimento_usina3', label: 'Rendimento Usina 3' }
                ].map((field) => (
                  <div key={field.name} className="flex justify-between items-center gap-4">
                    <label className="text-xs font-bold text-slate-600">{field.label}</label>
                    <input
                      type="number"
                      name={field.name}
                      step="0.01"
                      value={formData[field.name]}
                      onChange={handleInputChange}
                      className="w-28 px-2 py-1 text-right text-xs border border-slate-200 rounded bg-white font-semibold text-emerald-800"
                    />
                  </div>
                ))}
              </div>

              {/* Despesas */}
              <div className="bg-slate-50 p-4 rounded-xl space-y-3 border border-slate-100">
                <h4 className="text-xs font-bold text-rose-800 uppercase tracking-wider flex items-center justify-between">
                  Despesas Operacionais (R$)
                  <span className="text-xs font-black">{formatBRL(totalDespesas)}</span>
                </h4>
                
                {[
                  { name: 'despesa_contabilidade', label: 'Contabilidade' },
                  { name: 'despesa_internet', label: 'Internet' },
                  { name: 'despesa_lavagem', label: 'Lavagem Usinas' },
                  { name: 'despesa_manutencao', label: 'Manutenção' },
                  { name: 'despesa_imposto', label: 'Impostos' },
                  { name: 'despesa_taxa', label: 'Seguro/Taxas' },
                  { name: 'despesa_diversas', label: 'Despesas Diversas' }
                ].map((field) => (
                  <div key={field.name} className="flex justify-between items-center gap-4">
                    <label className="text-xs font-bold text-slate-600">{field.label}</label>
                    <input
                      type="number"
                      name={field.name}
                      step="0.01"
                      value={formData[field.name]}
                      onChange={handleInputChange}
                      className="w-28 px-2 py-1 text-right text-xs border border-slate-200 rounded bg-white font-semibold text-rose-850"
                    />
                  </div>
                ))}
              </div>

            </div>

            {/* Totalizador Real-time */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-900 text-white flex flex-col sm:flex-row justify-between items-center gap-4">
              <div>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Saldo Líquido Disponível</p>
                <h4 className={`text-2xl font-black mt-1 ${totalLiquido >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {formatBRL(totalLiquido)}
                </h4>
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                {selectedId && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2 border border-rose-800 text-rose-400 font-semibold text-xs rounded-lg hover:bg-rose-950/20 hover:text-rose-300 transition-all cursor-pointer"
                  >
                    <Trash2 size={14} />
                    Excluir
                  </button>
                )}
                <button
                  type="submit"
                  className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-6 py-2.5 bg-primary-600 text-white font-semibold text-xs rounded-lg hover:bg-primary-700 transition-all shadow-md shadow-primary-950/20 cursor-pointer"
                >
                  Salvar Fechamento
                </button>
              </div>
            </div>

            {/* Partners Profit Sharing Grid */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <UserCheck size={14} className="text-primary-500" />
                Cota-Parte dos Sócios (Calculado em tempo real)
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {sociosConfig.map((socio) => (
                  <div key={socio.name} className="bg-white border border-slate-100 p-3 rounded-xl shadow-xs text-center">
                    <p className="text-xs text-slate-500 font-bold">{socio.name}</p>
                    <span className="text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-extrabold mt-1 inline-block">
                      {socio.pct * 100}%
                    </span>
                    <p className={`text-sm font-extrabold mt-2 ${totalLiquido >= 0 ? 'text-slate-800' : 'text-rose-700'}`}>
                      {formatBRL(socio.share)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

          </form>

        </div>

        {/* Right Side: History List of closings with Download links */}
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
            <h3 className="font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-2.5">
              <LineChart className="text-emerald-500" />
              Histórico de Fechamentos
            </h3>
            
            <div className="space-y-3 max-h-[500px] overflow-y-auto mt-3 pr-1">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
                  <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs">Carregando histórico...</p>
                </div>
              ) : closings.length === 0 ? (
                <p className="text-center text-slate-400 text-xs py-8">Nenhum fechamento registrado.</p>
              ) : (
                closings.map((c) => (
                  <div 
                    key={c.id} 
                    className={`p-3.5 rounded-xl border transition-all ${
                      selectedId === c.id 
                        ? 'border-primary-500 bg-primary-50/10' 
                        : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50/50'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="cursor-pointer flex-1" onClick={() => handleSelectClosing(c)}>
                        <p className="font-bold text-slate-800 text-sm">{c.mes_referencia}</p>
                        <p className="text-xs text-slate-500 mt-0.5">Saldo: <span className="font-bold text-slate-700">{formatBRL(c.total_liquido)}</span></p>
                      </div>
                      
                      {/* Download PDF button */}
                      <button
                        onClick={() => triggerPdfDownload(c.id, c.mes_referencia)}
                        className="p-2 rounded bg-slate-50 hover:bg-emerald-50 border border-slate-100 text-slate-500 hover:text-emerald-700 transition-colors"
                        title="Baixar Relatório Geral (PDF)"
                      >
                        <FileDown size={14} />
                      </button>
                    </div>

                    {/* Socio specific PDF downloads dropdown/quick links */}
                    <div className="mt-3 pt-2.5 border-t border-dashed border-slate-100">
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1.5">Relatório por Sócio:</p>
                      <div className="flex flex-wrap gap-1">
                        {['Demarco', 'Marlene', 'João B.', 'Nei Rigo', 'Gilmar T.'].map((socio) => (
                          <button
                            key={socio}
                            onClick={() => triggerPdfDownload(c.id, c.mes_referencia, socio)}
                            className="text-[9px] font-extrabold bg-slate-100 hover:bg-primary-50 hover:text-primary-700 text-slate-600 px-2 py-1 rounded transition-all cursor-pointer"
                          >
                            {socio}
                          </button>
                        ))}
                      </div>
                    </div>

                  </div>
                ))
              )}
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}

export default FluxoCaixa;
