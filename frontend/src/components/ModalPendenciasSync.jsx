import React, { useEffect, useState } from 'react';
import {
  X, RefreshCw, Trash2, Image as ImageIcon, ListChecks, AlertTriangle,
  Check, Clock, WifiOff, UserCheck, ShieldAlert,
} from 'lucide-react';
import {
  listarPendentes, descartarPendente, responsavelLocal, estaEmWifi,
} from '../offline/offline';
import { sincronizar } from '../offline/sync';
import ModalConfirmacao from './ModalConfirmacao';

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

/** Conflito definitivo: o servidor recusou a operação/foto com 4xx. */
function ehConflito(item) {
  return item.classificacao === 'conflito';
}

function BadgeEstado({ item }) {
  if (ehConflito(item)) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">
        <ShieldAlert size={10} />
        Conflito
      </span>
    );
  }
  if (item.status === 'erro') {
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
  const [avisoRede, setAvisoRede] = useState(null);
  // Descarte exige confirmação — fotos podem ser a única evidência e operações
  // descartadas nunca chegam ao servidor.
  const [confirmarDescarte, setConfirmarDescarte] = useState(null);

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
  const conflitos = [
    ...fotos.filter(ehConflito).map(f => ({ tipo: 'foto', item: f })),
    ...operacoes.filter(ehConflito).map(op => ({ tipo: 'operacao', item: op })),
  ];

  const reenviarItem = async (tipo, idLocal) => {
    // Sincronização só no Wi-Fi (uploads em dados móveis travam).
    if (!estaEmWifi()) {
      setAvisoRede('Conecte-se ao Wi-Fi para sincronizar (evita travamentos em dados móveis).');
      return;
    }
    setAvisoRede(null);
    setReenviando(prev => [...prev, idLocal]);
    try {
      const seletor = tipo === 'foto' ? { fotos: [idLocal] } : { operacoes: [idLocal] };
      const resultado = await sincronizar(null, seletor);
      setResumoLocal(resultado);
      await carregar();
      onItemSincronizado?.(resultado);
    } finally {
      setReenviando(prev => prev.filter(i => i !== idLocal));
    }
  };

  const pedirDescarte = (tipo, item) => {
    setConfirmarDescarte({ tipo, item });
  };

  const confirmarDescarteItem = async () => {
    const { tipo, item } = confirmarDescarte || {};
    setConfirmarDescarte(null);
    if (!tipo) return;
    await descartarPendente(tipo, item.id_local);
    await carregar();
    onItemSincronizado?.();
  };

  const descartarTodosOsConflitos = async () => {
    setConfirmarDescarte(null);
    for (const { tipo, item } of conflitos) {
      await descartarPendente(tipo, item.id_local);
    }
    await carregar();
    onItemSincronizado?.();
  };

  const temPendentes = fotos.length + operacoes.length > 0;
  const totalFalhas = (resumo?.falhas?.length || 0) + (resumo?.conflitos?.length || 0);
  const temConflitos = conflitos.length > 0;

  const mensagemDescarte = confirmarDescarte
    ? confirmarDescarte.tipo === 'foto'
      ? 'Esta foto é a evidência do serviço e ainda não foi sincronizada. Descartar remove do dispositivo SEM enviar ao servidor — se ela for a única cópia, a evidência será perdida.'
      : ehConflito(confirmarDescarte.item)
        ? 'O servidor recusou esta operação (conflito permanente, ex.: O.S já concluída por outra pessoa). Descartar a remove do dispositivo e a alteração NÃO será aplicada.'
        : 'Esta operação ainda não foi sincronizada. Descartar a remove do dispositivo SEM enviar ao servidor — a alteração não será aplicada.'
    : '';

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
          {avisoRede && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] font-bold text-amber-700 flex items-center gap-2">
              <AlertTriangle size={14} className="shrink-0" />
              {avisoRede}
            </div>
          )}
          {temConflitos && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[11px] font-semibold text-rose-700 flex items-start gap-2">
              <ShieldAlert size={14} className="shrink-0 mt-0.5" />
              <span>
                <b>{conflitos.length} conflito(s) permanente(s):</b> o servidor recusou estas operações
                (ex.: a O.S foi concluída/cancelada por outra pessoa enquanto o tablet estava offline).
                Elas nunca serão aplicadas — revise e descarte para liberar o Finalizar.
              </span>
            </div>
          )}
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
                  <div key={foto.id_local} className={`flex items-center gap-3 rounded-xl p-2.5 border ${
                    ehConflito(foto) ? 'bg-rose-50/60 border-rose-100' : 'bg-slate-50 border-slate-100'
                  }`}>
                    <FotoThumb foto={foto} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-700 truncate">
                        {foto.checklist_item_id ? `Evidência do checklist (item ${foto.checklist_item_id})` : 'Evidência de impedimento'}
                        <span className="text-slate-400 font-semibold"> · O.S {foto.os_id}</span>
                      </p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <BadgeEstado item={foto} />
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
                        onClick={() => pedirDescarte('foto', foto)}
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
                  <div key={op.id_local} className={`flex items-center gap-3 rounded-xl p-2.5 border ${
                    ehConflito(op) ? 'bg-rose-50/60 border-rose-100' : 'bg-slate-50 border-slate-100'
                  }`}>
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
                        <BadgeEstado item={op} />
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
                        onClick={() => pedirDescarte('operacao', op)}
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
          <div className="flex items-center gap-2 flex-wrap">
            {temConflitos && !sincronizando && !offline && (
              <button
                type="button"
                onClick={() => setConfirmarDescarte({ tipo: 'todos' })}
                className="px-4 py-2 bg-rose-600 text-white rounded-xl text-sm font-semibold hover:bg-rose-700 transition-all shadow-md cursor-pointer flex items-center gap-2"
              >
                <Trash2 size={14} />
                Descartar {conflitos.length} conflito(s)
              </button>
            )}
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

      {/* Confirmação de descarte (foto pode ser a única evidência) */}
      <ModalConfirmacao
        aberto={confirmarDescarte != null}
        titulo={confirmarDescarte?.tipo === 'todos'
          ? 'Descartar todos os conflitos'
          : confirmarDescarte?.tipo === 'foto'
            ? 'Descartar evidência fotográfica?'
            : 'Descartar operação?'}
        mensagem={confirmarDescarte?.tipo === 'todos'
          ? 'Todas as operações/fotos em conflito serão removidas do dispositivo e NUNCA serão aplicadas no servidor. Esta ação não pode ser desfeita.'
          : mensagemDescarte}
        confirmarTexto="Descartar"
        onConfirmar={confirmarDescarte?.tipo === 'todos' ? descartarTodosOsConflitos : confirmarDescarteItem}
        onCancelar={() => setConfirmarDescarte(null)}
      />
    </div>
  );
}

export default ModalPendenciasSync;
