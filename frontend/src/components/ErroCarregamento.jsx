import React from 'react';
import { AlertTriangle } from 'lucide-react';

function ErroCarregamento({ mensagem, onTentarNovamente }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center px-4">
      <AlertTriangle className="text-rose-400 mb-3" size={40} />
      <p className="font-semibold text-slate-600">{mensagem || 'Erro ao carregar os dados.'}</p>
      {onTentarNovamente && (
        <button
          onClick={onTentarNovamente}
          className="mt-4 px-4 py-2 min-h-11 flex items-center justify-center bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold transition-all cursor-pointer"
        >
          Tentar novamente
        </button>
      )}
    </div>
  );
}

export default ErroCarregamento;