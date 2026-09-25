import React, { useCallback, useEffect, useState } from 'react';
import { Search, Printer, Users, Trash2, Check, AlertTriangle, FileDown, CalendarClock } from 'lucide-react';
import { API_URL, apiFetch, erroDaResposta } from '../api';
import ModalConfirmacao from './ModalConfirmacao';

const isoLocal = (data) => {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
};

const formatarData = (data) => {
  if (!data) return '—';
  const texto = String(data).slice(0, 10);
  return texto.length === 10 ? `${texto.slice(8, 10)}/${texto.slice(5, 7)}/${texto.slice(0, 4)}` : texto;
};

const formatarHora = (hora) => (hora ? String(hora).slice(0, 5) : '');

const formatarHorario = (registro) => {
  const desligar = formatarHora(registro.hora_desligar);
  const religar = formatarHora(registro.hora_religar);
  if (!desligar && !religar) return '—';
  return `${desligar || '__:__'} às ${religar || '__:__'}`;
};

const rotuloEquipe = (registro) => {
  const nomes = [];
  if (registro.equipe_nome) nomes.push(registro.equipe_nome);
  (registro.equipes_apoio || []).forEach((apoio) => {
    if (apoio.equipe_nome && !nomes.includes(apoio.equipe_nome)) nomes.push(apoio.equipe_nome);
  });
  return nomes.length ? nomes.join(' + ') : '—';
};

function PainelDesligamentos({ equipes, mostrarToast, abrirPdf, onReimprimir, refreshKey = 0 }) {
  const hoje = new Date();
  const em30Dias = new Date();
  em30Dias.setDate(hoje.getDate() + 30);

  const [registros, setRegistros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);

  const [dataInicio, setDataInicio] = useState(() => isoLocal(hoje));
  const [dataFim, setDataFim] = useState(() => isoLocal(em30Dias));
  const [equipeId, setEquipeId] = useState('');
  const [busca, setBusca] = useState('');

  // Equipes de apoio do desligamento selecionado
  const [modalEquipes, setModalEquipes] = useState(null); // registro
  const [selecionadas, setSelecionadas] = useState([]);
  const [salvandoEquipes, setSalvandoEquipes] = useState(false);

  // Remoção da agenda
  const [removendo, setRemovendo] = useState(null); // registro
  const [excluindo, setExcluindo] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dataInicio) params.set('data_inicio', dataInicio);
      if (dataFim) params.set('data_fim', dataFim);
      if (equipeId) params.set('equipe_id', equipeId);
      if (busca.trim()) params.set('busca', busca.trim());

      const res = await apiFetch(`${API_URL}/os/desligamentos/?${params.toString()}`, { retry: 2 });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setRegistros(data || []);
        setErro(null);
      } else {
        setErro(erroDaResposta(data, 'Erro ao buscar desligamentos.'));
      }
    } catch {
      setErro('Erro de conexão ao buscar desligamentos.');
    } finally {
      setLoading(false);
    }
  }, [dataInicio, dataFim, equipeId, busca]);

  useEffect(() => {
    carregar();
  }, [carregar, refreshKey]);

  const abrirModalEquipes = (registro) => {
    setModalEquipes(registro);
    setSelecionadas((registro.equipes_apoio || []).map((a) => a.equipe_id));
  };

  const alternarEquipe = (id) => {
    setSelecionadas((atual) => (atual.includes(id) ? atual.filter((i) => i !== id) : [...atual, id]));
  };

  const salvarEquipesApoio = async () => {
    if (!modalEquipes) return;
    try {
      setSalvandoEquipes(true);
      const res = await apiFetch(`${API_URL}/os/desligamentos/${modalEquipes.id}/equipes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ equipe_ids: selecionadas }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        mostrarToast('Equipes de apoio atualizadas!');
        setModalEquipes(null);
        carregar();
      } else {
        mostrarToast(erroDaResposta(data, 'Erro ao salvar equipes de apoio.'), 'error');
      }
    } catch {
      mostrarToast('Erro de conexão ao salvar equipes de apoio.', 'error');
    } finally {
      setSalvandoEquipes(false);
    }
  };

  const removerDaAgenda = async () => {
    if (!removendo) return;
    try {
      setExcluindo(true);
      const res = await apiFetch(`${API_URL}/os/desligamentos/${removendo.id}`, { method: 'DELETE' });
      if (res.ok) {
        mostrarToast('Desligamento removido da agenda.');
        carregar();
      } else {
        mostrarToast(erroDaResposta(await res.json().catch(() => null), 'Erro ao remover da agenda.'), 'error');
      }
    } catch {
      mostrarToast('Erro de conexão ao remover da agenda.', 'error');
    } finally {
      setExcluindo(false);
      setRemovendo(null);
    }
  };

  const imprimirAgenda = () => {
    const params = new URLSearchParams();
    if (dataInicio) params.set('data_inicio', dataInicio);
    if (dataFim) params.set('data_fim', dataFim);
    if (equipeId) params.set('equipe_id', equipeId);
    if (busca.trim()) params.set('busca', busca.trim());
    const query = params.toString();
    abrirPdf(`/os/desligamentos/agenda${query ? `?${query}` : ''}`);
  };

  const equipesDisponiveis = (equipes || []).filter(
    (eq) => !modalEquipes || eq.nome !== modalEquipes.equipe_nome
  );

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
          <div className="relative flex-1 min-w-0">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <Search size={16} />
            </span>
            <input
              type="text"
              placeholder="Buscar por local, município, Nota PS, O.S, obra ou equipe..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all text-sm"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-500">
              De
              <input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="px-2.5 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 focus:outline-none focus:border-primary-500"
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-500">
              Até
              <input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="px-2.5 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 focus:outline-none focus:border-primary-500"
              />
            </label>
            <select
              value={equipeId}
              onChange={(e) => setEquipeId(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 bg-white focus:outline-none focus:border-primary-500"
            >
              <option value="">Todas as equipes</option>
              {(equipes || []).map((eq) => (
                <option key={eq.id} value={eq.id}>
                  {eq.numero ? `Nº ${eq.numero} - ${eq.nome}` : eq.nome}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => { setDataInicio(''); setDataFim(''); setEquipeId(''); setBusca(''); }}
              className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Limpar
            </button>
          </div>

          <button
            type="button"
            onClick={imprimirAgenda}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-xs font-bold hover:bg-primary-700 transition-all shadow-md shadow-primary-900/10 cursor-pointer shrink-0"
          >
            <FileDown size={15} /> Imprimir agenda
          </button>
        </div>
        <p className="text-[11px] text-slate-400">
          Os desligamentos entram na agenda ao imprimir a O.S com a Solicitação de Desligamento. As equipes de apoio
          são definidas aqui e não saem na folha da Celesc.
        </p>
      </div>

      {/* Lista */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-14">
            <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-slate-400">Buscando desligamentos...</p>
          </div>
        ) : erro ? (
          <div className="py-10 text-center">
            <AlertTriangle className="mx-auto mb-2 text-amber-400" size={28} />
            <p className="text-sm font-bold text-slate-600">{erro}</p>
            <button
              type="button"
              onClick={carregar}
              className="mt-3 px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              Tentar novamente
            </button>
          </div>
        ) : registros.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <CalendarClock className="mx-auto mb-3 text-slate-300" size={40} />
            <p className="font-semibold mt-2">Nenhum desligamento no período.</p>
            <p className="text-xs mt-1">Imprima uma O.S com a Solicitação de Desligamento para registrá-lo.</p>
          </div>
        ) : (
          <>
            {/* Tabela (desktop) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-bold text-xs uppercase tracking-wider">
                    <th className="px-4 py-3">Data</th>
                    <th className="px-4 py-3">Horário</th>
                    <th className="px-4 py-3">Local</th>
                    <th className="px-4 py-3">Nota PS</th>
                    <th className="px-4 py-3">Município</th>
                    <th className="px-4 py-3">Equipe</th>
                    <th className="px-4 py-3">O.S</th>
                    <th className="px-4 py-3 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {registros.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">{formatarData(r.data)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{formatarHorario(r)}</td>
                      <td className="px-4 py-3 max-w-[220px] truncate" title={r.local || ''}>{r.local || '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs">{r.projeto_sap || '—'}</td>
                      <td className="px-4 py-3">{r.municipio || '—'}</td>
                      <td className="px-4 py-3 min-w-[180px]">
                        <span className="font-semibold text-slate-700">{rotuloEquipe(r)}</span>
                        {(r.equipes_apoio || []).length > 0 && (
                          <span className="block text-[10px] font-bold text-emerald-600 mt-0.5">
                            +{r.equipes_apoio.length} equipe(s) de apoio
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs font-bold text-primary-700 whitespace-nowrap">
                        {r.codigo_os || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-center items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onReimprimir(r.os_id)}
                            title="Reimprimir a folha com os dados atuais da O.S"
                            className="w-10 h-10 flex items-center justify-center rounded bg-slate-50 hover:bg-primary-50 text-slate-500 hover:text-primary-700 border border-slate-100 transition-colors cursor-pointer"
                          >
                            <Printer size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => abrirModalEquipes(r)}
                            title="Equipes de apoio"
                            className="w-10 h-10 flex items-center justify-center rounded bg-slate-50 hover:bg-emerald-50 text-slate-500 hover:text-emerald-700 border border-slate-100 transition-colors cursor-pointer"
                          >
                            <Users size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRemovendo(r)}
                            title="Remover da agenda"
                            className="w-10 h-10 flex items-center justify-center rounded bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-100 transition-colors cursor-pointer"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Cards (mobile) */}
            <div className="md:hidden divide-y divide-slate-100">
              {registros.map((r) => (
                <div key={r.id} className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900 text-sm">{formatarData(r.data)}</span>
                    <span className="text-xs font-semibold text-slate-500">{formatarHorario(r)}</span>
                  </div>
                  <p className="text-sm text-slate-700">{r.local || '—'}</p>
                  <p className="text-xs text-slate-500">
                    {r.municipio || '—'} · Nota PS {r.projeto_sap || '—'} · <span className="font-mono font-bold text-primary-700">{r.codigo_os || '—'}</span>
                  </p>
                  <p className="text-xs font-semibold text-slate-600">Equipe: {rotuloEquipe(r)}</p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => onReimprimir(r.os_id)}
                      className="h-10 px-3 flex items-center gap-1.5 rounded-lg bg-slate-50 border border-slate-100 text-xs font-bold text-slate-600 cursor-pointer"
                    >
                      <Printer size={14} /> Reimprimir
                    </button>
                    <button
                      type="button"
                      onClick={() => abrirModalEquipes(r)}
                      className="h-10 px-3 flex items-center gap-1.5 rounded-lg bg-slate-50 border border-slate-100 text-xs font-bold text-slate-600 cursor-pointer"
                    >
                      <Users size={14} /> Equipes
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemovendo(r)}
                      className="h-10 w-10 flex items-center justify-center rounded-lg bg-rose-50 border border-rose-100 text-rose-600 cursor-pointer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Modal: equipes de apoio */}
      {modalEquipes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden max-h-[92vh] flex flex-col">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
              <h3 className="text-sm font-extrabold">Equipes de apoio</h3>
              <button type="button" onClick={() => setModalEquipes(null)} className="text-slate-400 hover:text-white text-xl font-bold cursor-pointer">
                &times;
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs">
                <p className="font-bold text-slate-700">
                  {modalEquipes.codigo_os} · {modalEquipes.local || 'Sem local'}
                </p>
                <p className="text-slate-500 mt-1">
                  Equipe principal: <span className="font-semibold">{modalEquipes.equipe_nome || '—'}</span>
                </p>
              </div>

              <p className="text-[11px] text-slate-500">
                Selecione as equipes que vão auxiliar no desligamento. Elas aparecem na agenda e no PDF, mas não na
                folha enviada à Celesc.
              </p>

              <div className="space-y-1.5">
                {equipesDisponiveis.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">Nenhuma outra equipe cadastrada.</p>
                ) : (
                  equipesDisponiveis.map((eq) => (
                    <label
                      key={eq.id}
                      className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 cursor-pointer hover:bg-slate-50 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selecionadas.includes(eq.id)}
                        onChange={() => alternarEquipe(eq.id)}
                        className="w-4 h-4 accent-primary-600 cursor-pointer"
                      />
                      <span className="text-xs font-semibold text-slate-700">
                        {eq.numero ? `Nº ${eq.numero} - ${eq.nome}` : eq.nome}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setModalEquipes(null)}
                className="px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={salvarEquipesApoio}
                disabled={salvandoEquipes}
                className="flex items-center gap-1.5 px-5 py-2.5 bg-primary-600 text-white rounded-xl text-xs font-bold hover:bg-primary-700 transition-all cursor-pointer disabled:opacity-50"
              >
                {salvandoEquipes ? 'Salvando...' : (<><Check size={14} /> Salvar equipes</>)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remoção da agenda */}
      <ModalConfirmacao
        aberto={removendo != null}
        titulo="Remover da agenda"
        mensagem={removendo ? `Remover o desligamento da O.S ${removendo.codigo_os || ''} da agenda? A O.S não será alterada.` : ''}
        loading={excluindo}
        onConfirmar={removerDaAgenda}
        onCancelar={() => setRemovendo(null)}
      />
    </div>
  );
}

export default PainelDesligamentos;
