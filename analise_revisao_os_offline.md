# Revisão de Código — Controle de O.S e Modo Campo (offline)

> Relatório consolidado de três revisões (backend, frontend do módulo e
> infraestrutura offline), validadas lendo o código real. Data: set/2026.

## Status de implementação

| Lote | Itens | Status |
|---|---|---|
| **1 — integridade** | C1-C5, A1, A2, A3, A4, A9 | ✅ Implementado (set/2026): `sync_ops` (UNIQUE dispositivo+id_local) em `schema.sql`; idempotência/replay no `/sincronizar` (os.py); update de status com `.eq("status")`→409; pause com `.is_("fim","null")`; apontamento com sanidade (futuro/duração≤24h/`fim>início`) e play bloqueado em rascunho; `exige_foto` validado na resposta e na conclusão; cronômetro offline derivado da fila (sem espelho volátil); fotos com `id_servidor` persistido e limpeza pós-confirmação; lote em chunks ≤200; conflitos 4xx com descarte confirmado no modal; logout/login com pendências exige confirmação. Testes: `test_sync_os.py`, `test_os.py`, `test_checklist_os.py` (250 testes passando); lint/build frontend ok. Deploy: re-rodar `schema.sql`. |
| 2 — coerência offline/online | A5, A6, A7, A8 + filtros offline, Evidências offline, botão Impedir, guarda de clique | ✅ Implementado (set/2026): painel único por viewport (A6); corrida de listagem com geração/descarte + catálogos só no reset (A7); retries do detalhe com cleanup e `setErro('')` (A8); espelhamento online→pacote (os_lista na listagem, status, material; respostas já cobriam); filtros/busca/paginação offline no quadro ativo; botão "Impedir" no painel (decisão de negócio nº 3 atendida — mobile/campo); guardas de clique duplo (lock em `mudarStatus` + `disabled` no AcoesStatus); timer do toast com limpeza. ⏳ Adiado (decisão): aba **Evidências offline** e visão **Encerradas offline** — registrados como pendência; gate `exige_foto` no frontend agora só bloqueia online (offline o sync valida a verdade). |
| 3 — robustez backend | A2-fim… (sanitização de busca, X-Total-Count, TOCTOU código, `criar_os` transacional, uploads streaming, timeouts `apiFetch`, `_gravar_membros`, importação em lote, índice único HH aberto) | ⏳ Pendente |
| 4 — higiene/baixos | (ver seção 🟢 e itens médios restantes) | ⏳ Pendente |

## Escopo e método

| Frente | Arquivos principais |
|---|---|
| Backend O.S | `backend/routers/os.py`, `backend/routers/apoio_os.py`, `backend/utils/*` (pdf_os, pdf_os_checklist, checklist_os, document_generator), `backend/supabase_client.py`, `backend/schema.sql`, testes (`test_os.py`, `test_sync_os.py`, `test_checklist_os.py`, `test_importacao_servicos.py`) |
| Frontend módulo | `frontend/src/pages/OrdensServico.jsx`, `frontend/src/api.js`, `frontend/src/App.jsx`, `frontend/src/components/ModalPendenciasSync.jsx`, `ModalConfirmacao.jsx` |
| Infra offline | `frontend/src/offline/db.js`, `offline/offline.js`, `offline/sync.js`, `frontend/public/sw.js` |

Severidades: 🔴 CRÍTICO · 🟠 ALTO · 🟡 MÉDIO · 🟢 BAIXO.

---

## 🔴 Críticos (integridade de dados)

| # | Achado | Onde | Correção sugerida |
|---|---|---|---|
| C1 | **Sync não é idempotente**: `id_local` nunca é persistido; reenvio do mesmo lote (resposta perdida) duplica lançamentos de material e blocos H.H. | backend `os.py:1261-1358` (1325-1347) + `sync.js:90-109` | Tabela `sync_ops` com `UNIQUE(dispositivo, id_local)` e aplicação condicional por operação (ou chave natural em `os_materiais`/`os_apontamentos`) |
| C2 | **Cronômetro H.H. offline sem espelho local**: `play` só enfileira; nada marca "rodando", botão volta a "Iniciar" e toques repetidos geram 2+ plays → HH duplicado ou 4xx permanente; sem pause offline | `OrdensServico.jsx:1320-1338`, `1367-1391` | Refletir `cronometro_aberto` no `os` local ao enfileirar play/pause e travar novo play enquanto houver op pendente |
| C3 | **Mapa de fotos `id_local→id` volátil**: foto apagada da fila logo após o upload; se o lote de operações falhar depois, a operação de impedimento que referencia a foto chega sem mapeamento → 400 permanente | `sync.js:46-62` + backend `os.py:1303-1306` | Persistir `id_servidor` no registro da foto e só apagá-lo após as operações que a referenciam serem confirmadas |
| C4 | **Fila > 500 operações = deadlock**: backend limita lote a 500 (`os.py` Pydantic `max_length=500`); `dbGetAll('fila')` envia tudo de uma vez e o 422 derruba o lote inteiro sem marcar itens | `sync.js:65-109` | Enviar em lotes ≤ ~200 com processamento/remoção incremental |
| C5 | **Logout/re-login (ex.: 401/sessão expirada) apaga fila e fotos sem sincronizar** | `App.jsx:320-325, 337-343` + `db.js:87-95` | Ao sair com pendências no Modo Campo: exigir sincronização ou confirmação explícita antes do wipe |

---

## 🟠 Altos

| # | Achado | Onde | Correção sugerida |
|---|---|---|---|
| A1 | Transições de status **read-modify-write não atômicas** (update sem `.eq("status", atual)`); dois dispositivos validam o mesmo status e o último vence (estado/linha do tempo incoerentes) | backend `os.py:953` | `update(...).eq("id", id).eq("status", atual)` + verificar linhas afetadas (409/retry) |
| A2 | **Pause sem guarda `fim IS NULL`**: dois pauses simultâneos sobrescrevem o bloco | backend `os.py:1677-1697` | `.is_("fim","null")` no update + validar linha afetada |
| A3 | **`inicio`/`fim` arbitrários** no endpoint de apontamento (sem sanidade: passado remoto, duração > 24 h) e play liberado em `rascunho` | backend `os.py:1577-1683` (1619-1623) | Restringir origem (sync vs web), validar `fim <= agora + skew` e teto de duração; bloquear `rascunho` |
| A4 | **`exige_foto` nunca validado no backend**: resposta/conclusão (inclusive via sync) aceitam itens sem evidência obrigatória | backend `os.py:1042-1057`, `938-947` | Bloquear resposta/conclusão/sync quando item com `exige_foto` não tiver foto |
| A5 | **Espelhamento online→offline ausente**: mudanças feitas online em Modo Campo não atualizam `os_lista`/`os`; ao cair a rede o quadro mostra estado antigo | `OrdensServico.jsx:2855-2913`, `2731-2786` | `atualizarStatusLocal`/`salvarDetalheLocal` no branch online quando `isModoCampo()`; gravar `os_lista` na listagem online |
| A6 | **PainelExecucao montado 2× no mobile** (drawer sem `hidden lg:block` + bloco `lg:hidden`) → GETs duplicados, cronômetros/toasts em dobro | `OrdensServico.jsx:3333-3349`, `3352-3398` | Envolver o drawer desktop em `hidden lg:block` |
| A7 | **Corrida de respostas na listagem** (sem abort/sequência) + "Carregar mais" com offset repetido duplica página | `OrdensServico.jsx:2731-2786` | `requestId`/AbortController em `useRef` e descartar respostas antigas |
| A8 | **`setTimeout` de retry sem cleanup + `erro` nunca limpo ao abrir outra O.S** (dados da O.S anterior vazam) | `OrdensServico.jsx:1516-1534` | Timer em `useRef` com cleanup; `setErro('')` no início de `carregar` |
| A9 | **Conflitos 4xx permanentes** (O.S concluída, item excluído, play duplicado) ficam para sempre na fila e bloqueiam o Finalizar; UI não distingue "conflito definitivo" | `sync.js:90-109` + `ModalPendenciasSync.jsx` | Marcar 4xx como conflito permanente com ação clara "revisar/descartar todos os conflitos" (com confirmação) |
| A10 | Gestor conclui **via drag&drop sem o gate de checklist** que os botões aplicam (`checklist.completo`/`inicio_liberado`) | `OrdensServico.jsx:2972-2976` | Aplicar as mesmas checagens no `aoArrastarFim` p/ destino `concluida` |

---

## 🟡 Médios (amostra)

| Achado | Onde |
|---|---|
| Busca com `(`,`)` e outros caracteres da gramática PostgREST quebram o `or_` → 500 | backend `os.py:581-582, 643-644`; `apoio_os.py:438-442, 206-207` (sanitizar termo) |
| `X-Total-Count` sem `head`/`count="exact"` — errado acima do teto de linhas do PostgREST (~1000) | backend `os.py:648-653` |
| Geração de código `OS-ANO-NNNN` TOCTOU: retry só cobre colisão commitada; insert concorrente vira 500 | backend `os.py:296-317` |
| `criar_os` não transacional (insert + snapshot_checklist + histórico) — O.S órfã/duplicada em falha parcial | backend `os.py:740-754` |
| Sem índice único p/ cronômetro aberto por funcionário (`fim IS NULL`) — 2 plays concorrentes abrem 2 blocos | backend `os.py:1625-1647` + `schema.sql:760-768` |
| Uploads leem o arquivo inteiro antes do limite de 15 MB (memória); checklist sem bloquear O.S concluída na troca de foto | backend `os.py:1085-1089, 1104-1135, 1725-1729` |
| Mensagens 500 vazam exceção crua (`{exc}`/TODO) | backend `os.py:784, 786, 1024` |
| `_gravar_membros` delete+insert sem transação/validação de existência | `apoio_os.py:156-167, 285-338` |
| Importação em lote: ~4-6 consultas síncronas por linha (timeout em arquivos grandes) | `apoio_os.py:820-960` |
| `responder`/`lancar`/play-pause/`mudarStatus`: proteção só via `disabled` — clique duplo no mesmo tick enfileira 2 ops | `OrdensServico.jsx:380-395, 793-839, 1321-1338, 2861-2885` |
| `sincronizarAgora` lê `sincronizando` de estado (duas execuções concorrentes enviam as mesmas ops/fotos) | `OrdensServico.jsx:2481-2528` |
| "Descartar" pendência **sem confirmação** (foto/evidência pode ser única) | `ModalPendenciasSync.jsx:117-121` |
| `reenviarItem` sem try/finally → spinner eterno se lançar | `ModalPendenciasSync.jsx:101-115` |
| Aba **Evidências** sem caminho offline (diferente do checklist/impedimento) | `OrdensServico.jsx:1150-1169` |
| Sem botão **"Impedir"** no painel mobile/campo (só drag no Kanban desktop) | `OrdensServico.jsx:1405-1442` |
| Filtros/busca/paginação **ignorados offline** na lista local | `OrdensServico.jsx:2734-2740` |
| `apiFetch` sem timeout padrão (failover lento em WiFi sem internet) | `api.js:87-103` |
| Sonda 10 s + contador 4 s rodam para todos (inclusive gestor); efeito reinicia com `sincronizando` nas deps | `OrdensServico.jsx:2534-2579` |
| Timeout de 60 s por foto + **interrupção total** ao 1º erro de rede (recomeça do zero) | `sync.js:54-60` |
| Atraso fixo de 1200 ms e promise potencialmente pendente em `abrirSeletorFoto` | `OrdensServico.jsx:124-151` |
| Toast: `setTimeout` solto (erro pode sumir antes) | `OrdensServico.jsx:2475-2479` |
| ModalImpedimento: fotos enviadas/gravadas **antes** da confirmação do status (órfãs se cancelar) | `OrdensServico.jsx:2274-2314` |
| Cache `_urlsFotosPendentes` (object URLs) nunca revogado; contador lê todos os blobs a cada 4 s | `offline.js:410-478, 480-488` |
| `completarPacoteCampo` não rastreia checklist faltante na meta; catálogo `produtos` parcialmente limpo se um `dbPut` falhar | `offline.js:227-243, 189-223` |
| Descarte de op não reverte espelho local (status mostra estado que nunca existirá no servidor) | `ModalPendenciasSync` + `offline.js:296-308` |
| Fotos 4xx permanentes sem política de descarte com aviso | `sync.js:49-59` |
| Logout/login e `limparPacote` quase duplicados (política inconsistente) | `db.js:87-95` vs `offline.js:249-260` |
| Portal cativo responde HTML e `testarConexao` conta como online | `offline.js:53-65` |
| `prepararPacoteCampo` limpa stores antes do download (falha no meio destrói pacote antigo sem ativar modo) | `offline.js:189-223` |
| O.S "completa" só verifica detalhe, nunca checklist | `offline.js:227-243` |

---

## 🟢 Baixos (higiene/robustez futura)

- PDFs com nome fixo no temp (`os_<codigo>.pdf`) — colisão entre requisições concorrentes → usar `NamedTemporaryFile`/uuid.
- PDFs com timestamps UTC crus (sem fuso local).
- Custo real de M.O. sempre 0 no relatório (`_resumo_mao_de_obra` deixa `custo_real` 0 — verificar se intencional).
- Sem reabertura de O.S concluída/cancelada (correção exige excluir a O.S).
- `OSUpdate` aplica defaults quando campo ausente (payload parcial zera campos) → `exclude_unset`.
- `snapshot_checklist` não filtra `tipo` do modelo e não é idempotente sob concorrência (`ON CONFLICT`).
- `recalcularResumo` assume 5 grupos fixos no offline.
- `resumo.grupos.forEach((g,i) => ...)` casa nomes por índice (frágil).
- Nomes de grupo do checklist preservados posicionalmente.
- `listar_equipes` N+1 (1 query por equipe).
- `enviar_foto` grava `filename` cru (basename/truncatura).
- Blob URLs de PDF sem revoke (`abrirPdf`, `imprimirModelo`).
- `setOsSelecionada(prev => prev)` no-op em `mudarStatus` offline.
- `DB_VERSION = 2` sem migração futura; sem `onblocked`/`onversionchange` no IndexedDB.
- `AbortSignal.timeout` sem polyfill (WebViews Android antigas).
- Service worker com cache fixo (`munaretto-v1`) e `addAll` que falha tudo se 1 asset falhar.
- Tipo de id: comparações `o.id === os.id` sem `Number()` único.
- Centralizar listas fixas de contratos (`['construcao','manutencao','linha_viva']`) e `ROTULOS_TIPO_SERVICO`.

---

## Decisões de negócio pendentes

1. **Custo real de M.O. zerado** no relatório — intencional (até definir valor por equipe) ou calcular com `funcionarios.valor_hora`?
2. **Reabertura de O.S concluída/cancelada** pelo gestor (com justificativa/auditoria) — desejada?
3. Botão **"Impedir"** disponível ao usuário de campo no mobile (hoje só drag do Kanban desktop)?
4. Manter O.S **concluída visível** no Modo Campo (grupo "Concluída") ou permanece fora da faixa do campo?

---

## Plano de execução sugerido (lotes)

- **Lote 1 — integridade (C1-C5 + A1, A3, A4, A9)**: idempotência do sync; cronômetro HH offline com espelho; mapa de fotos persistente; chunking ≤200; logout seguro com pendências; atomicidade de status/pause; sanidade de apontamentos; `exige_foto` no backend; conflitos 4xx descartáveis com confirmação.
- **Lote 2 — coerência offline/online (A5, A6, A7, A8 + filtros offline, Evidências offline, botão Impedir, guarda de clique)**: espelhamento do pacote ao operar online; um único PainelExecucao; sequência de listagem; timers/erros limpos.
- **Lote 3 — robustez backend (A2, A10 + sanitização de busca, X-Total-Count, TOCTOU código O.S, `criar_os` transacional, uploads streaming, não vazar exceções, timeouts `apiFetch`, `_gravar_membros`, importação em lote)**: com testes para cada item.
- **Lote 4 — higiene/baixos**: memória (object URLs), PDFs (nome/fuso), PATCH no OSUpdate, snapshot (tipo/ON CONFLICT), grupos dinâmicos, migração do IndexedDB, polyfill AbortSignal, SW versionado, etc.

> Cada lote deve ser implementado com testes (backend: suíte pytest; frontend: lint/build) e deploy isolado, retomando este arquivo como checklist.
