import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, Search, Trash2, ShieldAlert, Plus, Check, X, AlertTriangle, Clock } from 'lucide-react';
import { API_URL, apiFetch, erroDaResposta } from '../api';

function Ferias({ fetchAlerts, fetchNotifications, usuarioAtual }) {
  const [records, setRecords] = useState([]);
  const [busca, setBusca] = useState('');
  const [proximoMes, setProximoMes] = useState(false);
  const [tab, setTab] = useState('confirmados');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [funcionarios, setFuncionarios] = useState([]);
  const [sugestoesAbertas, setSugestoesAbertas] = useState(false);

  const programados = useMemo(() => records.filter(r => r.status === 'Programado'), [records]);
  const confirmados = useMemo(() => records.filter(r => r.status !== 'Programado'), [records]);

  // Agendamento Form State
  const [formData, setFormData] = useState({
    nome: '',
    data_inicio: '',
    dias_abono: 0,
    dias_gozo: '',
    data_limite: '',
    saldo_anterior: 0,
    dias_utilizados: 0
  });

  const sugestoes = useMemo(() => {
    const termo = formData.nome.trim().toLowerCase();
    if (!termo) return [];
    return funcionarios.filter((f) =>
      (f.nome || '').toLowerCase().includes(termo) ||
      (f.cpf || '').toLowerCase().includes(termo)
    );
  }, [funcionarios, formData.nome]);

  const selectSugestao = (f) => {
    setFormData(prev => ({ ...prev, nome: f.nome }));
    setSugestoesAbertas(false);
  };

  useEffect(() => {
    fetchRecords();
  }, [busca, proximoMes]);

  useEffect(() => {
    const fetchFuncionarios = async () => {
      try {
        const res = await apiFetch(`${API_URL}/funcionarios/`);
        if (res.ok) {
          const data = await res.json();
          setFuncionarios(data);
        }
      } catch (err) {
        console.error('Erro ao buscar funcionários:', err);
      }
    };
    fetchFuncionarios();
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchRecords = async () => {
    try {
      setLoading(true);
      let queryParams = [];
      if (busca) queryParams.push(`busca=${encodeURIComponent(busca)}`);
      if (proximoMes) queryParams.push(`proximo_mes=true`);
      
      const queryStr = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';
      const res = await apiFetch(`${API_URL}/ferias/${queryStr}`);
      if (res.ok) {
        const data = await res.json();
        setRecords(data);
      }
    } catch (err) {
      console.error(err);
      showToast('Erro ao buscar registros de férias.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ 
      ...prev, 
      [name]: name === 'dias_abono' || name === 'saldo_anterior' || name === 'dias_utilizados' 
        ? parseInt(value) || 0 
        : name === 'dias_gozo'
        ? value === '' ? '' : parseInt(value) || ''
        : value 
    }));
  };

  const handleAddVacation = async (e) => {
    e.preventDefault();
    if (!formData.nome || !formData.data_inicio) {
      showToast('Nome do colaborador e Data de Início são obrigatórios.', 'error');
      return;
    }

    try {
      const payload = { ...formData, criado_por: usuarioAtual?.nome || 'Usuário' };
      if (payload.dias_gozo === '') {
        delete payload.dias_gozo;
      }
      const res = await apiFetch(`${API_URL}/ferias/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const resData = await res.json();
      
      if (res.ok) {
        showToast('Férias programadas! Aguardando confirmação do agendamento.');
        setTab('programados');
        setFormData({
          nome: '',
          data_inicio: '',
          dias_abono: 0,
          dias_gozo: '',
          data_limite: '',
          saldo_anterior: 0,
          dias_utilizados: 0
        });
        fetchRecords();
        fetchAlerts(); // Atualiza a contagem de alertas no header
        if (fetchNotifications) fetchNotifications(); // Atualiza notificações no header
      } else {
        showToast(erroDaResposta(resData, 'Erro ao agendar férias.'), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro ao agendar férias.', 'error');
    }
  };

  const handleDelete = async (id, nome) => {
    if (!window.confirm(`Deseja realmente deletar o agendamento de férias de "${nome}"?`)) return;

    try {
      const res = await apiFetch(`${API_URL}/ferias/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Agendamento excluído com sucesso.');
        fetchRecords();
        fetchAlerts();
      } else {
        showToast('Erro ao excluir agendamento.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao excluir agendamento.', 'error');
    }
  };

  const handleStatusChange = async (id, novoStatus) => {
    try {
      const res = await apiFetch(`${API_URL}/ferias/${id}/status?status=${novoStatus}`, { method: 'PATCH' });
      if (res.ok) {
        showToast(`Status atualizado para ${novoStatus}.`);
        fetchRecords();
        fetchAlerts();
      } else {
        showToast('Erro ao atualizar status.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao atualizar status.', 'error');
    }
  };

  const handleConfirm = async (r) => {
    if (!window.confirm(`Confirmar o agendamento de férias de "${r.nome}" (início ${formatDateBR(r.data_inicio)})?`)) return;
    await handleStatusChange(r.id, 'Agendado');
    setTab('confirmados');
  };

  const formatDateBR = (isoStr) => {
    if (!isoStr) return '-';
    try {
      const parts = isoStr.split('-');
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    } catch {
      return isoStr;
    }
  };

  const activeRecords = tab === 'programados' ? programados : confirmados;

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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Form to Book Vacation */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-6 lg:col-span-1 h-fit">
          <div className="border-b border-slate-100 pb-2">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Calendar className="text-amber-500" />
              Programar Férias
            </h3>
          </div>

          <form onSubmit={handleAddVacation} className="space-y-4">
            
            {/* Nome Colaborador */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Nome do Colaborador *</label>
              <div className="relative">
                <input
                  type="text"
                  name="nome"
                  value={formData.nome}
                  onChange={(e) => {
                    handleInputChange(e);
                    setSugestoesAbertas(true);
                  }}
                  onFocus={() => setSugestoesAbertas(true)}
                  onBlur={() => setTimeout(() => setSugestoesAbertas(false), 150)}
                  required
                  placeholder="Ex: João da Silva"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                />
                {sugestoesAbertas && formData.nome.trim() !== '' && sugestoes.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
                    {sugestoes.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); selectSugestao(f); }}
                        className="w-full text-left px-3.5 py-2 hover:bg-primary-50 transition-colors text-sm"
                      >
                        <span className="font-semibold text-slate-800">{f.nome}</span>
                        <span className="text-slate-400 text-xs ml-1">{f.cpf}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <span className="text-[10px] text-slate-400 mt-1 block">
                Digite ou selecione um funcionário cadastrado na aba Funcionários.
              </span>
            </div>

            {/* Data Início */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Data de Início *</label>
              <input
                type="date"
                name="data_inicio"
                value={formData.data_inicio}
                onChange={handleInputChange}
                required
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
              />
            </div>

            {/* Dias Abono */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Dias Abono Pecuniário (Máx 10)</label>
              <input
                type="number"
                name="dias_abono"
                min="0"
                max="10"
                value={formData.dias_abono}
                onChange={handleInputChange}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
              />
            </div>

            {/* Dias Gozo */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Dias de Gozo</label>
              <input
                type="number"
                name="dias_gozo"
                min="1"
                max="30"
                value={formData.dias_gozo}
                onChange={handleInputChange}
                placeholder="Auto (30 - abono)"
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                Deixe em branco para calcular automaticamente (30 - abono).
              </span>
            </div>

            {/* Data Limite */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Data Limite de Gozo (Opcional)</label>
              <input
                type="date"
                name="data_limite"
                value={formData.data_limite}
                onChange={handleInputChange}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                Padrão: 1 ano após a data de início.
              </span>
            </div>

            {/* Submit */}
            <button
              type="submit"
              className="w-full py-2.5 bg-primary-600 text-white font-semibold text-sm rounded-xl hover:bg-primary-700 transition-all shadow-md shadow-primary-900/10 cursor-pointer"
            >
              Salvar para Confirmação
            </button>
          </form>
        </div>

        {/* Right Column: Search filters + Table */}
        <div className="lg:col-span-2 space-y-4 flex flex-col">
          
          {/* Filters card */}
          <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col sm:flex-row gap-4 items-center justify-between">
            
            {/* Search Input */}
            <div className="relative w-full sm:w-72">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <Search size={16} />
              </span>
              <input
                type="text"
                placeholder="Buscar por colaborador..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all text-sm"
              />
            </div>

            {/* Filter buttons */}
            <div className="flex gap-2 w-full sm:w-auto">
              <button
                onClick={() => setProximoMes(false)}
                className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                  !proximoMes 
                    ? 'bg-slate-900 border-slate-900 text-white shadow-sm' 
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                Todos
              </button>
              <button
                onClick={() => setProximoMes(true)}
                className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                  proximoMes 
                    ? 'bg-slate-900 border-slate-900 text-white shadow-sm' 
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                Previsão Próximo Mês
              </button>
            </div>

          </div>

          {/* Status tabs */}
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <button
              onClick={() => setTab('programados')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold border-2 transition-all ${
                tab === 'programados'
                  ? 'bg-violet-600 border-violet-700 text-white shadow-lg shadow-violet-900/20 ring-2 ring-violet-300'
                  : 'bg-violet-50 border-violet-300 text-violet-700 hover:bg-violet-100 hover:border-violet-400'
              }`}
            >
              <Clock size={14} />
              Programados
              {programados.length > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                  tab === 'programados' ? 'bg-white/20 text-white' : 'bg-violet-600 text-white'
                }`}>
                  {programados.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setTab('confirmados')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                tab === 'confirmados'
                  ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Check size={14} />
              Confirmados
              {confirmados.length > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                  tab === 'confirmados' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                }`}>
                  {confirmados.length}
                </span>
              )}
            </button>
          </div>

          {/* Cards Container */}
          <div className="flex-1 space-y-3">
            {loading ? (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 flex flex-col items-center justify-center text-slate-400 gap-3">
                <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-xs">Carregando férias...</p>
              </div>
            ) : activeRecords.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center text-slate-400">
                <span className="text-3xl">{tab === 'programados' ? '🕐' : '🌴'}</span>
                <p className="font-semibold mt-2">
                  {tab === 'programados'
                    ? 'Nenhuma férias aguardando confirmação.'
                    : 'Nenhum registro de férias confirmado.'}
                </p>
                <p className="text-xs mt-1">
                  {tab === 'programados'
                    ? 'As férias programadas aparecerão aqui até serem confirmadas.'
                    : 'Confirme um agendamento na aba "Programados" para movê-lo para cá.'}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {activeRecords.map((r) => (
                  <div
                    key={r.id}
                    className="bg-white rounded-xl shadow-md border border-slate-200 flex items-stretch overflow-hidden transition-all hover:shadow-lg"
                  >
                    {/* Barra lateral colorida por status */}
                    <div className={`w-1.5 shrink-0 ${
                      r.status === 'Programado'
                        ? 'bg-violet-500'
                        : r.status === 'Em Férias'
                        ? 'bg-amber-500'
                        : r.status === 'Concluído' || r.status === 'Gozadas'
                        ? 'bg-emerald-500'
                        : r.status === 'Cancelado'
                        ? 'bg-slate-400'
                        : 'bg-blue-500'
                    }`} />

                    <div className="flex-1 flex flex-col md:flex-row md:items-center gap-3 px-4 py-3">
                      {/* Nome + status */}
                      <div className="min-w-0 md:w-60 shrink-0">
                        <p className="font-bold text-slate-900 truncate">{r.nome}</p>
                      <span className={`inline-block mt-1.5 text-[10px] font-extrabold px-2.5 py-1 rounded-full uppercase tracking-wider ${
                        r.status === 'Programado'
                          ? 'bg-violet-100 text-violet-700'
                          : r.status === 'Em Férias'
                          ? 'bg-amber-100 text-amber-800 animate-pulse'
                          : r.status === 'Concluído' || r.status === 'Gozadas'
                          ? 'bg-emerald-100 text-emerald-800'
                          : r.status === 'Cancelado'
                          ? 'bg-slate-100 text-slate-500'
                          : 'bg-blue-100 text-blue-800'
                      }`}>
                        {r.status === 'Programado' ? 'Aguardando confirmação' : r.status}
                      </span>
                    </div>

                    {/* Detalhes em colunas (rótulo em cima, valor embaixo) */}
                    <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs">
                      <div>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Início</p>
                        <p className="mt-0.5 font-bold text-slate-800">{formatDateBR(r.data_inicio)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Dias</p>
                        <p className="mt-0.5 font-bold text-slate-800">
                          {r.dias_gozo}d
                          {r.dias_abono > 0 && <span className="text-amber-600 font-bold ml-1">+{r.dias_abono}a</span>}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Retorno</p>
                        <p className="mt-0.5 font-bold text-slate-900">{formatDateBR(r.data_retorno)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Limite</p>
                        <p className="mt-0.5 text-slate-600">{formatDateBR(r.data_limite)}</p>
                      </div>
                    </div>

                    {/* Ações */}
                    <div className="flex items-center gap-1.5 shrink-0 md:ml-2">
                      {r.status === 'Programado' && (
                        <>
                          <button
                            onClick={() => handleConfirm(r)}
                            className="flex items-center gap-1 px-2.5 py-1.5 min-h-11 text-[10px] font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg transition-colors"
                            title="Confirmar agendamento (mover para a aba principal)"
                          >
                            <Check size={11} /> Confirmar
                          </button>
                          <button
                            onClick={() => handleStatusChange(r.id, 'Cancelado')}
                            className="px-2.5 py-1.5 min-h-11 text-[10px] font-bold bg-slate-50 hover:bg-slate-100 text-slate-500 border border-slate-200 rounded-lg transition-colors"
                            title="Cancelar esta programação"
                          >
                            Cancelar
                          </button>
                        </>
                      )}
                      {r.status === 'Agendado' && (
                        <>
                          <button
                            onClick={() => handleStatusChange(r.id, 'Gozadas')}
                            className="flex items-center gap-1 px-2.5 py-1.5 min-h-11 text-[10px] font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg transition-colors"
                            title="Marcar como Gozadas"
                          >
                            <Check size={11} /> Concluir
                          </button>
                          <button
                            onClick={() => handleStatusChange(r.id, 'Cancelado')}
                            className="px-2.5 py-1.5 min-h-11 text-[10px] font-bold bg-slate-50 hover:bg-slate-100 text-slate-500 border border-slate-200 rounded-lg transition-colors"
                            title="Marcar como Cancelado"
                          >
                            Cancelar
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleDelete(r.id, r.nome)}
                        className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-700 border border-slate-100 transition-colors"
                        title="Deletar"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

      </div>

    </div>
  );
}

export default Ferias;
