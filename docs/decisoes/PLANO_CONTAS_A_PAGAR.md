# Plano — Módulo Contas a Pagar

> **Objetivo:** controlar as obrigações financeiras (NFs, boletos, impostos,
> aluguéis etc.) desde o lançamento até a quitação, com parcelas individuais,
> baixas totais/parciais e integração automática com o módulo Contabilidade
> (Comprovantes), que continua sendo o extrato de pagamentos.
>
> **Status:** plano aprovado para análise — ajustar detalhes antes de implementar.

## Decisões de produto (fechadas)

- Parcelas individuais (30/60/90), com baixa por parcela.
- Integração: **cada baixa gera automaticamente um lançamento em `comprovantes`**
  (vinculado ao título/parcela); o estorno da baixa remove o lançamento gerado.
- Cadastro dedicado de **fornecedores** (com sugestão automática na importação).
- Escopo da v1: **recorrência de despesas fixas**, **relatório PDF da posição**,
  **importação/exportação XLSX** e **baixa em lote** (várias parcelas baixadas
  na mesma data/forma, gerando um comprovante por baixa).
- Fora da v1 (fase 2): anexos de NF/boleto no B2, notificações de vencimento,
  vínculo com Obra/O.S (rateio de custo) e conciliação/migração dos
  comprovantes antigos.

---

## 1. Contexto atual (validado no código)

- **Contabilidade/Comprovantes** (`backend/routers/comprovantes.py`,
  `frontend/src/pages/Comprovantes.jsx`, tabela `comprovantes` — schema.sql:83-104):
  lançamento solto com `tipo_documento`, `numero_nf`, `data_emissao`,
  `data_vencimento`, `data_pagamento`, `valor_total`, `base_calculo`,
  `valor_inss`, `valor_iss`, `valor_liquido`, `valor_pago`, `valor_juros`,
  `forma_pagamento`. **Sem status, saldo, parcelas, fornecedor ou baixa**;
  o "pago" é apenas o preenchimento manual de `data_pagamento`/`valor_pago`.
  Já tem importação/exportação XLSX e impressão.
- **Controle Recebimentos** (`controle_recebimentos`): paralelo de contas a
  receber, também sem baixa/status.
- **Fluxo de Caixa/Gestão Usinas**: fechamento mensal agregado, sem vínculo com
  lançamentos individuais.
- **Não existe** nada de contas a pagar, parcelas, fornecedores ou baixa em
  nenhum lugar do repositório.
- Padrões reaproveitáveis: importação/exportação XLSX de Comprovantes, status
  derivado + PUT parcial de `devolucoes_celesc.py`, CRUD com soft delete de
  `clientes.py`, relatórios PDF de `utils/pdf_base.py`, migração idempotente de
  `scripts/criar_os_desligamentos.sql`.

---

## 2. Modelo de dados

Arquivos: `backend/schema.sql` + `backend/scripts/criar_contas_pagar.sql`
(idempotente, seguindo o padrão dos scripts existentes).

### 2.1 `fornecedores`

| Campo | Tipo | Observação |
|---|---|---|
| id | SERIAL PK | |
| nome | VARCHAR(255) NOT NULL | |
| cpf_cnpj | VARCHAR(50) UNIQUE | único quando informado (NULL permite vários) |
| telefone | VARCHAR(50) | |
| email | VARCHAR(255) | |
| observacao | TEXT | |
| ativo | BOOLEAN DEFAULT TRUE | soft delete |
| created_at / updated_at | TIMESTAMPTZ | trigger `updated_at` |

### 2.2 `contas_pagar` (título)

| Campo | Tipo | Observação |
|---|---|---|
| id | SERIAL PK | |
| fornecedor_id | INTEGER FK fornecedores ON DELETE SET NULL | |
| fornecedor_nome | VARCHAR(255) | snapshot (histórico) |
| cnpj | VARCHAR(50) | snapshot |
| tipo_documento | VARCHAR(100) NOT NULL | Nota Fiscal, Boleto, Pix, Imposto, Aluguel, Diversas... |
| numero_nf | VARCHAR(100) | |
| data_emissao | DATE | |
| descricao | TEXT | |
| categoria | VARCHAR(100) | ex.: Material, Combustível, Imposto, Serviço |
| valor_total | NUMERIC(12,2) NOT NULL DEFAULT 0 | |
| desconto | NUMERIC(12,2) DEFAULT 0 | desconto comercial do título |
| data_vencimento | DATE | vencimento da 1ª parcela (ordenação/filtros) |
| recorrencia_id | INTEGER FK contas_pagar_recorrencias ON DELETE SET NULL | |
| mes_referencia | VARCHAR(7) | "YYYY-MM" quando gerado por recorrência |
| ativo | BOOLEAN DEFAULT TRUE | soft delete = **Cancelado** |
| created_at / updated_at | TIMESTAMPTZ | trigger `updated_at` |

Índice parcial único para recorrência: `(recorrencia_id, mes_referencia)`
quando `recorrencia_id IS NOT NULL` (evita gerar o mesmo mês duas vezes).

### 2.3 `contas_pagar_parcelas`

| Campo | Tipo | Observação |
|---|---|---|
| id | SERIAL PK | |
| conta_id | INTEGER NOT NULL FK contas_pagar ON DELETE CASCADE | |
| numero | INTEGER NOT NULL | 1..N |
| data_vencimento | DATE NOT NULL | |
| valor | NUMERIC(12,2) NOT NULL | |

`UNIQUE (conta_id, numero)`.

### 2.4 `contas_pagar_baixas` (pagamentos)

| Campo | Tipo | Observação |
|---|---|---|
| id | SERIAL PK | |
| conta_id | INTEGER NOT NULL FK contas_pagar ON DELETE CASCADE | |
| parcela_id | INTEGER FK contas_pagar_parcelas ON DELETE CASCADE | |
| data_pagamento | DATE NOT NULL | |
| valor_pago | NUMERIC(12,2) NOT NULL CHECK (> 0) | principal amortizado |
| juros | NUMERIC(12,2) DEFAULT 0 | não abate saldo |
| multa | NUMERIC(12,2) DEFAULT 0 | não abate saldo |
| desconto | NUMERIC(12,2) DEFAULT 0 | abate saldo |
| forma_pagamento | VARCHAR(50) | |
| observacao | TEXT | |
| comprovante_id | INTEGER FK comprovantes ON DELETE SET NULL | lançamento gerado |
| usuario | VARCHAR(255) | e-mail de quem baixou |
| created_at | TIMESTAMPTZ | |

### 2.5 `contas_pagar_recorrencias` (templates de despesas fixas)

| Campo | Tipo | Observação |
|---|---|---|
| id | SERIAL PK | |
| fornecedor_id | INTEGER FK fornecedores ON DELETE SET NULL | |
| tipo_documento | VARCHAR(100) NOT NULL | |
| descricao | TEXT NOT NULL | |
| categoria | VARCHAR(100) | |
| valor | NUMERIC(12,2) NOT NULL DEFAULT 0 | |
| dia_vencimento | INTEGER NOT NULL | 1..31 (clampado ao último dia do mês) |
| ativo | BOOLEAN DEFAULT TRUE | |
| created_at / updated_at | TIMESTAMPTZ | trigger `updated_at` |

### 2.6 Vínculo em `comprovantes`

```sql
ALTER TABLE comprovantes ADD COLUMN IF NOT EXISTS conta_pagar_id INTEGER
    REFERENCES contas_pagar(id) ON DELETE SET NULL;
ALTER TABLE comprovantes ADD COLUMN IF NOT EXISTS conta_pagar_baixa_id INTEGER
    REFERENCES contas_pagar_baixas(id) ON DELETE SET NULL;
```

### 2.7 Índices e RLS

- Índices: `contas_pagar(data_vencimento)`, `contas_pagar(fornecedor_id)`,
  `contas_pagar(ativo)`, `parcelas(conta_id)`, `baixas(conta_id)`,
  `baixas(parcela_id)`, `recorrencias(ativo)`.
- RLS habilitado + policy `service_role_full_*` (padrão do schema).
- Trigger `updated_at` nas tabelas que têm `updated_at`.

---

## 3. Regras de negócio

### 3.1 Cálculos (feitos na leitura, como Devoluções Celesc)

- **Saldo da parcela** = `valor` − (Σ `valor_pago` + Σ `desconto`) das baixas da parcela.
- **Saldo do título** = Σ saldos das parcelas.
- **Desembolso da baixa** = `valor_pago` + `juros` + `multa`
  (juros/multa não abatem; desconto abate).
- Não é permitido amortizar mais que o saldo (400).
- **Data de vencimento do título** = vencimento da 1ª parcela.

### 3.2 Status derivado (não persistido)

| Status | Regra |
|---|---|
| `Cancelado` | `ativo = FALSE` |
| `Pago` | saldo do título ≤ 0 |
| `Parcial` | existe ao menos uma baixa e saldo > 0 |
| `Vencido` | sem quitação e menor vencimento em aberto < hoje |
| `Aberto` | nenhuma baixa e vencimentos futuros |

### 3.3 Baixa → Comprovante (integração)

- Ao criar a baixa, o backend cria **um comprovante**:
  - `tipo_documento` = tipo do título (layout de NF quando for `Nota Fiscal`);
  - `nome`/`cnpj` = snapshot do fornecedor; `numero_nf`/`data_emissao` quando NF;
  - `data_pagamento` = data da baixa; `valor_pago` = `valor_pago`;
  - `valor_juros` = `juros` + `multa` (não há campo separado em comprovantes);
  - `forma_pagamento` = forma da baixa;
  - `descricao` = `"Contas a Pagar — <tipo> <nº> · parcela N/M"`;
  - `conta_pagar_id` e `conta_pagar_baixa_id` preenchidos.
- **Editar baixa** → atualiza o comprovante vinculado.
- **Estornar baixa** (DELETE) → remove o comprovante gerado (se ainda existir).
- Lançamentos antigos feitos manualmente na Contabilidade **não** são migrados
  nem alterados.

### 3.4 Edição e cancelamento

- Título **sem baixa**: cabeçalho e parcelas totalmente editáveis
  (soma das parcelas deve fechar com o valor total − desconto).
- Título **com baixa**: parcelas ficam bloqueadas (409); para alterar,
  estornar as baixas primeiro.
- Cancelar = soft delete (`ativo = FALSE`); sai dos totais, mantém histórico.

### 3.5 Recorrência

- `POST /recorrencias/gerar?mes=YYYY-MM`:
  - para cada template ativo, cria o título do mês (1 parcela, dia clampado ao
    último dia do mês) com `recorrencia_id` + `mes_referencia`;
  - idempotente: não duplica mês já gerado;
  - retorna contagem de criados/ignorados.

### 3.6 Importação XLSX

- Colunas do modelo: fornecedor, cnpj, tipo_documento, numero_nf, data_emissao,
  descricao, categoria, valor_total, desconto, data_vencimento, parcelas.
- `parcelas`: 1 = vencimento único; N > 1 = divide o valor em N parcelas
  30/60/90 dias a partir do vencimento informado.
- Fornecedor criado automaticamente por CNPJ (ou nome) quando não existir.
- Simulação (prévia) + relatório de erros por linha, como em Comprovantes.

### 3.7 Baixa em lote

- Endpoint dedicado `POST /baixas/lote` — várias parcelas na **mesma data e
  forma de pagamento**:

  ```json
  {
    "data_pagamento": "2026-10-05",
    "forma_pagamento": "Pix",
    "observacao": "",
    "itens": [
      { "parcela_id": 12, "valor_pago": 1000, "juros": 0,   "multa": 0, "desconto": 0 },
      { "parcela_id": 27, "valor_pago": 450.50, "juros": 10, "multa": 0, "desconto": 0 }
    ]
  }
  ```

- **Valida primeiro, grava depois**: confere existência, título ativo e saldo de
  todas as parcelas; se qualquer item for inválido → `400` e **nada é gravado**.
- Cada parcela gera **uma baixa** e **um comprovante** (1:1, igual à baixa
  individual); a resposta devolve os itens criados.
- Se falhar no meio da gravação, o sistema **estorna as baixas já criadas**
  (best-effort) e reporta o erro — evita baixa parcial silenciosa.
- Valem as mesmas regras: juros/multa não abatem saldo; desconto abate; não
  passa do saldo.

---

## 4. Backend

Arquivo novo: `backend/routers/contas_pagar.py`
(`APIRouter(dependencies=[Depends(require_permisao("contas_pagar"))])`),
registrado em `backend/main.py` com prefixo `/api/contas-pagar`.

### 4.1 Endpoints

| Método | Rota | Descrição |
|---|---|---|
| GET | `/fornecedores/` | lista com busca (nome/CNPJ) |
| POST/PUT/DELETE | `/fornecedores/` `/{id}` | CRUD com checagem de CNPJ duplicado e soft delete |
| GET | `/` | títulos com filtros: `status`, `fornecedor_id`, `categoria`, `vencimento_de/ate`, `busca`; parcelas, baixas, saldo e status calculados |
| GET | `/{id}` | detalhe do título |
| POST | `/` | cria título + parcelas (valida soma) |
| PUT | `/{id}` | edita cabeçalho/parcelas (bloqueia parcela com baixa) |
| DELETE | `/{id}` | cancela (soft delete) |
| POST | `/{id}/baixas` | cria baixa, valida saldo, gera comprovante |
| POST | `/baixas/lote` | baixa várias parcelas na mesma data/forma (valida tudo antes; estorna se falhar no meio) |
| PUT/DELETE | `/baixas/{baixa_id}` | edita/estorna baixa (sincroniza comprovante) |
| GET/POST/PUT/DELETE | `/recorrencias/` `/{id}` | CRUD dos templates |
| POST | `/recorrencias/gerar` | gera títulos do mês (idempotente) |
| GET | `/modelo` | baixa o modelo XLSX de importação |
| POST | `/importar` | importa títulos (simulação + relatório de erros) |
| GET | `/exportar` | exporta posição XLSX com filtros |
| GET | `/relatorio` | PDF da posição (período/status/fornecedor) com totais |

### 4.2 Arquivos auxiliares

- `backend/utils/pdf_contas_pagar.py` — PDF com `pdf_base.desenhar_cabecalho`
  e `_tabela` (totais por status/fornecedor).
- Cálculo de saldo/status em Python após carregar baixas em lote
  (`in_("conta_id", ids)`), como em `desligamentos_os.py` e `os.py`.

---

## 5. Frontend

- `frontend/src/modules.js`: `{ id: 'contas_pagar', label: 'Contas a Pagar' }`.
- `frontend/src/App.jsx`: import da página + ícone (`Wallet`) em `ICONES` e
  `COMPONENTES` (permissão aparece automaticamente em Configurações).
- `frontend/src/pages/ContasPagar.jsx` (novo), com abas internas:

1. **Títulos** (principal)
   - Cards de totais: vence hoje/esta semana, atrasados, pago no mês.
   - Filtros: chips de status, período de vencimento, fornecedor, busca.
   - Tabela desktop + cards mobile, badge de status, accordion das parcelas
     (vencimento, valor, saldo, situação) e botão **Baixar** por parcela
     (mini-modal: data, valor pré-preenchido com o saldo, juros, multa,
     desconto, forma, observação) + atalho "baixar saldo total".
   - **Baixa em lote**: checkbox por parcela + barra de ação
     "Baixar selecionados (N)" mostrando o total do lote. O modal tem data e
     forma comuns no topo e a lista de itens com valor (pré-preenchido com o
     saldo), juros, multa e desconto editáveis linha a linha. Ao confirmar,
     mostra quantas baixas/comprovantes foram gerados.
2. **Fornecedores**: CRUD com busca (template `Clientes.jsx`).
3. **Recorrências**: CRUD + botão **"Gerar títulos do mês"**.
4. **Toolbar**: Exportar XLSX, Importar (modal de prévia/simulação),
   Imprimir posição (PDF via `utils/abrirPdf.js`), Novo título.
5. **Modal de título**: cabeçalho + editor de parcelas com botão
   "Gerar N parcelas" (30/60/90, divide o valor) e linhas editáveis.

Componentes/hooks reaproveitados: `ModalConfirmacao`, `ErroCarregamento`,
`useFetchState`, `abrirPdf.js`, `parseDecimalBR`, `PaginacaoControle`.

---

## 6. Funcionamento no dia a dia

### Fluxo principal: da nota fiscal ao pagamento

1. **Fornecedor (primeira vez)** — aba Fornecedores → Novo: nome, CNPJ,
   telefone, e-mail. CNPJ duplicado é bloqueado. Na importação em lote o
   fornecedor é criado automaticamente.
2. **Lançamento da NF (título)** — aba Títulos → Novo título: fornecedor,
   tipo, nº da NF, emissão, descrição, categoria, valor total (desconto
   opcional). Parcelas: "Gerar N parcelas" preenche 30/60/90 e divide o valor;
   cada linha é editável; pagamento único = 1 parcela. O sistema valida a soma.
   O título nasce **Aberto** (ou **Vencido**, se o vencimento já passou).
3. **Acompanhamento** — cards de vencimentos, filtros e accordion das parcelas.
4. **Baixa** — botão na parcela: data, valor (pré-preenchido com o saldo),
   juros, multa, desconto, forma. Regras: não amortiza além do saldo;
   juros/multa somam no desembolso; desconto abate. Ao confirmar: grava a
   baixa, recalcula o status e **cria o lançamento em Contabilidade** vinculado.
   Também é possível **baixar em lote**: marcar várias parcelas e pagar todas
   na mesma data/forma — o sistema valida tudo antes e gera um comprovante por
   baixa.
5. **Correções** — sem baixa, tudo editável; com baixa, estornar primeiro.
   Estorno remove também o comprovante gerado.
6. **Despesas fixas** — aba Recorrências: cadastra o template e usa
   "Gerar títulos do mês" (idempotente).
7. **Relatórios** — Exportar XLSX, Importar XLSX e Imprimir posição (PDF) com
   os filtros aplicados.

### Papel de cada módulo

- **Contas a Pagar** = obrigação (o que se deve), com parcelas e baixas.
- **Contabilidade (Comprovantes)** = extrato do que foi pago. Sem baixa, nada
  aparece lá. Lançamentos antigos permanecem como estão.

---

## 7. Exemplo completo

| Quando | Ação | Resultado |
|---|---|---|
| 01/10 | Recebe NF 1234 do Fornecedor X, R$ 3.000, 3x | Cadastra fornecedor X; lança título com 3 parcelas (01/11, 01/12, 01/01) — **Aberto** |
| 01/11 | Paga a 1ª parcela no Pix (R$ 1.000) | Baixa + lançamento em Contabilidade; status **Parcial** |
| 05/12 | Paga a 2ª com atraso: R$ 1.000 + R$ 20 de juros | Comprovante com valor pago R$ 1.000 e juros R$ 20; saldo da 3ª intacto |
| 01/01 | Paga a 3ª parcela | Status **Pago** (sai dos abertos) |
| Fim do mês | Filtra o período e imprime o PDF | Mostra pago, em aberto e atrasados |

---

## 8. Testes e validação

- `backend/tests/conftest.py`: novas tabelas no banco fake + fixture
  `contas_pagar_client` (permissão `contas_pagar`).
- `backend/tests/test_contas_pagar.py`:
  - CRUD de fornecedores e bloqueio de CNPJ duplicado;
  - criação de título com parcelas (soma inválida → 400);
  - filtros e status derivado (aberto/parcial/pago/vencido/cancelado);
  - baixa parcial e total, saldo e limites (acima do saldo → 400);
  - baixa gera comprovante vinculado; estorno remove o comprovante;
  - **baixa em lote**: cria N baixas + N comprovantes; item inválido → 400 e
    nada gravado; falha no meio estorna o que já foi criado;
  - edição de parcela com baixa → 409;
  - recorrência: geração idempotente e dia clampado ao mês;
  - importação/exportação XLSX; relatório PDF;
  - permissões (sem `contas_pagar` → 403).
- Validar com `pytest`, `ruff`, `npm run lint` e `npm run build`.
- Aplicar `backend/scripts/criar_contas_pagar.sql` (ou o `schema.sql` completo)
  no Supabase antes do deploy.

---

## 9. Itens em aberto (decidir antes de implementar)

1. **Criar fornecedor direto no modal do título** (evita trocar de aba)?
2. **No lote, valores por item**: editar valor/juros/multa/desconto linha a
   linha (recomendado) ou aplicar um valor único para todas as parcelas?
3. **Migração/conciliação** dos comprovantes antigos que representam contas:
   importar uma vez a partir da Contabilidade ou deixar 100% manual?
4. **Numeração do título**: código sequencial visível (ex.: `CP-2026-0001`)
   como na O.S, ou apenas o `id`?
5. **Categorias**: lista fixa no código ou cadastro livre/preferências?
6. **Permissão**: módulo novo `contas_pagar` (recomendado) ou compartilhar
   com `comprovantes`?
7. **Juros/multa no comprovante**: hoje `comprovantes` tem só `valor_juros`;
   somar multa nele (proposto) ou adicionar coluna `valor_multa`?
