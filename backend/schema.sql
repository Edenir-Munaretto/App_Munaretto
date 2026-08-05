-- Esquema de Banco de Dados PostgreSQL (Supabase) para o App Munaretto Web

-- Habilita extensão UUID se necessário
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- TABELA: clientes
CREATE TABLE IF NOT EXISTS clientes (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    cpf_cnpj VARCHAR(50) NOT NULL UNIQUE,
    endereco TEXT NOT NULL,
    cidade VARCHAR(100),
    cep VARCHAR(20),
    nota_ps TEXT,
    valor_da_obra VARCHAR(100),
    valor_de_devolucao VARCHAR(100),
    data_cadastro TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ativo BOOLEAN DEFAULT TRUE
);

-- TABELA: documentos_gerados
CREATE TABLE IF NOT EXISTS documentos_gerados (
    id SERIAL PRIMARY KEY,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    tipo_documento VARCHAR(100) NOT NULL,
    formato VARCHAR(50) NOT NULL,
    caminho_arquivo TEXT NOT NULL, -- URL do arquivo no Supabase Storage
    data_geracao TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- TABELA: fluxo_caixa
CREATE TABLE IF NOT EXISTS fluxo_caixa (
    id SERIAL PRIMARY KEY,
    mes_referencia VARCHAR(50) NOT NULL,
    rendimento_usina1 NUMERIC(12, 2) DEFAULT 0.00,
    rendimento_usina2 NUMERIC(12, 2) DEFAULT 0.00,
    rendimento_usina3 NUMERIC(12, 2) DEFAULT 0.00,
    despesa_contabilidade NUMERIC(12, 2) DEFAULT 0.00,
    despesa_internet NUMERIC(12, 2) DEFAULT 0.00,
    despesa_lavagem NUMERIC(12, 2) DEFAULT 0.00,
    despesa_manutencao NUMERIC(12, 2) DEFAULT 0.00,
    despesa_imposto NUMERIC(12, 2) DEFAULT 0.00,
    despesa_taxa NUMERIC(12, 2) DEFAULT 0.00,
    despesa_diversas NUMERIC(12, 2) DEFAULT 0.00,
    total_liquido NUMERIC(12, 2) DEFAULT 0.00,
    data_registro TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- TABELA: gestao_ferias
CREATE TABLE IF NOT EXISTS gestao_ferias (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    data_inicio DATE NOT NULL,
    dias_abono INTEGER NOT NULL DEFAULT 0,
    dias_gozo INTEGER NOT NULL DEFAULT 30,
    data_retorno DATE NOT NULL,
    data_limite DATE NOT NULL,
    departamento VARCHAR(100),
    saldo_anterior INTEGER DEFAULT 0,
    dias_utilizados INTEGER DEFAULT 0,
    motivo_cancelamento TEXT,
    status VARCHAR(50) DEFAULT 'Agendado',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    data_registro TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Trigger para atualizar automaticamente o updated_at na tabela gestao_ferias
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trg_update_ferias_updated_at ON gestao_ferias;
CREATE TRIGGER trg_update_ferias_updated_at
    BEFORE UPDATE ON gestao_ferias
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- TABELA: comprovantes
CREATE TABLE IF NOT EXISTS comprovantes (
    id SERIAL PRIMARY KEY,
    tipo_documento VARCHAR(100) NOT NULL,
    numero_nf VARCHAR(100),
    data_emissao DATE,
    nome VARCHAR(255),
    cnpj VARCHAR(50),
    local_servico VARCHAR(255),
    valor_total NUMERIC(12, 2) DEFAULT 0.00,
    base_calculo NUMERIC(12, 2) DEFAULT 0.00,
    valor_inss NUMERIC(12, 2) DEFAULT 0.00,
    valor_iss NUMERIC(12, 2) DEFAULT 0.00,
    valor_liquido NUMERIC(12, 2) DEFAULT 0.00,
    data_pagamento DATE,
    data_vencimento DATE,
    descricao TEXT,
    forma_pagamento VARCHAR(50),
    valor_pago NUMERIC(12, 2) DEFAULT 0.00,
    valor_juros NUMERIC(12, 2) DEFAULT 0.00,
    data_registro TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- TABELA: controle_recebimentos
CREATE TABLE IF NOT EXISTS controle_recebimentos (
    id SERIAL PRIMARY KEY,
    nome_cliente VARCHAR(255) NOT NULL,
    data_inicio DATE,
    valor_da_obra NUMERIC(12, 2) DEFAULT 0.00,
    valor_de_devolucao NUMERIC(12, 2) DEFAULT 0.00,
    pag_cliente NUMERIC(12, 2) DEFAULT 0.00,
    emissao_nf DATE,
    nota_ps VARCHAR(100),
    cessao VARCHAR(10) DEFAULT 'nao',
    data_registro TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Para tabelas já existentes, adicione a coluna com:
-- ALTER TABLE controle_recebimentos ADD COLUMN IF NOT EXISTS nota_ps VARCHAR(100);

-- TABELA: usuarios
CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    senha TEXT NOT NULL,
    permissoes JSONB DEFAULT '[]'::jsonb,
    ativo BOOLEAN DEFAULT TRUE,
    precisa_trocar_senha BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Migração segura: adiciona a coluna somente se ainda não existir.
-- Necessário porque "CREATE TABLE IF NOT EXISTS" é ignorado quando a tabela já existe.
ALTER TABLE IF EXISTS usuarios ADD COLUMN IF NOT EXISTS precisa_trocar_senha BOOLEAN DEFAULT FALSE;

-- TABELA: notificacoes
CREATE TABLE IF NOT EXISTS notificacoes (
    id SERIAL PRIMARY KEY,
    tipo VARCHAR(50) DEFAULT 'ferias',
    titulo VARCHAR(255) NOT NULL,
    mensagem TEXT NOT NULL,
    destinatario VARCHAR(255), -- e-mail do usuário que deve visualizar/confirmar
    ferias_id INTEGER,
    lida BOOLEAN DEFAULT FALSE,
    criada_por VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notificacoes_destinatario ON notificacoes (destinatario);
CREATE INDEX IF NOT EXISTS idx_notificacoes_lida ON notificacoes (lida);

-- TABELA: funcionarios
CREATE TABLE IF NOT EXISTS funcionarios (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    cpf VARCHAR(50) NOT NULL UNIQUE,
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================
-- O backend acessa o Supabase com a chave de service role, que por definição
-- BURLA o RLS. Por isso as políticas abaixo permitem acesso ao service_role
-- e NEGAM acesso a anon/authenticated (funções/vídeos/anônimos não autenticados).
--
-- COMO APLICAR NO SUPABASE:
--   1. Acesse: Supabase Dashboard > seu projeto > SQL Editor.
--   2. Cole TODO o conteúdo deste arquivo (ou apenas a seção RLS abaixo).
--   3. Execute o script.
--   4. IMPORTANTE: toda tabela deve ter RLS ENABLED para valer o bloqueio.
--      O script abaixo habilita RLS em todas as tabelas existentes.
--
-- Nota: a chave `SUPABASE_KEY` utilizada NO BACKEND deve ser a SERVICE ROLE key,
-- e jamais deve ser exposta no frontend. O frontend deve se comunicar apenas
-- com a API FastAPI.

-- Habilita RLS em todas as tabelas (idempotente se repetido).
ALTER TABLE IF EXISTS clientes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS documentos_gerados ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS fluxo_caixa        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS gestao_ferias      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS comprovantes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS controle_recebimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS usuarios           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS notificacoes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS funcionarios       ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- POLÍTICAS RLS PARA service_role
-- O resto do mundo (anon, authenticated) fica bloqueado por padrão.
-- Cada bloco é idempotente (DROP antes de CREATE) e pode ser re-executado.
--
-- IMPORTANTE: com RLS ativo, anon/authenticated perdem acesso. O backend só
-- continua acessando se SUPABASE_KEY (.env) for a SERVICE ROLE key. Configure
-- ANTES de rodar este trecho, senão o app para de ler/escrever os dados.
-- ============================================================================

DROP POLICY IF EXISTS "service_role_full_clientes" ON clientes;
CREATE POLICY "service_role_full_clientes" ON clientes
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_documentos_gerados" ON documentos_gerados;
CREATE POLICY "service_role_full_documentos_gerados" ON documentos_gerados
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_fluxo_caixa" ON fluxo_caixa;
CREATE POLICY "service_role_full_fluxo_caixa" ON fluxo_caixa
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_gestao_ferias" ON gestao_ferias;
CREATE POLICY "service_role_full_gestao_ferias" ON gestao_ferias
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_comprovantes" ON comprovantes;
CREATE POLICY "service_role_full_comprovantes" ON comprovantes
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_controle_recebimentos" ON controle_recebimentos;
CREATE POLICY "service_role_full_controle_recebimentos" ON controle_recebimentos
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_usuarios" ON usuarios;
CREATE POLICY "service_role_full_usuarios" ON usuarios
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_notificacoes" ON notificacoes;
CREATE POLICY "service_role_full_notificacoes" ON notificacoes
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_funcionarios" ON funcionarios;
CREATE POLICY "service_role_full_funcionarios" ON funcionarios
    FOR ALL TO service_role USING (true) WITH CHECK (true);
