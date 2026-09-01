import React, { useEffect, useState } from 'react';
import {
  X, RefreshCw, Trash2, Image as ImageIcon, ListChecks, AlertTriangle,
  Check, Clock, WifiOff, UserCheck,
} from 'lucide-react';
import {
  listarPendentes, descartarPendente, responsavelLocal,
} from '../offline/offline';
import { sincronizar } from '../offline/sync';

const LABEL_TIPO = {
  checklist_resposta: 'Resposta do checklist',
  status: 'Transição de status',
  apontamento_play: 'Início de H.H.',
  apontamento_pause: 'Pausa de H.H.',
  material: 'Lançamento de serviço',
};

function fmtHora(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '-';
  }
}

function FotoThumb({ foto }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    try {
      setUrl(URL.createObjectURL(foto.arquivo?.blob));
    } catch {
      setUrl(null);
    }
    return () => { if (url) URL.revokeObjectURL(url); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foto.id_local]);
  if (!url) return <ImageIcon size={16} className="text-slate-400" />;
  return (
    <img
      src={url}
      alt="Evidência"
      className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0"
    />
  );
}

function BadgeEstado({ status }) {
  if (status === 'erro') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">
        <AlertTriangle size={10} />
        Erro
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold">
      <Clock size={10} />
      Pendente
    </span>
  );
}

function ModalPendenciasSync({
  aberto,
  onFechar,
  sincronizando,
  offline,
  ultimoResumo,
  onSincronizarTudo,
  onItemSincronizado,
}) {
  const [fotos, setFotos] = useState([]);
  const [operacoes, setOperacoes] = useState([]);
  const [reenviando, setReenviando] = useState([]);
  const [responsavel, setResponsavel] = useState(null);
  const [resumoLocal, setResumoLocal] = useState(null);

  const carregar = async () => {
    const p = await listarPendentes();
    const porData = (a, b) => String(a.criado_em || '').localeCompare(String(b.criado_em || ''));
    setFotos(p.fotos.sort(porData));
    setOperacoes(p.operacoes.sort(porData));
    setResponsavel(await responsavelLocal());
  };

  useEffect(() => {
    if (aberto) {
      carregar();
      setResumoLocal(null);
    }
  }, [aberto, sincronizando]);

  if (!aberto) return null;

  const resumo = resumoLocal || ultimoResumo || null;

  const reenviarItem = async (tipo, idLocal) => {
    setReenviando(prev => [...prev, idLocal]);
    const seletor = tipo === 'foto' ? { fotos: [idLocal] } : { operacoes: [idLocal] };
    const resultado = await sincronizar(null, seletor);
    setResumoLocal(resultado);
    await carregar();
    onItemSincronizado?.(resultado);
    setReenviando(prev => prev.filter(i => i !== idLocal));
  };

  const descartar = async (tipo, idLocal) => {
    await descartarPendente(tipo, idLocal);
    await carregar();
    onItemSincronizado?.();
  };

  const temPendentes = fotos.length + operacoes.length > 0;
  const totalFalhas = (resumo?.falhas?.length || 0) + (resumo?.conflitos?.length || 0);

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full border border-slate-100 overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <h3 className="font-bold text-base flex items-center gap-2">
            <RefreshCw size={18} className="text-primary-400" />
            Pendências de sincronização
            <span className="text-xs font-bold bg-white/10 text-white/90 rounded-full px-2.5 py-0.5">
              {fotos.length + operacoes.length}
            </span>
          </h3>
          <button
            onClick={onFechar}
            disabled={sincronizando}
            className="text-slate-400 hover:text-white text-xl font-bold p-1 cursor-pointer disabled:opacity-40"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {!temPendentes && (
            <div className="text-center py-10 text-slate-400">
              <Check className="mx-auto mb-3 text-emerald-400" size={36} />
              <p className="font-bold text-slate-600">Nada pendente no dispositivo.</p>
              <p className="text-xs mt-1">Tudo que foi feito no campo já está no servidor.</p>
            </div>
          )}

          {/* Resumo da última sincronização */}
          {resumo && (resumo.fotosEnviadas + resumo.operacoesEnviadas + totalFalhas > 0) && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                <p className="text-[10px] font-bold text-emerald-600 uppercase">Fotos enviadas</p>
                <p className="text-xl font-black text-emerald-700">{resumo.fotosEnviadas}</p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
                <p className="text-[10px] font-bold text-blue-600 uppercase">Operações</p>
                <p className="text-xl font-black text-blue-700">{resumo.operacoesEnviadas}</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                <p className="text-[10px] font-bold text-amber-600 uppercase">Falhas</p>
                <p className="text-xl font-black text-amber-700">{resumo.falhas.length}</p>
              </div>
              <div className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                <p className="text-[10px] font-bold text-rose-600 uppercase">Conflitos</p>
                <p className="text-xl font-black text-rose-700">{resumo.conflitos.length}</p>
              </div>
            </div>
          )}

          {/* Fotos */}
          {fotos.length > 0 && (
            <div>
              <p className="text-xs font-extrabold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <ImageIcon size={13} /> Fotos ({fotos.length})
              </p>
              <div className="space-y-2">
                {fotos.map(foto => (
                  <div key={foto.id_local} className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl p-2.5">
                    <FotoThumb foto={foto} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-700 truncate">
                        {foto.checklist_item_id ? `Evidência do checklist (item ${foto.checklist_item_id})` : 'Evidência de impedimento'}
                        <span className="text-slate-400 font-semibold"> · O.S {foto.os_id}</span>
                      </p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <BadgeEstado status={foto.status || 'pendente'} />
                        {foto.tentativas > 0 && (
                          <span className="text-[10px] text-slate-400 font-semibold">
                            {foto.tentativas} tentativa(s)
                          </span>
                        )}
                        {foto.erro && (
                          <span className="text-[10px] text-rose-500 font-semibold truncate max-w-full">{foto.erro}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => reenviarItem('foto', foto.id_local)}
                        disabled={sincronizando || offline || reenviando.includes(foto.id_local)}
                        title="Reenviar"
                        className="w-9 h-9 flex items-center justify-center rounded-lg bg-primary-50 text-primary-600 hover:bg-primary-100 border border-primary-100 transition-colors cursor-pointer disabled:opacity-40"
                      >
                        <RefreshCw size={14} className={reenviando.includes(foto.id_local) ? 'animate-spin' : ''} />
                      </button>
                      <button
                        onClick={() => descartar('foto', foto.id_local)}
                        title="Descartar"
                        className="w-9 h-9 flex items-center justify-center rounded-lg bg-slate-50 text-slate-500 hover:bg-rose-50 hover:text-rose-600 border border-slate-100 transition-colors cursor-pointer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Operações */}
          {operacoes.length > 0 && (
            <div>
              <p className="text-xs font-extrabold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <ListChecks size={13} /> Operações ({operacoes.length})
              </p>
              <div className="space-y-2">
                {operacoes.map(op => (
                  <div key={op.id_local} className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl p-2.5">
                    <div className="w-10 h-10 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                      <ListChecks size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-700">
                        {LABEL_TIPO[op.tipo] || op.tipo}
                        <span className="text-slate-400 font-semibold"> · O.S {op.os_id}</span>
                        <span className="text-slate-400 font-semibold"> · {fmtHora(op.criado_em)}</span>
                      </p>
                      {op.tipo === 'status' && op.payload?.novo_status && (
                        <p className="text-[10px] text-slate-500 font-semibold mt-0.5">
                          → {String(op.payload.novo_status).replace(/_/g, ' ')}
                        </p>
                      )}
                      {op.tipo === 'material' && (
                        <p className="text-[10px] text-slate-500 font-semibold mt-0.5">
                          Serviço #{op.payload?.produto_id} · {op.payload?.quantidade_usada} peça(s) ·{' '}
                          USC {op.payload?.tipo_usc === 'especial' ? 'especial' : 'normal'}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <BadgeEstado status={op.status || 'pendente'} />
                        {op.tentativas > 0 && (
                          <span className="text-[10px] text-slate-400 font-semibold">
                            {op.tentativas} tentativa(s)
                          </span>
                        )}
                        {op.erro && (
                          <span className="text-[10px] text-rose-500 font-semibold truncate max-w-full">{op.erro}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => reenviarItem('operacao', op.id_local)}
                        disabled={sincronizando || offline || reenviando.includes(op.id_local)}
                        title="Reenviar"
                        className="w-9 h-9 flex items-center justify-center rounded-lg bg-primary-50 text-primary-600 hover:bg-primary-100 border border-primary-100 transition-colors cursor-pointer disabled:opacity-40"
                      >
                        <RefreshCw size={14} className={reenviando.includes(op.id_local) ? 'animate-spin' : ''} />
                      </button>
                      <button
                        onClick={() => descartar('operacao', op.id_local)}
                        title="Descartar"
                        className="w-9 h-9 flex items-center justify-center rounded-lg bg-slate-50 text-slate-500 hover:bg-rose-50 hover:text-rose-600 border border-slate-100 transition-colors cursor-pointer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-100 bg-slate-50 flex flex-col sm:flex-row items-center gap-3">
          <div className="flex-1 text-[11px] text-slate-400 font-semibold flex items-center gap-1.5">
            {responsavel?.nome && (
              <>
                <UserCheck size={13} />
                Sincronizado por {responsavel.nome}
              </>
            )}
          </div>
          {offline && (
            <span className="text-[11px] font-bold text-amber-600 flex items-center gap-1">
              <WifiOff size={13} /> Sem conexão — reenviar disponível ao reconectar
            </span>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onFechar}
              disabled={sincronizando}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-100 transition-all cursor-pointer disabled:opacity-40"
            >
              Fechar
            </button>
            <button
              type="button"
              onClick={onSincronizarTudo}
              disabled={sincronizando || offline || !temPendentes}
              className="px-5 py-2 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-all shadow-md shadow-primary-900/10 cursor-pointer disabled:opacity-40 flex items-center gap-2"
            >
              <RefreshCw size={15} className={sincronizando ? 'animate-spin' : ''} />
              {sincronizando ? 'Sincronizando...' : 'Reenviar tudo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ModalPendenciasSync;
