-- Módulo MATERIAIS POR CLIENTE: cadastro isolado de materiais.
--
-- Idempotente: pode ser executado mais de uma vez sem erro.
-- Aplicar no SQL Editor do Supabase ANTES do deploy do backend.
--
-- Este módulo NÃO possui vínculo com a tabela `clientes`: o nome do cliente é
-- gravado como texto livre em `cliente_nome`. Nenhuma outra tabela é alterada.

CREATE TABLE IF NOT EXISTS materiais (
    id SERIAL PRIMARY KEY,
    cliente_nome VARCHAR(255) NOT NULL,
    categoria VARCHAR(20) NOT NULL CHECK (categoria IN ('cabo', 'poste', 'trafo')),
    quantidade NUMERIC(12, 3) NOT NULL CHECK (quantidade > 0),
    descricao TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_materiais_cliente ON materiais (cliente_nome);
CREATE INDEX IF NOT EXISTS idx_materiais_categoria ON materiais (categoria);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trg_update_materiais_updated_at ON materiais;
CREATE TRIGGER trg_update_materiais_updated_at
    BEFORE UPDATE ON materiais
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE IF EXISTS materiais ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_materiais" ON materiais;
CREATE POLICY "service_role_full_materiais" ON materiais
    FOR ALL TO service_role USING (true) WITH CHECK (true);
