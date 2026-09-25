-- Agenda de Desligamentos Celesc: persiste as informações da Solicitação de
-- Desligamento para acompanhamento e impressão no módulo Controle de O.S.
--
-- Idempotente: pode ser executado mais de uma vez sem erro.
-- Aplicar no SQL Editor do Supabase ANTES do deploy do backend.
--
-- Regras:
--   - Um desligamento por O.S (UNIQUE os_id), criado/atualizado ao imprimir a
--     O.S com a Solicitação de Desligamento;
--   - `os_desligamento_equipes` guarda as equipes de apoio, definidas no painel
--     da agenda (não saem na folha CELESC).

CREATE TABLE IF NOT EXISTS os_desligamentos (
    id SERIAL PRIMARY KEY,
    os_id INTEGER NOT NULL UNIQUE REFERENCES ordens_servico(id) ON DELETE CASCADE,
    obra_id INTEGER REFERENCES obras(id) ON DELETE SET NULL,
    agencia VARCHAR(100),
    projeto_sap VARCHAR(255),
    obra VARCHAR(255),
    local TEXT,
    municipio VARCHAR(100),
    data DATE,
    hora_desligar TIME,
    hora_religar TIME,
    alimentador VARCHAR(100),
    chave VARCHAR(100),
    servico TEXT,
    codigo_os VARCHAR(20),
    equipe_numero INTEGER,
    equipe_nome VARCHAR(255),
    encarregado VARCHAR(255),
    substituto VARCHAR(255),
    impresso_em TIMESTAMP WITH TIME ZONE,
    impresso_por VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS os_desligamento_equipes (
    id SERIAL PRIMARY KEY,
    desligamento_id INTEGER NOT NULL REFERENCES os_desligamentos(id) ON DELETE CASCADE,
    equipe_id INTEGER NOT NULL REFERENCES equipes(id) ON DELETE CASCADE,
    equipe_numero INTEGER,
    equipe_nome VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT os_desligamento_equipes_unica UNIQUE (desligamento_id, equipe_id)
);

CREATE INDEX IF NOT EXISTS idx_os_deslig_data ON os_desligamentos (data);
CREATE INDEX IF NOT EXISTS idx_os_deslig_equipe_apoio ON os_desligamento_equipes (desligamento_id);
CREATE INDEX IF NOT EXISTS idx_os_deslig_equipe_id ON os_desligamento_equipes (equipe_id);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trg_update_os_desligamentos_updated_at ON os_desligamentos;
CREATE TRIGGER trg_update_os_desligamentos_updated_at
    BEFORE UPDATE ON os_desligamentos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE IF EXISTS os_desligamentos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS os_desligamento_equipes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_os_desligamentos" ON os_desligamentos;
CREATE POLICY "service_role_full_os_desligamentos" ON os_desligamentos
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_os_desligamento_equipes" ON os_desligamento_equipes;
CREATE POLICY "service_role_full_os_desligamento_equipes" ON os_desligamento_equipes
    FOR ALL TO service_role USING (true) WITH CHECK (true);
