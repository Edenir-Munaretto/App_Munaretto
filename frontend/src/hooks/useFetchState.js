import { useCallback, useState } from 'react';

/**
 * Estado granular de carregamento por recurso (item 2.6 do plano).
 * Evita que uma falha de busca seja confundida com "nenhum registro".
 */
export function useFetchState() {
  const [status, setStatus] = useState('idle'); // idle | loading | success | error
  const [erro, setErro] = useState(null);

  const iniciar = useCallback(() => {
    setStatus('loading');
    setErro(null);
  }, []);

  const sucesso = useCallback(() => {
    setStatus('success');
    setErro(null);
  }, []);

  const falhar = useCallback((mensagem) => {
    setStatus('error');
    setErro(mensagem || 'Erro ao carregar os dados.');
  }, []);

  return { status, erro, iniciar, sucesso, falhar };
}