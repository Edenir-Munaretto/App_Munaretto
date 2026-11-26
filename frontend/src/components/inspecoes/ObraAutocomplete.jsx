import React, { useEffect, useMemo, useRef, useState } from 'react';

const CLASSE_INPUT =
  'w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 disabled:bg-slate-50 disabled:text-slate-500';

function clienteDaObra(obra) {
  return obra?.obra_cliente || obra?.clientes?.nome || obra?.cliente_celesc || '';
}

function rotuloObra(obra) {
  return [obra?.nome, clienteDaObra(obra)].filter(Boolean).join(' — ');
}

/** Texto usado na busca em memória (sem chamadas extras ao servidor). */
function textoBusca(obra) {
  return [
    obra?.nome,
    clienteDaObra(obra),
    obra?.cidade,
    obra?.endereco,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export default function ObraAutocomplete({
  obras = [],
  value,
  disabled = false,
  onChange,
  placeholder = 'Digite o nome/Nota PS ou o cliente...',
}) {
  const [termo, setTermo] = useState('');
  const [aberto, setAberto] = useState(false);
  const [indiceAtivo, setIndiceAtivo] = useState(-1);
  const editando = useRef(false);
  const itemRefs = useRef({});
  const timerBlur = useRef(null);

  const selecionada = useMemo(
    () => obras.find((obra) => String(obra.id) === String(value)) || null,
    [obras, value],
  );

  // Sincroniza o texto quando a seleção muda externamente (abrir/fechar modal,
  // limpar vínculo etc.), sem atropelar o que o usuário está digitando.
  useEffect(() => {
    if (editando.current) return;
    setTermo(selecionada ? rotuloObra(selecionada) : '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => () => {
    if (timerBlur.current) clearTimeout(timerBlur.current);
  }, []);

  const sugestoes = useMemo(() => {
    const busca = termo.trim().toLowerCase();
    if (!busca) return [];
    return obras.filter((obra) => textoBusca(obra).includes(busca)).slice(0, 8);
  }, [termo, obras]);

  useEffect(() => {
    setIndiceAtivo(-1);
  }, [sugestoes]);

  useEffect(() => {
    if (indiceAtivo < 0) return;
    const item = itemRefs.current[sugestoes[indiceAtivo]?.id];
    if (typeof item?.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'nearest' });
    }
  }, [indiceAtivo, sugestoes]);

  const escolher = (obra) => {
    editando.current = false;
    setTermo(rotuloObra(obra));
    setAberto(false);
    setIndiceAtivo(-1);
    onChange?.(obra);
  };

  const aoDigitar = (texto) => {
    editando.current = true;
    setTermo(texto);
    setAberto(true);
    // Se o texto deixou de corresponder à obra selecionada, remove o vínculo.
    if (selecionada && texto.trim() !== rotuloObra(selecionada).trim()) {
      onChange?.(null);
    }
  };

  const aoTeclar = (evento) => {
    if (disabled) return;
    const tecla = evento.key || evento.code;
    const desce = tecla === 'ArrowDown' || tecla === 'Down';
    const sobe = tecla === 'ArrowUp' || tecla === 'Up';

    if (desce || sobe) {
      evento.preventDefault();
      if (!sugestoes.length) return;
      setAberto(true);
      setIndiceAtivo((anterior) => {
        if (desce) return (anterior + 1) % sugestoes.length;
        return anterior <= 0 ? sugestoes.length - 1 : anterior - 1;
      });
    } else if (tecla === 'Enter') {
      if (aberto && indiceAtivo >= 0 && sugestoes[indiceAtivo]) {
        evento.preventDefault();
        escolher(sugestoes[indiceAtivo]);
      }
    } else if (tecla === 'Escape' || tecla === 'Esc') {
      setAberto(false);
      setIndiceAtivo(-1);
    }
  };

  const fecharComAtraso = () => {
    if (timerBlur.current) clearTimeout(timerBlur.current);
    timerBlur.current = setTimeout(() => {
      setAberto(false);
      setIndiceAtivo(-1);
    }, 150);
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={termo}
        disabled={disabled}
        onChange={(e) => aoDigitar(e.target.value)}
        onKeyDown={aoTeclar}
        onFocus={() => { if (termo.trim()) setAberto(true); }}
        onBlur={fecharComAtraso}
        autoComplete="off"
        placeholder={placeholder}
        className={CLASSE_INPUT}
        aria-autocomplete="list"
        aria-expanded={aberto}
      />

      {aberto && !disabled && termo.trim() && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
          {sugestoes.length > 0 ? (
            <ul className="max-h-64 overflow-y-auto">
              {sugestoes.map((obra, indice) => {
                const detalhe = [clienteDaObra(obra), obra.cidade].filter(Boolean).join(' · ');
                return (
                  <li key={obra.id} className="border-b border-slate-50 last:border-0">
                    <button
                      type="button"
                      ref={(elemento) => { itemRefs.current[obra.id] = elemento; }}
                      onMouseDown={(evento) => {
                        evento.preventDefault();
                        escolher(obra);
                      }}
                      onMouseEnter={() => setIndiceAtivo(indice)}
                      className={`w-full text-left px-3.5 py-2.5 transition-colors cursor-pointer ${
                        indice === indiceAtivo
                          ? 'bg-primary-100 ring-2 ring-inset ring-primary-200'
                          : 'hover:bg-primary-50'
                      }`}
                    >
                      <span className={`block text-sm font-bold truncate ${
                        indice === indiceAtivo ? 'text-primary-900' : 'text-slate-800'
                      }`}>
                        {obra.nome}
                      </span>
                      <span className="block text-xs text-slate-400 truncate">
                        {detalhe || 'Sem cliente'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-3.5 py-2.5 text-xs font-semibold text-slate-400">
              Nenhuma obra encontrada para “{termo.trim()}”.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
