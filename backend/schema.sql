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
