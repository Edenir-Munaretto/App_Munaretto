import React, { useState, useEffect } from 'react';
import { Search, Plus, Edit2, X, Check, AlertTriangle, Contact, Users, UserCheck, UserX, Power, RotateCcw, LogOut, CalendarDays } from 'lucide-react';
import { API_URL, apiFetch, erroDaResposta } from '../api';
import ModalConfirmacao from '../components/ModalConfirmacao';
import ErroCarregamento from '../components/ErroCarregamento';
import { useFetchState } from '../hooks/useFetchState';

const MOTIVOS_DESLIGAMENTO = [
  'Pedido de demissão',
  'Dispensa sem justa causa',
  'Dispensa por justa causa',
  'Fim de contrato',
  'Aposentadoria',
  'Abandono de emprego',
  'Falecimento',
  'Outro',
];

const hojeISO = () => {
  const agora = new Date();
  agora.setMinutes(agora.getMinutes() - agora.getTimezoneOffset());
  return agora.toISOString().slice(0, 10);
};

const formatarData = (valor) => {
  if (!valor) return '';
  const [ano, mes, dia] = String(valor).slice(0, 10).split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : String(valor);
};

function Funcionarios({ usuarioAtual }) {
  const [funcionarios, setFuncionarios] = useState([]);
  const [stats, setStats] = useState({ total: 0, ativos: 0, inativos: 0, desligados: 0 });
  const [filtroStatus, setFiltroStatus] = useState('ativos');
  const [busca, setBusca] = useState('');
  const [loading, setLoading] = useState(true);
  const lista = useFetchState();
  const [toast, setToast] = useState(null);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ nome: '', cpf: '', cargo_id: '', cargo_id_2: '' });
  const [cargos, setCargos] = useState([]);
  const [confirmarAcao, setConfirmarAcao] = useState(null);
  const [processando, setProcessando] = useState(false);

  // Desligamento
  const [showDesligamentoModal, setShowDesligamentoModal] = useState(false);
  const [desligamentoAlvo, setDesligamentoAlvo] = useState(null);
  const [desligamentoForm, setDesligamentoForm] = useState({
    data_desligamento: hojeISO(),
    motivo_desligamento: '',
    observacao_desligamento: '',
  });
  const [checklistDesligamento, setChecklistDesligamento] = useState(null);
  const [carregandoChecklist, setCarregandoChecklist] = useState(false);
  const [erroChecklist, setErroChecklist] = useState('');

  const temSst = (usuarioAtual?.permissoes || []).includes('sst');
  const podeGerirFuncionarios = (usuarioAtual?.permissoes || []).some(
    (p) => p === 'funcionarios' || p === 'configuracoes'
  );

  useEffect(() => {
    fetchFuncionarios();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, filtroStatus]);

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    if (temSst) {
      apiFetch(`${API_URL}/sst/cargos`, { retry: 2 })
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
      const res = await apiFetch(`${API_URL}/funcionarios/stats`, { retry: 2 });
      if (res.ok) setStats(await res.json());
    } catch (err) {
      console.error('Erro ao buscar estatísticas:', err);
    }
  };

  const fetchFuncionarios = async () => {
    try {
      setLoading(true);
      lista.iniciar();
      const params = new URLSearchParams();
      if (busca) params.set('busca', busca);
      if (filtroStatus !== 'ativos') params.set('status', filtroStatus);
      const qs = params.toString();
      const url = `${API_URL}/funcionarios/${qs ? `?${qs}` : ''}`;
      const res = await apiFetch(url, { retry: 2 });
      if (res.ok) {
        setFuncionarios(await res.json());
        lista.sucesso();
      } else {
        lista.falhar(erroDaResposta(await res.json().catch(() => null), 'Erro ao buscar funcionários.'));
      }
    } catch (err) {
      console.error('Erro ao buscar funcionários:', err);
      lista.falhar('Erro de conexão ao buscar funcionários.');
    } finally {
      setLoading(false);
    }
  };

  const openAddModal = () => {
    setEditingId(null);
    setForm({ nome: '', cpf: '', cargo_id: '', cargo_id_2: '' });
    setShowModal(true);
  };

  const openEditModal = (f) => {
    setEditingId(f.id);
    setForm({
      nome: f.nome,
      cpf: f.cpf,
      cargo_id: f.cargo_id || '',
      cargo_id_2: f.cargo_id_2 || ''
    });
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
      cargo_id: form.cargo_id ? Number(form.cargo_id) : null,
      cargo_id_2: form.cargo_id_2 ? Number(form.cargo_id_2) : null
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

  const handleToggleStatus = (f) => {
    setConfirmarAcao({ tipo: 'toggle', funcionario: f, novoStatus: !f.ativo });
  };

  const abrirDesligamento = async (f) => {
    setDesligamentoAlvo(f);
    setDesligamentoForm({
      data_desligamento: f.data_desligamento ? String(f.data_desligamento).slice(0, 10) : hojeISO(),
      motivo_desligamento: f.motivo_desligamento || '',
      observacao_desligamento: f.observacao_desligamento || '',
    });
    setChecklistDesligamento(null);
    setErroChecklist('');
    setShowDesligamentoModal(true);
    setCarregandoChecklist(true);
    try {
      const res = await apiFetch(`${API_URL}/funcionarios/${f.id}/desligamento/checklist`, { retry: 2 });
      if (res.ok) {
        setChecklistDesligamento(await res.json());
      } else {
        setErroChecklist(erroDaResposta(await res.json().catch(() => null), 'Erro ao carregar pendências do desligamento.'));
      }
    } catch (err) {
      console.error(err);
      setErroChecklist('Erro de conexão ao carregar pendências do desligamento.');
    } finally {
      setCarregandoChecklist(false);
    }
  };

  const handleDesligamentoChange = (e) => {
    const { name, value } = e.target;
    setDesligamentoForm((prev) => ({ ...prev, [name]: value }));
  };

  const enviarDesligamento = (e) => {
    e.preventDefault();
    if (!desligamentoForm.data_desligamento || !desligamentoForm.motivo_desligamento) {
      showToast('Informe a data e o motivo do desligamento.', 'error');
      return;
    }
    if (checklistDesligamento?.bloqueios?.length) {
      showToast(checklistDesligamento.bloqueios.join(' '), 'error');
      return;
    }
    setConfirmarAcao({
      tipo: 'desligamento',
      funcionario: desligamentoAlvo,
      payload: { ...desligamentoForm },
    });
  };

  const confirmarExecucao = async () => {
    if (!confirmarAcao) return;
    setProcessando(true);
    try {
      if (confirmarAcao.tipo === 'toggle') {
        const f = confirmarAcao.funcionario;
        const novoStatus = confirmarAcao.novoStatus;
        const res = await apiFetch(`${API_URL}/funcionarios/${f.id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ativo: novoStatus })
        });
        const data = await res.json().catch(() => null);
        if (res.ok) {
          showToast(novoStatus ? 'Funcionário reativado com sucesso!' : 'Funcionário inativado com sucesso!');
          fetchFuncionarios();
          fetchStats();
        } else {
          showToast(erroDaResposta(data, 'Erro ao alterar o status do funcionário.'), 'error');
        }
      } else if (confirmarAcao.tipo === 'desligamento') {
        const { funcionario, payload } = confirmarAcao;
        const res = await apiFetch(`${API_URL}/funcionarios/${funcionario.id}/desligamento`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => null);
        if (res.ok) {
          const partes = [
            funcionario.desligado
              ? 'Dados do desligamento atualizados com sucesso.'
              : 'Funcionário desligado com sucesso.'
          ];
          if (data?.usuarios_desativados) {
            partes.push(`${data.usuarios_desativados} login(s) desativado(s).`);
          }
          if (data?.equipes_removidas?.length) {
            partes.push(`Removido de ${data.equipes_removidas.length} equipe(s).`);
          }
          if (data?.avisos?.length) {
            partes.push(data.avisos.join(' '));
          }
          showToast(partes.join(' '));
          setShowDesligamentoModal(false);
          fetchFuncionarios();
          fetchStats();
        } else {
          showToast(erroDaResposta(data, 'Erro ao registrar desligamento.'), 'error');
        }
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao concluir a operação.', 'error');
    } finally {
      setProcessando(false);
      setConfirmarAcao(null);
    }
  };

  const filtros = [
    { key: 'ativos', label: 'Ativos', icon: UserCheck },
    { key: 'inativos', label: 'Inativos', icon: UserX },
    { key: 'desligados', label: 'Desligados', icon: LogOut },
    { key: 'todos', label: 'Todos', icon: Users },
  ];

  const statCards = [
    { title: 'Funcionários Cadastrados', value: stats.total, icon: Users, color: 'from-blue-500 to-primary-600', iconColor: 'text-blue-500' },
    { title: 'Ativos', value: stats.ativos, icon: UserCheck, color: 'from-emerald-500 to-teal-600', iconColor: 'text-emerald-500' },
    { title: 'Inativos', value: stats.inativos, icon: UserX, color: 'from-amber-500 to-orange-600', iconColor: 'text-amber-500' },
    { title: 'Desligados', value: stats.desligados, icon: LogOut, color: 'from-rose-500 to-rose-700', iconColor: 'text-rose-500' },
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
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
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

        <div className="flex flex-wrap items-center justify-center gap-2">
          <div className="flex flex-wrap bg-slate-100 rounded-xl p-1">
            {filtros.map((f) => {
              const Icon = f.icon;
              return (
                <button
                  key={f.key}
                  onClick={() => setFiltroStatus(f.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 min-h-11 rounded-lg text-xs font-bold transition-all cursor-pointer ${
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
        <div className="hidden md:block overflow-x-auto">
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
              ) : lista.status === 'error' ? (
                <tr>
                  <td colSpan={temSst ? 5 : 4}>
                    <ErroCarregamento mensagem={lista.erro} onTentarNovamente={fetchFuncionarios} />
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
                        <div className="flex flex-wrap gap-1">
                          {f.cargo_id ? (
                            <span className="px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 border border-primary-100 text-[10px] font-bold">
                              {cargos.find(c => c.id === f.cargo_id)?.nome || 'Cargo'}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">-</span>
                          )}
                          {f.cargo_id_2 && (
                            <span className="px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-100 text-[10px] font-bold">
                              {cargos.find(c => c.id === f.cargo_id_2)?.nome || 'Cargo 2'}
                            </span>
                          )}
                        </div>
                      </td>
                    )}
                    <td className="px-3 py-3 md:px-6 md:py-4">
                      {f.ativo ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 text-[10px] font-bold">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Ativo
                        </span>
                      ) : f.desligado ? (
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-100 text-[10px] font-bold">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                            Desligado{f.data_desligamento ? ` em ${formatarData(f.data_desligamento)}` : ''}
                          </span>
                          {f.motivo_desligamento && (
                            <p className="text-[10px] text-slate-400 font-semibold">{f.motivo_desligamento}</p>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-100 text-[10px] font-bold">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          Inativo
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 md:px-6 md:py-4">
                      <div className="flex justify-center items-center gap-2">
                        <button
                          onClick={() => openEditModal(f)}
                          className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-700 border border-slate-100 transition-colors"
                          title="Editar"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => handleToggleStatus(f)}
                          className={`w-11 h-11 flex items-center justify-center p-0 rounded border transition-colors cursor-pointer ${
                            f.ativo
                              ? 'bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border-slate-100'
                              : 'bg-slate-50 hover:bg-emerald-50 text-slate-500 hover:text-emerald-700 border-slate-100'
                          }`}
                          title={f.ativo ? 'Inativar' : 'Reativar'}
                        >
                          {f.ativo ? <Power size={15} /> : <RotateCcw size={15} />}
                        </button>
                        {podeGerirFuncionarios && (
                          <button
                            onClick={() => abrirDesligamento(f)}
                            className="w-11 h-11 flex items-center justify-center p-0 rounded bg-slate-50 hover:bg-violet-50 text-slate-500 hover:text-violet-700 border border-slate-100 transition-colors"
                            title={f.desligado ? 'Editar desligamento' : 'Registrar desligamento'}
                          >
                            <LogOut size={15} />
                          </button>
                        )}
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
              <p className="text-xs">Buscando funcionários...</p>
            </div>
          ) : lista.status === 'error' ? (
            <ErroCarregamento mensagem={lista.erro} onTentarNovamente={fetchFuncionarios} />
          ) : funcionarios.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Contact className="mx-auto mb-3 text-slate-300" size={40} />
              <p className="font-semibold mt-2">Nenhum funcionário encontrado.</p>
              <p className="text-xs mt-1">Cadastre funcionários para usar como lista ao lançar férias e no módulo SST.</p>
            </div>
          ) : (
            funcionarios.map((f) => (
              <div key={f.id} className={`px-4 py-3 flex items-center justify-between gap-3 ${!f.ativo ? 'opacity-60' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-slate-900 text-sm truncate">{f.nome}</p>
                  <p className="font-mono text-xs text-slate-500 mt-0.5">{f.cpf}</p>
                  {temSst && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {f.cargo_id && (
                        <span className="px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 border border-primary-100 text-[10px] font-bold">
                          {cargos.find(c => c.id === f.cargo_id)?.nome || 'Cargo'}
                        </span>
                      )}
                      {f.cargo_id_2 && (
                        <span className="px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-100 text-[10px] font-bold">
                          {cargos.find(c => c.id === f.cargo_id_2)?.nome || 'Cargo 2'}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="mt-1.5">
                    {f.ativo ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 text-[10px] font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Ativo
                      </span>
                    ) : f.desligado ? (
                      <div className="space-y-1">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-100 text-[10px] font-bold">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                          Desligado{f.data_desligamento ? ` em ${formatarData(f.data_desligamento)}` : ''}
                        </span>
                        {f.motivo_desligamento && (
                          <p className="text-[10px] text-slate-400 font-semibold">{f.motivo_desligamento}</p>
                        )}
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-100 text-[10px] font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Inativo
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => openEditModal(f)}
                    className="w-11 h-11 flex items-center justify-center rounded bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-700 border border-slate-100 transition-colors"
                    title="Editar"
                  >
                    <Edit2 size={15} />
                  </button>
                  <button
                    onClick={() => handleToggleStatus(f)}
                    className={`w-11 h-11 flex items-center justify-center rounded border transition-colors cursor-pointer ${
                      f.ativo
                        ? 'bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border-slate-100'
                        : 'bg-slate-50 hover:bg-emerald-50 text-slate-500 hover:text-emerald-700 border-slate-100'
                    }`}
                    title={f.ativo ? 'Inativar' : 'Reativar'}
                  >
                    {f.ativo ? <Power size={15} /> : <RotateCcw size={15} />}
                  </button>
                  {podeGerirFuncionarios && (
                    <button
                      onClick={() => abrirDesligamento(f)}
                      className="w-11 h-11 flex items-center justify-center rounded bg-slate-50 hover:bg-violet-50 text-slate-500 hover:text-violet-700 border border-slate-100 transition-colors"
                      title={f.desligado ? 'Editar desligamento' : 'Registrar desligamento'}
                    >
                      <LogOut size={15} />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
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
                <>
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
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">2ª Cargo / Função (opcional)</label>
                    <select
                      name="cargo_id_2"
                      value={form.cargo_id_2}
                      onChange={handleInputChange}
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
                    >
                      <option value="">Selecione o cargo...</option>
                      {cargos
                        .filter(c => c.id !== Number(form.cargo_id))
                        .map(c => (
                          <option key={c.id} value={c.id}>{c.nome}</option>
                        ))}
                    </select>
                    <p className="text-[10px] text-slate-400 mt-1 font-semibold">
                      Se o funcionário acumular outra função, os cursos obrigatórios das duas funções serão considerados na Matriz SST.
                    </p>
                  </div>
                </>
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

      {showDesligamentoModal && desligamentoAlvo && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in duration-200 max-h-[92vh] flex flex-col">
            <div className="bg-slate-900 text-white px-3 py-3 md:px-6 md:py-4 flex items-center justify-between shrink-0">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <LogOut className="text-rose-400" size={20} />
                {desligamentoAlvo.desligado ? 'Editar Desligamento' : 'Registrar Desligamento'}
              </h3>
              <button
                onClick={() => setShowDesligamentoModal(false)}
                className="text-slate-400 hover:text-white text-xl font-bold cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={enviarDesligamento} className="p-6 space-y-4 overflow-y-auto">
              <div>
                <p className="font-bold text-slate-900">{desligamentoAlvo.nome}</p>
                <p className="font-mono text-xs text-slate-500">{desligamentoAlvo.cpf}</p>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 font-semibold flex gap-2">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <span>
                  O cadastro e todo o histórico serão mantidos. O login vinculado será desativado e o
                  funcionário sairá das equipes atuais. Para afastamento temporário, use “Inativar”.
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Data do Desligamento *</label>
                  <div className="relative">
                    <CalendarDays size={16} className="absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="date"
                      name="data_desligamento"
                      value={desligamentoForm.data_desligamento}
                      onChange={handleDesligamentoChange}
                      max={hojeISO()}
                      required
                      className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Motivo *</label>
                  <select
                    name="motivo_desligamento"
                    value={desligamentoForm.motivo_desligamento}
                    onChange={handleDesligamentoChange}
                    required
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm font-semibold"
                  >
                    <option value="">Selecione o motivo...</option>
                    {MOTIVOS_DESLIGAMENTO.map((motivo) => (
                      <option key={motivo} value={motivo}>{motivo}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Observação</label>
                <textarea
                  name="observacao_desligamento"
                  value={desligamentoForm.observacao_desligamento}
                  onChange={handleDesligamentoChange}
                  rows={2}
                  placeholder="Informações complementares (opcional)"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 text-sm resize-none"
                />
              </div>

              <div className="rounded-xl border border-slate-200 p-3 space-y-2">
                <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">Conferência do desligamento</p>

                {carregandoChecklist ? (
                  <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                    <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                    Carregando pendências...
                  </div>
                ) : erroChecklist ? (
                  <p className="text-xs text-rose-700 font-semibold">{erroChecklist}</p>
                ) : checklistDesligamento && (
                  <div className="space-y-2 text-xs">
                    {checklistDesligamento.bloqueios?.length > 0 && (
                      <div className="bg-rose-50 border border-rose-200 rounded-lg p-2.5 text-rose-800 font-semibold space-y-1">
                        {checklistDesligamento.bloqueios.map((bloqueio, idx) => (
                          <p key={idx}>{bloqueio}</p>
                        ))}
                      </div>
                    )}

                    {checklistDesligamento.usuarios_vinculados?.length > 0 && (
                      <p className="text-slate-600">
                        <span className="font-bold">
                          {desligamentoAlvo.desligado ? 'Login(s) vinculado(s):' : 'Login(s) que serão desativados:'}
                        </span>{' '}
                        {checklistDesligamento.usuarios_vinculados.map((u) => u.nome || u.email).join(', ')}
                      </p>
                    )}

                    {checklistDesligamento.equipes?.length > 0 && (
                      <p className="text-slate-600">
                        <span className="font-bold">
                          {desligamentoAlvo.desligado ? 'Equipe(s) vinculada(s):' : 'Sairá da(s) equipe(s):'}
                        </span>{' '}
                        {checklistDesligamento.equipes.map((e) => e.nome).join(', ')}
                      </p>
                    )}

                    {desligamentoAlvo.desligado && checklistDesligamento.usuarios_vinculados?.length > 0 && (
                      <p className="text-rose-700 font-semibold">
                        Há login ativo vinculado a este funcionário desligado. Desative o acesso em Configurações.
                      </p>
                    )}

                    {desligamentoAlvo.desligado && checklistDesligamento.equipes?.length > 0 && (
                      <p className="text-amber-700 font-semibold">
                        Este funcionário ainda aparece em equipe(s). Ajuste a composição em O.S → Equipes.
                      </p>
                    )}

                    {checklistDesligamento.epis_em_uso > 0 && (
                      <p className="text-amber-700 font-semibold">
                        {checklistDesligamento.epis_em_uso} EPI(s) sem devolução registrada.
                      </p>
                    )}

                    {!checklistDesligamento.aso_demissional_registrado && (
                      <p className="text-amber-700 font-semibold">Nenhum ASO demissional registrado.</p>
                    )}

                    {!checklistDesligamento.bloqueios?.length &&
                      !checklistDesligamento.usuarios_vinculados?.length &&
                      !checklistDesligamento.equipes?.length &&
                      checklistDesligamento.epis_em_uso === 0 &&
                      checklistDesligamento.aso_demissional_registrado && (
                        <p className="text-emerald-700 font-semibold">Nenhuma pendência encontrada.</p>
                      )}
                  </div>
                )}
              </div>

              {desligamentoAlvo.desligado && (
                <p className="text-[11px] text-slate-500 font-semibold">
                  Este funcionário já está desligado. Salvar alterações não repete a desativação de logins
                  nem a saída das equipes.
                </p>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowDesligamentoModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={carregandoChecklist || checklistDesligamento?.bloqueios?.length > 0}
                  className="px-5 py-2 bg-rose-600 text-white rounded-xl text-sm font-semibold hover:bg-rose-700 transition-all shadow-md shadow-rose-900/10 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {desligamentoAlvo.desligado ? 'Salvar Desligamento' : 'Registrar Desligamento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ModalConfirmacao
        aberto={confirmarAcao != null}
        titulo={
          confirmarAcao?.tipo === 'toggle'
            ? (confirmarAcao?.novoStatus ? 'Reativar funcionário' : 'Inativar funcionário')
            : confirmarAcao?.funcionario?.desligado
              ? 'Editar desligamento'
              : 'Registrar desligamento'
        }
        mensagem={
          confirmarAcao?.tipo === 'toggle'
            ? `Tem certeza que deseja ${confirmarAcao?.novoStatus ? 'reativar' : 'inativar'} o funcionário "${confirmarAcao?.funcionario?.nome || ''}"?`
            : confirmarAcao?.tipo === 'desligamento'
              ? `Confirma o desligamento de "${confirmarAcao?.funcionario?.nome || ''}" em ${formatarData(confirmarAcao?.payload?.data_desligamento)}?${
                  confirmarAcao?.funcionario?.desligado
                    ? ' Apenas os dados do desligamento serão atualizados.'
                    : ' O cadastro e o histórico serão mantidos; o login vinculado será desativado e o funcionário sairá das equipes.'
                }`
              : ''
        }
        confirmarTexto={
          confirmarAcao?.tipo === 'toggle'
            ? (confirmarAcao?.novoStatus ? 'Reativar' : 'Inativar')
            : 'Confirmar'
        }
        perigo={
          confirmarAcao?.tipo === 'toggle'
            ? !confirmarAcao?.novoStatus
            : true
        }
        loading={processando}
        onConfirmar={confirmarExecucao}
        onCancelar={() => setConfirmarAcao(null)}
      />
    </div>
  );
}

export default Funcionarios;
