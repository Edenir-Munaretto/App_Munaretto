import { useEffect, useMemo, useState } from 'react';

export function usePaginacao(itens, registrosPorPagina = 50, deps = []) {
  const [paginaAtual, setPaginaAtual] = useState(1);

  const totalPaginas = Math.max(1, Math.ceil((itens?.length || 0) / registrosPorPagina));
  const paginaAtualSegura = Math.min(paginaAtual, totalPaginas);

  const itensPagina = useMemo(() => {
    const inicio = (paginaAtualSegura - 1) * registrosPorPagina;
    return (itens || []).slice(inicio, inicio + registrosPorPagina);
  }, [itens, paginaAtualSegura, registrosPorPagina]);

  useEffect(() => {
    setPaginaAtual(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return {
    paginaAtual,
    setPaginaAtual,
    totalPaginas,
    paginaAtualSegura,
    itensPagina,
  };
}