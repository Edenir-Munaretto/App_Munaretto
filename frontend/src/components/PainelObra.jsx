import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, Building, ClipboardList, FileDown, FileText, FolderOpen,
  MapPin, Package, RefreshCw, X,
} from 'lucide-react';
import { API_URL, apiFetch } from '../api';
import { unidadeContrato } from '../utils/contratos';
import TerminoObra from './TerminoObra';

// ---------------------------------------------------------------------------
// Painel de gestão consolidada por obra (Fase 1): resumo da obra, O.S e
// serviços agregados por contrato + download dos relatórios PDF.
// Drawer no desktop / tela cheia no mobile (padrão do PainelExecucao).
// ---------------------------------------------------------------------------

const FILTROS = [
  { id: 'todas', rotulo: 'Todas' },
  { id: 'ativas', rotulo: 'Em execução' },
  { id: 'encerradas', rotulo: 'Encerradas' },
];

const ROTULOS_STATUS = {
  rascunho: 'Rascunho',
  aberta: 'Aberta',
  em_andamento: 'Em Andamento',
  impedida: 'Impedida',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};

const CORES_STATUS = {
  rascunho: 'bg-slate-100 text-slate-600 border-slate-200',
  aberta: 'bg-primary-100 text-primary-700 border-primary-200',
  em_andamento: 'bg-sky-100 text-sky-700 border-sky-200',
  impedida: 'bg-orange-100 text-orange-700 border-orange-200',
  concluida: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  cancelada: 'bg-rose-100 text-rose-600 border-rose-200',
};

const fmtData = (iso) => {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

const fmtNumero = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

const rotuloUnidade = (unidade) =>
  unidade === 'USC'
    ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-violet-50 text-violet-700 border-violet-200';

function BlocoVazio({ texto }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 px-6 py-10 text-center">
      <p className="text-xs font-bold text-slate-500">{texto}</p>
    </div>
  );
}

export default function PainelObra({ obra, onFechar, onAbrirOS, mostrarToast }) {
  const [filtro, setFiltro] = useState('todas');
  const [aba, setAba] = useState('os'); // os | servicos
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [gerando, setGerando] = useState(false);
  const [terminoAberto, setTerminoAberto] = useState(false);

  const carregarResumo = useCallback(async (status) => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await apiFetch(`${API_URL}/os/obras/${obra.id}/resumo?status=${encodeURIComponent(status)}`);
      if (!res.ok) {
        const corpo = await res.json().catch(() => null);
        setErro(corpo?.detail || 'Falha ao carregar o resumo da obra.');
        setDados(null);
        return;
      }
      setDados(await res.json());
    } catch {
      setErro('Falha de conexão ao carregar o resumo da obra.');
      setDados(null);
    } finally {
      setCarregando(false);
    }
  }, [obra.id]);

  useEffect(() => {
    carregarResumo(filtro);
  }, [filtro, carregarResumo]);

  const baixarPdf = async (recurso, arquivo) => {
    setGerando(true);
    try {
      const res = await apiFetch(`${API_URL}/os/obras/${obra.id}/${recurso}?status=${encodeURIComponent(filtro)}`);
      if (!res.ok) {
        mostrarToast('Erro ao gerar o PDF.', 'error');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = arquivo;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      mostrarToast('Falha de conexão ao gerar o PDF.', 'error');
    } finally {
      setGerando(false);
    }
  };

  const resumo = dados?.resumo || null;

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto shadow-2xl border-l border-slate-200 w-full lg:left-auto lg:w-[560px] xl:w-[680px] bg-slate-50">
      <div className="p-4 lg:p-6 space-y-4 pb-10">

        {/* Cabeçalho da obra + filtros + ações */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400">
                Gestão da obra
              </p>
              <h2 className="text-lg font-extrabold text-slate-800 leading-tight break-words">{obra.nome}</h2>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mt-1">
                <Building size={11} className="text-slate-400 flex-shrink-0" />
                <span className="truncate">{obra.clientes?.nome || obra.cliente_celesc || 'Sem cliente'}</span>
              </p>
              {(obra.cidade || obra.endereco) && (
                <p className="flex items-start gap-1.5 text-[10px] text-slate-400 leading-tight mt-0.5">
                  <MapPin size={10} className="text-slate-400 mt-0.5 flex-shrink-0" />
                  <span className="break-words">
                    {obra.endereco || ''}{obra.endereco && obra.cidade ? ' · ' : ''}{obra.cidade || ''}
                  </span>
                </p>
              )}
            </div>
            <button
              onClick={onFechar}
              className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Fechar"
            >
              <X size={18} />
            </button>
          </div>

          {/* Filtro de status (rótulo com o total real da obra) */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400 mr-0.5">Status</span>
            {FILTROS.map(f => {
              const ativo = filtro === f.id;
              const contagem = !resumo ? '' : f.id === 'todas' ? resumo.total : f.id === 'ativas' ? resumo.ativas : resumo.encerradas;
              return (
                <button
                  key={f.id}
                  onClick={() => setFiltro(f.id)}
                  className={`px-3 py-1.5 rounded-full border text-[11px] font-bold transition-all cursor-pointer ${
                    ativo
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-primary-300'
                  }`}
                >
                  {f.rotulo}{contagem !== '' ? ` (${contagem})` : ''}
                </button>
              );
            })}
          </div>

          {/* Ações: relatórios PDF e carta de término */}
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => baixarPdf('relatorio', `obra_${obra.id}_relatorio.pdf`)}
              disabled={gerando}
              title="Baixar o relatório da obra (PDF)"
              className="flex items-center justify-center gap-1.5 px-2 py-2 bg-primary-600 text-white rounded-xl text-[10px] font-extrabold hover:bg-primary-700 transition-all cursor-pointer disabled:opacity-50"
            >
              <FileDown size={12} /> Relatório da Obra
            </button>
            <button
              onClick={() => baixarPdf('servicos', `obra_${obra.id}_servicos.pdf`)}
              disabled={gerando}
              title="Baixar os serviços por obra (PDF)"
              className="flex items-center justify-center gap-1.5 px-2 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-[10px] font-extrabold hover:bg-slate-50 transition-all cursor-pointer disabled:opacity-50"
            >
              <FileDown size={12} /> Serviços por Obra
            </button>
            <button
              onClick={() => setTerminoAberto(true)}
              title="Preencher a carta de término (conclusão) da obra"
              className="flex items-center justify-center gap-1.5 px-2 py-2 bg-emerald-600 text-white rounded-xl text-[10px] font-extrabold hover:bg-emerald-700 transition-all cursor-pointer"
            >
              <FileText size={12} /> Término
            </button>
          </div>
        </div>

        {terminoAberto && (
          <TerminoObra obra={obra} onFechar={() => setTerminoAberto(false)} mostrarToast={mostrarToast} />
        )}

        {carregando ? (
          <div className="flex flex-col items-center justify-center gap-2 py-14 text-slate-400">
            <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-semibold">Carregando resumo da obra...</p>
          </div>
        ) : erro ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-6 text-center space-y-3">
            <p className="flex items-center justify-center gap-2 text-xs font-bold text-rose-600">
              <AlertTriangle size={14} /> {erro}
            </p>
            <button
              onClick={() => carregarResumo(filtro)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-rose-200 text-rose-600 text-[11px] font-bold hover:bg-rose-100 transition-colors cursor-pointer"
            >
              <RefreshCw size={12} /> Tentar novamente
            </button>
          </div>
        ) : dados && (
          <>
            {/* Contadores coloridos (padrão do PainelExecucao) */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-sky-50 border border-sky-100 rounded-2xl p-3">
                <p className="text-[9px] font-extrabold uppercase tracking-wider text-sky-500">Em execução</p>
                <p className="text-2xl font-black text-sky-700 leading-tight">{resumo?.ativas || 0}</p>
              </div>
              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3">
                <p className="text-[9px] font-extrabold uppercase tracking-wider text-emerald-500">Encerradas</p>
                <p className="text-2xl font-black text-emerald-700 leading-tight">{resumo?.encerradas || 0}</p>
              </div>
              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3">
                <p className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500">O.S total</p>
                <p className="text-2xl font-black text-slate-700 leading-tight">{resumo?.total || 0}</p>
              </div>
            </div>

            <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400 px-1">
              <span>Período: {resumo?.periodo?.inicio ? `${fmtData(resumo.periodo.inicio)} a ${fmtData(resumo.periodo.fim)}` : 'sem O.S'}</span>
              <span className="text-[9px]">{dados.os?.length} O.S no filtro selecionado</span>
            </div>

            {/* Abas */}
            <div className="flex bg-slate-100 rounded-xl p-1">
              {[
                ['os', 'O.S da Obra', ClipboardList],
                ['servicos', 'Serviços da Obra', Package],
              ].map(([chave, rotulo, Icone]) => (
                <button
                  key={chave}
                  onClick={() => setAba(chave)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    aba === chave ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Icone size={14} /> {rotulo}
                </button>
              ))}
            </div>

            {aba === 'os' && (
              dados.os?.length === 0 ? (
                <BlocoVazio texto="Nenhuma O.S encontrada para o filtro selecionado." />
              ) : (
                <div className="bg-white rounded-2xl border border-slate-100 divide-y divide-slate-100 overflow-hidden">
                  {dados.os.map(os => (
                    <button
                      key={os.id}
                      onClick={() => onAbrirOS?.(os)}
                      className="w-full flex items-stretch hover:bg-slate-50 transition-colors text-left cursor-pointer"
                      title={`Abrir a O.S ${os.codigo}`}
                    >
                      <span className="flex-1 min-w-0 px-4 py-3">
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-bold text-primary-700">{os.codigo}</span>
                          <span className={`px-2 py-0.5 rounded-full border text-[9px] font-extrabold uppercase tracking-wide ${CORES_STATUS[os.status] || CORES_STATUS.rascunho}`}>
                            {ROTULOS_STATUS[os.status] || os.status}
                          </span>
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">
                            {unidadeContrato(os.tipo)}
                          </span>
                        </span>
                        <span className="block text-[10px] text-slate-400 font-semibold mt-1.5 space-x-2">
                          <span>Abertura {fmtData(os.data_abertura)}</span>
                          {os.status === 'concluida' || os.status === 'cancelada' ? (
                            <span>· Encerrada em {fmtData(os.data_fim)}</span>
                          ) : null}
                          <span>· {os.fotos_count || 0} foto(s)</span>
                          {os.equipe ? <span>· Equipe: {os.equipe}</span> : null}
                        </span>
                      </span>
                      <span className="flex flex-col items-end justify-center gap-1 pr-4 shrink-0">
                        <span className="text-sm font-black text-slate-700">{fmtNumero(os.total_aplicado)}</span>
                        <span className="flex items-center gap-1 text-[9px] font-bold text-slate-400 uppercase tracking-wide">
                          <span className={`px-1.5 py-0.5 rounded-full border ${rotuloUnidade(unidadeContrato(os.tipo))}`}>
                            {unidadeContrato(os.tipo)}
                          </span>
                          aplicado
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )
            )}

            {aba === 'servicos' && (
              dados.contratos?.length === 0 ? (
                <BlocoVazio texto="Nenhum serviço lançado nas O.S deste filtro." />
              ) : (
                <div className="space-y-3">
                  {dados.contratos.map(contrato => (
                    <div key={contrato.tipo} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                        <p className="flex items-center gap-2 text-xs font-extrabold text-slate-700">
                          <FolderOpen size={13} className="text-primary-600" />
                          {contrato.tipo === 'construcao' ? 'Construção' : contrato.tipo === 'manutencao' ? 'Manutenção' : 'Linha Viva'}
                        </p>
                        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-extrabold ${rotuloUnidade(contrato.unidade)}`}>
                          {contrato.unidade} · {fmtNumero(contrato.total)}
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-[11px]">
                          <thead>
                            <tr className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                              <th className="px-4 py-2">Cód.</th>
                              <th className="px-3 py-2">Serviço</th>
                              <th className="px-3 py-2 text-center">O.S usadas</th>
                              <th className="px-3 py-2 text-center">Qtd serv.</th>
                              <th className="px-3 py-2 text-center">{contrato.unidade} unit.</th>
                              <th className="px-4 py-2 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {contrato.itens.map(item => (
                              <tr key={`${item.produto_id}-${item.codigo_servico}-${item.tipo}`} className="hover:bg-slate-50/60">
                                <td className="px-4 py-2 font-mono text-[10px] font-bold text-primary-700 whitespace-nowrap">
                                  {item.codigo_servico || '—'}
                                </td>
                                <td className="px-3 py-2 text-slate-700 font-semibold">
                                  {item.nome}
                                  {item.tipo !== 'normal' && (
                                    <span className="ml-1.5 text-[9px] font-extrabold uppercase text-orange-600">(especial)</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-center text-slate-500 font-bold">{item.os_usadas}</td>
                                <td className="px-3 py-2 text-center text-slate-600 font-semibold whitespace-nowrap">
                                  {fmtNumero(item.pecas)}
                                </td>
                                <td className="px-3 py-2 text-center text-slate-400 font-semibold whitespace-nowrap">
                                  {item.fator ? fmtNumero(item.fator) : '—'}
                                </td>
                                <td className="px-4 py-2 text-right font-black text-slate-700 whitespace-nowrap">
                                  {fmtNumero(item.total)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}
