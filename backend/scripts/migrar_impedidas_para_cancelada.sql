-- ============================================================================
-- Migração: descontinua o status 'Impedida' (substituído por 'Cancelar O.S').
--
-- O que faz (idempotente — pode rodar mais de uma vez):
--   1) Fecha os cronômetros (H.H.) ainda abertos nas O.S impedidas;
--   2) Registra a conversão na linha do tempo (os_historico);
--   3) Converte as O.S 'impedida' em 'cancelada' (gravando data_fim);
--   4) Recria o CHECK de status sem 'impedida'.
--
-- IMPORTANTE: rodar no SQL Editor do Supabase ANTES do deploy do backend novo
-- (a listagem/quadro do app não conhece mais o status 'impedida').
-- ============================================================================

-- 1) Cronômetros abertos das O.S impedidas: fecha com o tempo decorrido
--    (mesma regra do app ao encerrar uma O.S).
UPDATE os_apontamentos a
   SET fim = CURRENT_TIMESTAMP,
       minutos_trabalhados = GREATEST(
           0,
           FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - a.inicio)) / 60)::INT
       )
  FROM ordens_servico o
 WHERE a.os_id = o.id
   AND o.status = 'impedida'
   AND a.fim IS NULL;

-- 2) Registra a migração na linha do tempo (antes de trocar o status).
INSERT INTO os_historico (os_id, status_anterior, status_novo, justificativa, usuario_alteracao)
SELECT o.id, 'impedida', 'cancelada',
       'Migração: status Impedida descontinuado (substituído por Cancelar O.S).',
       'migracao_sistema'
  FROM ordens_servico o
 WHERE o.status = 'impedida'
   AND NOT EXISTS (
       SELECT 1
         FROM os_historico h
        WHERE h.os_id = o.id
          AND h.status_anterior = 'impedida'
          AND h.status_novo = 'cancelada'
   );

-- 3) Converte as O.S impedidas em canceladas.
UPDATE ordens_servico
   SET status = 'cancelada',
       data_fim = COALESCE(data_fim, CURRENT_TIMESTAMP)
 WHERE status = 'impedida';

-- 4) Recria o CHECK de status sem 'impedida'.
ALTER TABLE ordens_servico DROP CONSTRAINT IF EXISTS ordens_servico_status_check;
ALTER TABLE ordens_servico ADD CONSTRAINT ordens_servico_status_check
    CHECK (status IN ('rascunho', 'aberta', 'em_andamento', 'concluida', 'cancelada'));
