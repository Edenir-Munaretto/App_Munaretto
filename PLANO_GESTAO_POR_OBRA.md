# Plano de Execução — Gestão consolidada por Obra (Fase 1)

> **Objetivo:** transformar a Obra em agregador das suas O.S — a obra passa a
> receber resumo das O.S vinculadas, serviços consolidados (separados por
> contrato/unidade) e 2 relatórios PDF. Sem mudança de schema.
>
> **Decisões de produto:** 2 PDFs separados · soma separada por contrato
> (construção = USC; manutenção/linha viva = ULV) · filtro de status simples
> (Todas / Em execução / Encerradas).

## Contexto atual (validado no código)

- Obras: cadastro simples (`apoio_os.py` GET/POST/PUT/DELETE `/obras`,
  `GESTOR_ONLY`; aba "Obras" em `PainelCadastros` — `OrdensServico.jsx`
  ~4142-4220) — cards sem nenhuma informação de O.S.
- O.S referencia `obra_id`; agregação de serviços existe só por O.S
  (`_resumo_materiais`, `os.py:454`) — soma por serviço com
  `quantidade_pecas × fator` gravada em `quantidade_usada` (unidade do contrato).
- Unidade dinâmica já pronta: `unidade_contrato()` em `utils/tipos_os.py`
  (backend) e `utils/contratos.js` (frontend).

## Etapa 1 — Backend: consolidação de dados

**Arquivos:** `backend/utils/resumo_obra.py` (novo),
`backend/routers/apoio_os.py`.

1. **`utils/resumo_obra.py`**
   - `agregar_servicos(db, os_linhas)` com `os_linhas = [{os_id, tipo}]`:
     - 1 consulta em `os_materiais` (`in_("os_id", ids)`) + catálogo
       (`produtos` por `produto_id`);
     - agrupa por **contrato** (tipo da O.S) e por serviço (chave
       `produto_id`/`codigo_servico`), mantendo nome/unidade do catálogo e o
       snapshot `codigo_servico`;
     - acumula `pecas`, `total`, desdobramento `normal/especial` e
       `os_usadas` (nº de O.S distintas);
     - retorna `contratos: [{tipo, unidade, total, itens: [...]}]`.
2. **`GET /api/os/obras/{obra_id}/resumo?status=todas|ativas|encerradas`**
   (em `apoio_os.py`, `GESTOR_ONLY`; valida obra com 404):
   - O.S da obra com filtro de status (Em execução =
     `aberta/em_andamento/impedida`; Encerradas = `concluida/cancelada`;
     rascunho entra apenas em "Todas");
   - resposta: `obra` (com cliente), `filtro`, `resumo`
     (total/ativas/encerradas/por_status/período), `os` (código, tipo,
     status, abertura/encerramento, total aplicado, fotos_count),
     `contratos` (consolidado por contrato) e `servicos` (agregados).
3. **`listar_obras` enriquecido** (aba Obras): cada obra passa a trazer
   `os_total`, `os_ativas`, `os_encerradas`, `totais_por_tipo` — com 2
   consultas globais (O.S por `obra_id in_`, materiais por `os_id in_`),
   sem N+1. Ajustar `ObraResponse` (campos novos com default).

## Etapa 2 — Backend: relatórios PDF por obra

**Arquivos:** `backend/utils/pdf_base.py` (novo),
`backend/utils/pdf_os.py` (refactor), `backend/utils/pdf_obra.py` (novo),
`backend/routers/apoio_os.py`.

1. **`utils/pdf_base.py`** — extrair da `_RelatorioOS` a base reutilizável
   (header/rodapé padrão, `_titulo_secao`, `_linha_dado`, `_quebrar_texto`,
   `_desenhar_cabecalho`, `_tabela` com quebra automática); `_RelatorioOS`
   passa a herdar da base (sem mudança visual).
2. **`utils/pdf_obra.py`**
   - `gerar_pdf_obra(...)` → capa (obra/cliente/endereço/filtro/período) +
     tabela por O.S + totais por contrato (unidade no título);
   - `gerar_pdf_servicos_obra(...)` → por contrato: tabela de serviços
     consolidados (Cód. · Serviço · O.S usadas · Qtd serv. · Unidade unit. ·
     Total); aviso quando não há O.S.
3. **Rotas** (`apoio_os.py`, `GESTOR_ONLY`, `FileResponse` com
   `BackgroundTask` de remoção — padrão já usado no módulo):
   - `GET /api/os/obras/{obra_id}/relatorio?status=...`
   - `GET /api/os/obras/{obra_id}/servicos?status=...`

## Etapa 3 — Frontend: Painel da Obra e cards

**Arquivos:** `frontend/src/components/PainelObra.jsx` (novo),
`frontend/src/pages/OrdensServico.jsx` (integração); reuso de
`utils/contratos.js`.

1. **Cards da aba Obras**: mini-badge `N O.S` + totais por contrato (usando
   os campos do `listar_obras` enriquecido) e botão **"Abrir Obra"**.
2. **`PainelObra`** (modal/drawer com padrão visual do PainelExecucao):
   - filtro (todas/ativas/encerradas) → recarrega `/obras/{id}/resumo`;
   - cabeçalho da obra + contadores;
   - abas **O.S da Obra** (linhas clicáveis — abrem a O.S no módulo) e
     **Serviços da Obra** (tabela por contrato);
   - botões **"Relatório da Obra"** e **"Serviços por Obra"** baixando os
     PDFs via `apiFetch` + blob + `a.download` (padrão do modelo .xlsx, com
     revoke de object URL).

## Etapa 4 — Testes

**Backend** — novo `backend/tests/test_obras_gestao.py`:
- resumo com múltiplas O.S (2 construção + 1 manutenção) → contratos
  separados e totais corretos;
- desdobramento normal/especial e `os_usadas`;
- filtro de status (Em execução / Encerradas);
- obra inexistente → 404; usuário de campo → 403;
- `listar_obras` com contadores;
- PDFs: conteúdo via `pymupdf` (títulos/contratos presentes; obra sem O.S
  gera com aviso).
- Suíte completa (`python -m pytest backend/tests`) + `ruff` sem novos
  apontamentos.

**Frontend:** `npm run lint` e `npm run build`.

## Etapa 5 — Deploy e commits

- Commits isolados:
  1. backend resumo + `listar_obras` enriquecido;
  2. `pdf_base`/`pdf_obra` + rotas;
  3. frontend `PainelObra` + cards;
  4. testes/doc.
- Deploy backend + frontend juntos; **sem mudança de schema**.

## Fora do escopo da Fase 1

- Dashboard/gráficos por obra;
- Kanban agrupado por obra;
- Mão de obra/custo por obra;
- Faturamento por obra;
- Exportação Excel por obra;
- Relatórios por obra para usuário de campo (por equipe).

## Riscos e pontos de atenção

- `ObraResponse` é `response_model` — campos novos precisam de default para
  não quebrar cadastro/testes.
- Obras sem O.S (estado vazio amigável) e obras com **contratos mistos**
  (blocos separados por contrato).
- Definição do filtro: "Em execução" NÃO inclui `rascunho`; "Todas" inclui.
- Performance: sempre consultas únicas por agregado (sem N+1).
