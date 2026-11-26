import React from 'react';
import { X, RefreshCw, Trash2, AlertTriangle, Image as ImageIcon, ClipboardList } from 'lucide-react';

export default function ModalPendenciasInspecoes({
  aberto,
  onFechar,
  pendentes,
  sincronizando,
  onSincronizar,
  onDescartar,
}) {
  if (!aberto) return null;
  const inspecoes = pendentes?.inspecoes || [];
  const fotos = pendentes?.fotos || [];

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/50 flex items-center justify-center p-3">
      <div className="w-full max-w-lg max-h-[90dvh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-extrabold text-slate-800">Pendências de sincronização</h2>
            <p className="text-[11px] text-slate-400">Itens que ainda não chegaram ao servidor.</p>
          </div>
          <button onClick={onFechar} className="w-10 h-10 rounded-xl text-slate-400 hover:bg-slate-100 flex items-center justify-center">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {inspecoes.length === 0 && fotos.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-6">Nenhuma pendência.</p>
          )}

          {inspecoes.map((item) => (
            <div key={item.id_local} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-start gap-2">
                <ClipboardList size={16} className="text-slate-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-extrabold text-slate-800">
                    {item.codigo || 'Rascunho local'} · {item.modelo_nome || 'Inspeção'}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">{item.local_inspecao}</p>
                  <p className="text-[11px] text-slate-400">
                    {item.sync_erro || (item.id_servidor ? 'Alterações locais pendentes.' : 'Ainda não criada no servidor.')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onDescartar?.('inspecao', item.id_local)}
                  className="w-8 h-8 rounded-lg text-rose-600 hover:bg-rose-50 flex items-center justify-center shrink-0"
                  title="Descartar pendência"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {item.sync_erro && (
                <p className="mt-2 rounded-lg bg-rose-50 border border-rose-100 px-2 py-1.5 text-[10px] font-semibold text-rose-700 flex gap-1">
                  <AlertTriangle size={11} className="shrink-0 mt-0.5" /> {item.sync_erro}
                </p>
              )}
            </div>
          ))}

          {fotos.map((foto) => (
            <div key={foto.id_local} className="rounded-xl border border-slate-200 p-3 flex items-center gap-2">
              <ImageIcon size={16} className="text-slate-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-800 truncate">{foto.arquivo?.nome || 'Foto'}</p>
                <p className="text-[11px] text-slate-400">
                  Item {foto.classificacao} {foto.erro ? `· ${foto.erro}` : '· aguardando envio'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDescartar?.('foto', foto.id_local)}
                className="w-8 h-8 rounded-lg text-rose-600 hover:bg-rose-50 flex items-center justify-center shrink-0"
                title="Descartar foto"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-100 p-3 flex gap-2">
          <button
            type="button"
            onClick={onFechar}
            className="flex-1 min-h-11 rounded-xl border border-slate-200 text-xs font-bold text-slate-600"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={onSincronizar}
            disabled={sincronizando}
            className="flex-[2] min-h-11 rounded-xl bg-primary-600 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw size={14} className={sincronizando ? 'animate-spin' : ''} />
            {sincronizando ? 'Sincronizando...' : 'Tentar novamente'}
          </button>
        </div>
      </div>
    </div>
  );
}
