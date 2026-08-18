import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

function ModalConfirmacao({
  aberto,
  titulo = 'Confirmar exclusão',
  mensagem = 'Tem certeza que deseja excluir este registro? Esta ação não pode ser desfeita.',
  confirmarTexto = 'Excluir',
  cancelarTexto = 'Cancelar',
  perigo = true,
  loading = false,
  onConfirmar,
  onCancelar,
}) {
  if (!aberto) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full border border-slate-100 overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
          <h3 className="font-bold text-base flex items-center gap-2">
            <AlertTriangle className={perigo ? 'text-rose-400' : 'text-amber-400'} size={18} />
            {titulo}
          </h3>
          <button
            onClick={onCancelar}
            disabled={loading}
            className="text-slate-400 hover:text-white text-xl font-bold p-1 cursor-pointer disabled:opacity-40"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          <p className="text-sm text-slate-600">{mensagem}</p>

          <div className="flex justify-end gap-3 pt-5 border-t border-slate-100 mt-5">
            <button
              type="button"
              onClick={onCancelar}
              disabled={loading}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-all cursor-pointer disabled:opacity-40"
            >
              {cancelarTexto}
            </button>
            <button
              type="button"
              onClick={onConfirmar}
              disabled={loading}
              className={`px-5 py-2 text-white rounded-xl text-sm font-semibold transition-all shadow-md cursor-pointer disabled:opacity-40 flex items-center gap-2 ${
                perigo
                  ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-900/10'
                  : 'bg-primary-600 hover:bg-primary-700 shadow-primary-900/10'
              }`}
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Aguarde...
                </>
              ) : (
                confirmarTexto
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ModalConfirmacao;