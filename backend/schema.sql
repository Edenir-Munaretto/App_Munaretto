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

-- Migração segura: adiciona a coluna somente se ainda não existir.
-- Necessário porque "CREATE TABLE IF NOT EXISTS" é ignorado quando a tabela já existe.
ALTER TABLE IF EXISTS notificacoes ADD COLUMN IF NOT EXISTS veiculo_documento_id INTEGER;

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
-- MÓDULO: SEGURANÇA DO TRABALHO (SST)
-- ============================================================================
-- Tabelas para compliance de NRs: matriz de treinamentos (NR-6, NR-7, NR-10,
-- NR-35 etc.), controle de vencimentos, ASO e Ficha de EPI digital.

-- TABELA: cargos (funções da empresa)
CREATE TABLE IF NOT EXISTS cargos (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL UNIQUE,
    descricao TEXT,
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- TABELA: treinamentos (catálogo de cursos obrigatórios - NRs)
CREATE TABLE IF NOT EXISTS treinamentos (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    norma VARCHAR(100),
    tipo VARCHAR(100),
    validade_meses INTEGER,          -- periodicidade de reciclagem (NULL = sem validade)
    carga_horaria INTEGER,
    instituicao VARCHAR(255),
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- TABELA: matriz_treinamentos (vínculo cargo x curso obrigatório)
CREATE TABLE IF NOT EXISTS matriz_treinamentos (
    id SERIAL PRIMARY KEY,
    cargo_id INTEGER NOT NULL REFERENCES cargos(id) ON DELETE CASCADE,
    treinamento_id INTEGER NOT NULL REFERENCES treinamentos(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (cargo_id, treinamento_id)
);

-- Funcionários passam a ter cargo para a matriz de treinamentos
ALTER TABLE IF EXISTS funcionarios ADD COLUMN IF NOT EXISTS cargo_id INTEGER REFERENCES cargos(id);

-- Funcionários podem acumular uma 2ª função. A matriz de treinamentos passa a
-- considerar os cursos obrigatórios de ambos os cargos (cargo_id e cargo_id_2).
ALTER TABLE IF EXISTS funcionarios ADD COLUMN IF NOT EXISTS cargo_id_2 INTEGER REFERENCES cargos(id);

-- Marca a exclusão lógica separada da inativação, para que as estatísticas
-- possam somar apenas ativos + inativos sem considerar os excluídos.
ALTER TABLE IF EXISTS funcionarios ADD COLUMN IF NOT EXISTS excluido BOOLEAN DEFAULT FALSE;

-- TABELA: funcionario_treinamentos (cursos realizados pelos funcionários)
CREATE TABLE IF NOT EXISTS funcionario_treinamentos (
    id SERIAL PRIMARY KEY,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
    treinamento_id INTEGER NOT NULL REFERENCES treinamentos(id),
    funcionario_nome VARCHAR(255),
    treinamento_nome VARCHAR(255),
    norma VARCHAR(100),
    data_realizacao DATE,
    data_validade DATE,
    carga_horaria INTEGER,
    certificado_url TEXT,
    observacao TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- TABELA: aso (Atestado de Saúde Ocupacional - NR-7)
CREATE TABLE IF NOT EXISTS aso (
    id SERIAL PRIMARY KEY,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
    funcionario_nome VARCHAR(255),
    tipo_exame VARCHAR(50),          -- admissional | periodico | retorno_trabalho | mudanca_funcao | demissional
    data_exame DATE,
    data_validade DATE,              -- somente exames periódicos possuem validade
    validade_meses INTEGER,
    medico_responsavel VARCHAR(255),
    clinica VARCHAR(255),
    resultado VARCHAR(50),           -- apto | apto_com_restricao | inapto
    observacao TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- TABELA: epis (catálogo de EPIs com controle de CA - NR-6)
CREATE TABLE IF NOT EXISTS epis (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    categoria VARCHAR(100),
    ca_numero VARCHAR(50),
    fabricante VARCHAR(255),
    ca_validade DATE,
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- TABELA: funcionario_epis (Ficha de EPI digital - entregas aos funcionários)
CREATE TABLE IF NOT EXISTS funcionario_epis (
    id SERIAL PRIMARY KEY,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
    epi_id INTEGER NOT NULL REFERENCES epis(id),
    funcionario_nome VARCHAR(255),
    epi_nome VARCHAR(255),
    ca_numero VARCHAR(50),
    data_entrega DATE,
    data_devolucao DATE,
    quantidade INTEGER DEFAULT 1,
    observacao TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ft_funcionario ON funcionario_treinamentos (funcionario_id);
CREATE INDEX IF NOT EXISTS idx_aso_funcionario ON aso (funcionario_id);
CREATE INDEX IF NOT EXISTS idx_fepi_funcionario ON funcionario_epis (funcionario_id);

-- ============================================================================
-- MÓDULO: MANUTENÇÃO
-- ============================================================================
-- Controle da frota: cadastro de veículos (modelo e placa), acompanhamento
-- individual de manutenções (o que foi feito, em qual data e em qual oficina)
-- e lista de equipamentos de cada veículo (checklist).

-- TABELA: veiculos (cadastro da frota)
CREATE TABLE IF NOT EXISTS veiculos (
    id SERIAL PRIMARY KEY,
    modelo VARCHAR(255) NOT NULL,
    placa VARCHAR(20) NOT NULL UNIQUE,
    observacao TEXT,
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- TABELA: manutencoes (histórico de serviços por veículo)
CREATE TABLE IF NOT EXISTS manutencoes (
    id SERIAL PRIMARY KEY,
    veiculo_id INTEGER NOT NULL REFERENCES veiculos(id) ON DELETE CASCADE,
    tipo VARCHAR(100) NOT NULL,          -- Manutenção | Troca de pneus | Revisão | etc.
    descricao TEXT,                      -- o que foi feito
    data_servico DATE NOT NULL,
    oficina VARCHAR(255),
    valor NUMERIC(12, 2) DEFAULT 0.00,
    km_odometro INTEGER,
    observacao TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- TABELA: veiculo_equipamentos (checklist de equipamentos por veículo)
CREATE TABLE IF NOT EXISTS veiculo_equipamentos (
    id SERIAL PRIMARY KEY,
    veiculo_id INTEGER NOT NULL REFERENCES veiculos(id) ON DELETE CASCADE,
    equipamento VARCHAR(255) NOT NULL,   -- ex.: macaco, estepe, triângulo, extintor...
    quantidade INTEGER DEFAULT 1,
    observacao TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_manutencao_veiculo ON manutencoes (veiculo_id);
CREATE INDEX IF NOT EXISTS idx_vequi_veiculo ON veiculo_equipamentos (veiculo_id);

-- TABELA: equipamento_reposicoes (histórico de reposições/substituições de
-- equipamentos por veículo: data, quantidade e observação de cada troca).
CREATE TABLE IF NOT EXISTS equipamento_reposicoes (
    id SERIAL PRIMARY KEY,
    equipamento_id INTEGER NOT NULL REFERENCES veiculo_equipamentos(id) ON DELETE CASCADE,
    veiculo_id INTEGER NOT NULL REFERENCES veiculos(id) ON DELETE CASCADE,
    data_reposicao DATE NOT NULL,
    quantidade INTEGER NOT NULL DEFAULT 1,
    observacao TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_equip_reposicao_equipamento ON equipamento_reposicoes (equipamento_id);
CREATE INDEX IF NOT EXISTS idx_equip_reposicao_veiculo ON equipamento_reposicoes (veiculo_id);

-- TABELA: veiculo_documentos (documentos de cada veículo da frota)
-- O arquivo em si (PDF/imagem) NÃO fica no banco: é armazenado em um bucket
-- privado no Backblaze B2. Aqui ficam apenas os metadados, a chave do objeto
-- no bucket e a data de validade de cada documento (CRLV, cronotacógrafo, etc.).
CREATE TABLE IF NOT EXISTS veiculo_documentos (
    id SERIAL PRIMARY KEY,
    veiculo_id INTEGER NOT NULL REFERENCES veiculos(id) ON DELETE CASCADE,
    tipo VARCHAR(100) NOT NULL,            -- ex.: CRLV, Certificado do Cronotacógrafo
    nome_original VARCHAR(500) NOT NULL,   -- nome do arquivo enviado
    tamanho_bytes BIGINT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    bucket_key TEXT NOT NULL UNIQUE,       -- chave do objeto no bucket B2
    data_validade DATE,                    -- data de validade do documento
    observacao TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_veic_doc_veiculo ON veiculo_documentos (veiculo_id);

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
ALTER TABLE IF EXISTS cargos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS treinamentos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS matriz_treinamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS funcionario_treinamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS aso                ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS epis               ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS funcionario_epis   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS veiculos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS manutencoes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS veiculo_equipamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS equipamento_reposicoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS veiculo_documentos ENABLE ROW LEVEL SECURITY;

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

DROP POLICY IF EXISTS "service_role_full_cargos" ON cargos;
CREATE POLICY "service_role_full_cargos" ON cargos
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_treinamentos" ON treinamentos;
CREATE POLICY "service_role_full_treinamentos" ON treinamentos
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_matriz_treinamentos" ON matriz_treinamentos;
CREATE POLICY "service_role_full_matriz_treinamentos" ON matriz_treinamentos
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_funcionario_treinamentos" ON funcionario_treinamentos;
CREATE POLICY "service_role_full_funcionario_treinamentos" ON funcionario_treinamentos
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_aso" ON aso;
CREATE POLICY "service_role_full_aso" ON aso
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_epis" ON epis;
CREATE POLICY "service_role_full_epis" ON epis
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_funcionario_epis" ON funcionario_epis;
CREATE POLICY "service_role_full_funcionario_epis" ON funcionario_epis
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_veiculos" ON veiculos;
CREATE POLICY "service_role_full_veiculos" ON veiculos
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_manutencoes" ON manutencoes;
CREATE POLICY "service_role_full_manutencoes" ON manutencoes
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_veiculo_equipamentos" ON veiculo_equipamentos;
CREATE POLICY "service_role_full_veiculo_equipamentos" ON veiculo_equipamentos
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_equipamento_reposicoes" ON equipamento_reposicoes;
CREATE POLICY "service_role_full_equipamento_reposicoes" ON equipamento_reposicoes
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_veiculo_documentos" ON veiculo_documentos;
CREATE POLICY "service_role_full_veiculo_documentos" ON veiculo_documentos
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- TABELA: certificados (metadados de documentos do módulo SST)
-- O arquivo em si (PDF/imagem) NÃO fica no banco: é armazenado em um bucket
-- PRIVADO no Backblaze B2. Aqui ficam apenas os metadados e a chave do objeto
-- no bucket. O acesso é feito por presigned URL temporária (15 min).
--
-- `tipo_registro` diz de qual entidade o documento é anexo:
--   'treinamento' -> registro da tabela funcionario_treinamentos
--   'aso'         -> registro da tabela aso
-- A unicidade é por (tipo_registro, registro_id): um documento por registro.
-- ============================================================================
CREATE TABLE IF NOT EXISTS certificados (
    id SERIAL PRIMARY KEY,
    tipo_registro VARCHAR(20) NOT NULL DEFAULT 'treinamento',
    colaborador_id INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
    registro_id INTEGER NOT NULL,
    nome_original VARCHAR(500) NOT NULL,
    tamanho_bytes BIGINT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    bucket_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Migração de bancos criados com o formato antigo (coluna registro_treinamento_id):
-- PRECISA rodar ANTES dos índices sobre (tipo_registro, registro_id), pois a
-- tabela já existente não tem essas colunas ainda.
--  1. adiciona tipo_registro (default 'treinamento' preserva os registros atuais);
--  2. renomeia a coluna para registro_id (Postgres não tem RENAME COLUMN IF EXISTS,
--     por isso usa um bloco DO condicional);
--  3. remove o vínculo/FK e a unicidade por coluna única (agora é composta).
ALTER TABLE IF EXISTS certificados
    ADD COLUMN IF NOT EXISTS tipo_registro VARCHAR(20) NOT NULL DEFAULT 'treinamento';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'certificados'
          AND column_name = 'registro_treinamento_id'
    ) THEN
        ALTER TABLE certificados RENAME COLUMN registro_treinamento_id TO registro_id;
    END IF;
END
$$;

ALTER TABLE IF EXISTS certificados
    DROP CONSTRAINT IF EXISTS certificados_registro_treinamento_id_fkey;

ALTER TABLE IF EXISTS certificados
    DROP CONSTRAINT IF EXISTS certificados_registro_treinamento_id_key;

-- Unicidade por entidade de origem (treinamento ou ASO) — depois da migração.
CREATE UNIQUE INDEX IF NOT EXISTS uq_certificados_tipo_registro ON certificados (tipo_registro, registro_id);

CREATE INDEX IF NOT EXISTS idx_cert_colaborador ON certificados (colaborador_id);

ALTER TABLE IF EXISTS certificados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_certificados" ON certificados;
CREATE POLICY "service_role_full_certificados" ON certificados
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- MÓDULO: CONTROLE DE ORDENS DE SERVIÇO (O.S.)
-- ============================================================================
-- Gestão de Ordens de Serviço de obras: cadastro de obras (por cliente),
-- equipes (com membros e líder), catálogo de produtos/insumos, a O.S em si
-- (com itens orçados), lançamento de materiais aplicados, apontamentos de
-- horas (H.H.) e histórico/linha do tempo de transições de status.
--
-- MÁQUINA DE ESTADOS (validada também no backend):
--   rascunho     -> aberta | cancelada
--   aberta       -> em_andamento | impedida | cancelada
--   em_andamento -> impedida | concluida | cancelada
--   impedida     -> em_andamento
--   concluida    -> (terminal)
--   cancelada    -> (terminal)
-- Regra crítica: transição para 'impedida' EXIGE justificativa (>= 20
-- caracteres) e pelo menos uma foto de evidência já anexada à O.S.

-- Valor/hora do funcionário para cálculo do Custo Real de Mão de Obra (H.H.)
-- e e-mail institucional usado para vincular o login (usuarios.email) ao
-- registro do funcionário (equipes, apontamentos).
ALTER TABLE IF EXISTS funcionarios ADD COLUMN IF NOT EXISTS valor_hora NUMERIC(10, 2);
ALTER TABLE IF EXISTS funcionarios ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- TABELA: obras (cada obra pertence a um cliente - relação 1:N)
CREATE TABLE IF NOT EXISTS obras (
    id SERIAL PRIMARY KEY,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id),
    nome VARCHAR(255) NOT NULL,
    endereco TEXT,
    cidade VARCHAR(100),
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- TABELA: equipes (grupos de trabalho que executam as O.S)
CREATE TABLE IF NOT EXISTS equipes (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL UNIQUE,
    descricao TEXT,
    ativa BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- TABELA: equipe_membros (N:N entre equipes e funcionarios, com flag de líder)
CREATE TABLE IF NOT EXISTS equipe_membros (
    id SERIAL PRIMARY KEY,
    equipe_id INTEGER NOT NULL REFERENCES equipes(id) ON DELETE CASCADE,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
    lider BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (equipe_id, funcionario_id)
);

-- TABELA: produtos (catálogo de materiais/insumos)
CREATE TABLE IF NOT EXISTS produtos (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(50) UNIQUE,             -- opcional: código de barras/SKU p/ bipagem
    nome VARCHAR(255) NOT NULL,
    unidade VARCHAR(20) DEFAULT 'UN',      -- UN | m | m² | kg | L | saca ...
    preco_unitario NUMERIC(12, 2) DEFAULT 0.00,
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- TABELA: ordens_servico
-- `codigo` é gerado no backend no formato OS-<ANO>-<NNNN> (sequencial por ano).
CREATE TABLE IF NOT EXISTS ordens_servico (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(20) NOT NULL UNIQUE,
    obra_id INTEGER NOT NULL REFERENCES obras(id),
    equipe_id INTEGER REFERENCES equipes(id),
    status VARCHAR(20) NOT NULL DEFAULT 'rascunho'
        CHECK (status IN ('rascunho', 'aberta', 'em_andamento', 'impedida', 'concluida', 'cancelada')),
    prioridade VARCHAR(10) NOT NULL DEFAULT 'media'
        CHECK (prioridade IN ('baixa', 'media', 'alta', 'critica')),
    data_abertura TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    prazo_entrega DATE,
    data_fim TIMESTAMP WITH TIME ZONE,
    descricao_escopo TEXT,
    custo_mo_orcado NUMERIC(12, 2) DEFAULT 0.00,   -- mão de obra prevista (R$)
    criado_por VARCHAR(255),                        -- e-mail do usuário criador
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS trg_update_os_updated_at ON ordens_servico;
CREATE TRIGGER trg_update_os_updated_at
    BEFORE UPDATE ON ordens_servico
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- TABELA: os_itens_orcados (quantidade planejada por produto - base do
-- comparativo "Aplicado vs. Orçado" exibido no Kanban)
CREATE TABLE IF NOT EXISTS os_itens_orcados (
    id SERIAL PRIMARY KEY,
    os_id INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    quantidade_orcada NUMERIC(12, 3) NOT NULL CHECK (quantidade_orcada > 0),
    UNIQUE (os_id, produto_id)
);

-- TABELA: os_materiais (lançamento de materiais/insumos aplicados em campo)
CREATE TABLE IF NOT EXISTS os_materiais (
    id SERIAL PRIMARY KEY,
    os_id INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    quantidade_usada NUMERIC(12, 3) NOT NULL CHECK (quantidade_usada > 0),
    data_lancamento TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    usuario_email VARCHAR(255),
    observacao TEXT
);

-- TABELA: os_apontamentos (H.H.: Play/Pause por membro da equipe)
-- Cada linha é um bloco de trabalho: `inicio` no Play, `fim`/`minutos` no Pause.
-- Custo Real de M.O. = SUM(minutos) x funcionarios.valor_hora / 60.
CREATE TABLE IF NOT EXISTS os_apontamentos (
    id SERIAL PRIMARY KEY,
    os_id INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id),
    inicio TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fim TIMESTAMP WITH TIME ZONE,
    minutos_trabalhados INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- TABELA: os_historico (linha do tempo imutável das transições de status)
CREATE TABLE IF NOT EXISTS os_historico (
    id SERIAL PRIMARY KEY,
    os_id INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
    status_anterior VARCHAR(20),
    status_novo VARCHAR(20) NOT NULL,
    justificativa TEXT,                 -- obrigatória quando status_novo = 'impedida'
    usuario_alteracao VARCHAR(255),     -- e-mail de quem executou a transição
    geolocalizacao_log VARCHAR(100),    -- "lat,lng" capturada no dispositivo
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- TABELA: os_fotos (evidências fotográficas; binário fica no Backblaze B2,
-- aqui ficam apenas metadados e a chave do objeto - acesso via presigned URL)
CREATE TABLE IF NOT EXISTS os_fotos (
    id SERIAL PRIMARY KEY,
    os_id INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
    nome_original VARCHAR(500) NOT NULL,
    tamanho_bytes BIGINT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    bucket_key TEXT NOT NULL UNIQUE,
    enviado_por VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Índices de integridade/performance (FKs consultadas com frequência)
CREATE INDEX IF NOT EXISTS idx_obras_cliente ON obras (cliente_id);
CREATE INDEX IF NOT EXISTS idx_equipe_membros_equipe ON equipe_membros (equipe_id);
CREATE INDEX IF NOT EXISTS idx_equipe_membros_funcionario ON equipe_membros (funcionario_id);
CREATE INDEX IF NOT EXISTS idx_os_obra ON ordens_servico (obra_id);
CREATE INDEX IF NOT EXISTS idx_os_equipe ON ordens_servico (equipe_id);
CREATE INDEX IF NOT EXISTS idx_os_status ON ordens_servico (status);
CREATE INDEX IF NOT EXISTS idx_os_itens_os ON os_itens_orcados (os_id);
CREATE INDEX IF NOT EXISTS idx_os_mat_os ON os_materiais (os_id);
CREATE INDEX IF NOT EXISTS idx_os_mat_produto ON os_materiais (produto_id);
CREATE INDEX IF NOT EXISTS idx_os_apont_os ON os_apontamentos (os_id);
CREATE INDEX IF NOT EXISTS idx_os_apont_funcionario ON os_apontamentos (funcionario_id);
CREATE INDEX IF NOT EXISTS idx_os_hist_os ON os_historico (os_id);
CREATE INDEX IF NOT EXISTS idx_os_fotos_os ON os_fotos (os_id);

-- RLS: mesmo padrão dos demais módulos (service_role tem acesso pleno;
-- anon/authenticated ficam bloqueados - o frontend só fala com a FastAPI).
ALTER TABLE IF EXISTS obras           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS equipes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS equipe_membros  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS produtos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ordens_servico  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS os_itens_orcados ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS os_materiais    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS os_apontamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS os_historico    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS os_fotos        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_obras" ON obras;
CREATE POLICY "service_role_full_obras" ON obras
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_equipes" ON equipes;
CREATE POLICY "service_role_full_equipes" ON equipes
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_equipe_membros" ON equipe_membros;
CREATE POLICY "service_role_full_equipe_membros" ON equipe_membros
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_produtos" ON produtos;
CREATE POLICY "service_role_full_produtos" ON produtos
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_ordens_servico" ON ordens_servico;
CREATE POLICY "service_role_full_ordens_servico" ON ordens_servico
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_os_itens_orcados" ON os_itens_orcados;
CREATE POLICY "service_role_full_os_itens_orcados" ON os_itens_orcados
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_os_materiais" ON os_materiais;
CREATE POLICY "service_role_full_os_materiais" ON os_materiais
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_os_apontamentos" ON os_apontamentos;
CREATE POLICY "service_role_full_os_apontamentos" ON os_apontamentos
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_os_historico" ON os_historico;
CREATE POLICY "service_role_full_os_historico" ON os_historico
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_os_fotos" ON os_fotos;
CREATE POLICY "service_role_full_os_fotos" ON os_fotos
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- TABELA: login_tentativas (rate limiting persistente do login)
-- Persiste os contadores do LoginRateLimiter no banco para sobreviver a
-- reinícios do servidor (comum no Render free tier) e a múltiplas instâncias.
-- `janela_inicio` guarda o timestamp (epoch seconds) do início da janela.
-- ============================================================================
CREATE TABLE IF NOT EXISTS login_tentativas (
    chave VARCHAR(255) PRIMARY KEY,
    contador INTEGER NOT NULL DEFAULT 0,
    janela_inicio DOUBLE PRECISION NOT NULL,
    atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE IF EXISTS login_tentativas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_login_tentativas" ON login_tentativas;
CREATE POLICY "service_role_full_login_tentativas" ON login_tentativas
    FOR ALL TO service_role USING (true) WITH CHECK (true);
