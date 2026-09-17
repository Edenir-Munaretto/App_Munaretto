-- Suporte à O.S retroativa (serviço já executado e anotado em papel; o gestor
-- registra a O.S depois, sem checklist, na data real da execução).
--
-- Idempotente: pode ser executado mais de uma vez sem erro.
-- Aplicar no SQL Editor do Supabase ANTES do deploy do backend.
--
-- O.S existentes ficam com retroativa = FALSE / data_execucao = NULL e seguem
-- o fluxo normal (checklist obrigatório).

ALTER TABLE IF EXISTS ordens_servico
    ADD COLUMN IF NOT EXISTS retroativa BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE IF EXISTS ordens_servico
    ADD COLUMN IF NOT EXISTS checklist_dispensado BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE IF EXISTS ordens_servico
    ADD COLUMN IF NOT EXISTS data_execucao DATE;

COMMENT ON COLUMN ordens_servico.retroativa IS
    'TRUE quando a O.S foi registrada depois da execução (serviço anotado em papel).';
COMMENT ON COLUMN ordens_servico.checklist_dispensado IS
    'TRUE quando a O.S não gera/usa o checklist de execução (O.S retroativa).';
COMMENT ON COLUMN ordens_servico.data_execucao IS
    'Data real em que o serviço foi executado (usada como abertura/encerramento nos relatórios).';
