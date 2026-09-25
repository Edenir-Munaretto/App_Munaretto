-- Módulo DEVOLUÇÕES CELESC: controle de devolução de materiais.
--
-- Idempotente: pode ser executado mais de uma vez sem erro.
-- Aplicar no SQL Editor do Supabase ANTES do deploy do backend.
--
-- O status (Aberto/Fechado) NÃO é coluna: é calculado pela API em tempo de
-- leitura a partir de data_devolucao (nula = Aberto; preenchida = Fechado).

-- Os dados chegam em etapas (cadastro -> entrega -> devolução), por isso
-- data_entrega e data_devolucao são opcionais.
CREATE TABLE IF NOT EXISTS devolucoes_celesc (
    id SERIAL PRIMARY KEY,
    consumidor VARCHAR(255) NOT NULL,
    nota_ps VARCHAR(100),
    data_entrega DATE,
    data_devolucao DATE,
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Para bancos que já têm a tabela criada com data_entrega NOT NULL.
ALTER TABLE IF EXISTS devolucoes_celesc ALTER COLUMN data_entrega DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_devol_celesc_consumidor ON devolucoes_celesc (consumidor);
CREATE INDEX IF NOT EXISTS idx_devol_celesc_nota_ps ON devolucoes_celesc (nota_ps);
CREATE INDEX IF NOT EXISTS idx_devol_celesc_data_devolucao ON devolucoes_celesc (data_devolucao);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trg_update_devolucoes_celesc_updated_at ON devolucoes_celesc;
CREATE TRIGGER trg_update_devolucoes_celesc_updated_at
    BEFORE UPDATE ON devolucoes_celesc
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE IF EXISTS devolucoes_celesc ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_devolucoes_celesc" ON devolucoes_celesc;
CREATE POLICY "service_role_full_devolucoes_celesc" ON devolucoes_celesc
    FOR ALL TO service_role USING (true) WITH CHECK (true);
