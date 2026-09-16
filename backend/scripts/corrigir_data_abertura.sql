-- ============================================================================
-- Migração: corrige a origem da data de abertura da O.S.
--
-- O que faz (idempotente — pode rodar mais de uma vez):
--   1) Remove o DEFAULT CURRENT_TIMESTAMP de ordens_servico.data_abertura;
--   2) Limpa a data de abertura herdada em rascunhos (era a data de criação).
--
-- Contexto: a coluna passa a nascer NULL e o backend grava data_abertura
-- apenas na transição rascunho -> aberta (ou reabertura), em
-- backend/routers/os.py. O default antigo fazia todo rascunho nascer com a
-- data de criação — que aparecia no campo "Data" do modelo impresso e nos
-- relatórios.
--
-- IMPORTANTE: rodar no SQL Editor do Supabase junto do deploy do backend.
-- O.S. antigas já abertas com data herdada não são distinguíveis das
-- preenchidas corretamente e NÃO são alteradas.
-- ============================================================================

-- 1) data_abertura passa a ser gravada somente pelo app (transição p/ aberta).
ALTER TABLE ordens_servico ALTER COLUMN data_abertura DROP DEFAULT;

-- 2) Rascunhos ainda com a data de criação herdada do default antigo.
UPDATE ordens_servico
   SET data_abertura = NULL
 WHERE status = 'rascunho'
   AND data_abertura IS NOT NULL;
