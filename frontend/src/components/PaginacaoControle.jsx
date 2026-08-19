import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

function PaginacaoControle({ paginaAtualSegura, totalPaginas, onAnterior, onProximo }) {
  if (totalPaginas <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-2 py-3 border-t border-slate-100 mt-2">
      <button
        onClick={onAnterior}
        disabled={paginaAtualSegura === 1}
        className="w-11 h-11 flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all cursor-pointer disabled:opacity-40"
        title="Página anterior"
      >
        <ChevronLeft size={14} />
      </button>
      <span className="text-xs font-bold text-slate-600 px-2">
        {paginaAtualSegura} / {totalPaginas}
      </span>
      <button
        onClick={onProximo}
        disabled={paginaAtualSegura === totalPaginas}
        className="w-11 h-11 flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all cursor-pointer disabled:opacity-40"
        title="Próxima página"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

export default PaginacaoControle;