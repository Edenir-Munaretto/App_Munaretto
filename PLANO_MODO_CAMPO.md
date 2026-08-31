# Plano — Modo Campo (O.S offline com sincronização)

Documento de continuação do trabalho no módulo **Controle de O.S**. Salvo para
retomarmos de onde paramos em outra sessão.

---

## Contexto e objetivo

A equipe de campo não tem internet durante o dia. O fluxo desejado:

1. **Base (manhã, online):** o líder faz check-in, baixa as O.S da equipe para o
   tablet (pacote de campo) e preenche o **checklist Grupo 1 (Preparação)**,
   que **libera a execução** (aberta → em_andamento).
2. **Campo (offline):** checklist grupos 2–5, fotos, H.H. (play/pause) e
   transições de status (impedida/concluída) funcionam com dados locais e
   ficam numa **fila de operações** com timestamp real.
3. **Retorno (online):** sincronização automática (evento `online`) + botão
   manual; o servidor revalida cada operação (máquina de estados, gates do
   checklist, permissões) e reporta erros/conflitos por operação.

**Decisões do usuário:** tablet da empresa por equipe · sem internet no campo ·
offline para checklist completo + fotos + H.H. + status (materiais ficam
online-only) · gestor edita raramente (conflitos raros).

---

## O que já foi entregue

### Fase A — Backend (concluída)
- `JWT_VALIDADE_MINUTOS` 480 → **720** (12h) em `backend/.env` e `.env.example`
  (atualizar também na Render).
- **`POST /api/os/sincronizar`** (`backend/routers/os.py`):
  - Body: `{ operacoes: [{id_local, tipo, os_id, criado_em, payload}], mapa_fotos: {} }`
  - Tipos: `checklist_resposta`, `status`, `apontamento_play`, `apontamento_pause`
  - Aplica em ordem cronológica por O.S, reutilizando validações existentes;
    falha parcial não aborta o lote; resposta por `id_local`.
  - `mapa_fotos`: id local da foto → id no servidor (evidências do impedida).
- `apontar_hora` aceita `inicio`/`fim` (ISO) — **H.H. real** do offline
  (sem isso, as horas chegariam zeradas).
- Testes: `backend/tests/test_sync_os.py` (7 testes).

### Fase B — Offline no frontend (concluída)
- `frontend/src/utils/imagem.js` — `comprimirImagem` compartilhado.
- `frontend/src/offline/db.js` — IndexedDB (stores: `os`, `checklist`,
  `os_lista`, `fila`, `fotos`, `meta`).
- `frontend/src/offline/offline.js` — Modo Campo, pacote, fila, leituras/escritas
  locais, `recalcularResumo`.
- `frontend/src/offline/sync.js` — motor: fotos primeiro (item do checklist ou
  evidência genérica), depois lote + mapa; falhas ficam na fila.
- `frontend/src/pages/OrdensServico.jsx`:
  - Botão "Preparar Modo Campo" / "Modo Campo (N O.S)" (sair limpa o tablet);
  - Banner offline + badge "Sincronizar (N)" + auto-sync ao reconectar;
  - Offline: listagem usa pacote local; checklist, fotos, H.H., status e
    impedida funcionam via fila com reflexo otimista;
  - Indicador "Offline" dentro do painel de execução.

**Verificação atual:** 166 testes backend passando; lint e build do frontend OK.

---

## Fase C — Pendências/conflitos + reenvio (entregue)

- **Tela/modal dedicado de pendências de sincronização**
  (`frontend/src/components/ModalPendenciasSync.jsx`):
  - Lista fotos (com miniatura Blob) e operações com estado
    (pendente/erro), erro do servidor e tentativas, ordenadas por hora;
  - **Reenvio individual** (fotos e operações) via seletor no
    `sincronizar()` de `frontend/src/offline/sync.js` + **"Reenviar tudo"**;
  - **Resolução de conflitos**: cada item com erro mostra a mensagem do
    servidor e as ações **Reenviar** / **Descartar** (remove do dispositivo);
  - Resumo da última sincronização no topo:
    `{fotosEnviadas, operacoesEnviadas, falhas, conflitos}`.
- Botão **"Pendências (N)"** no cabeçalho agora abre a tela (antes era só o
  sync via toast); auto-sync ao reconectar continua.
- **"Sincronizado por"**: `usuarioAtual` é persistido localmente
  (`salvarResponsavelLocal`/`responsavelLocal` em `offline.js`) ao preparar o
  pacote e ao sincronizar; exibido no rodapé do modal.
- Descartar item: `descartarPendente(tipo, id_local)` em `offline.js`.

## Fase D — Testes e ajustes finais

### Automatizado (nível de API/backend) — entregue
- **Fluxo completo do dia** (`test_sync_fluxo_completo_do_dia`): preparar
  pacote → checklist → play/pause → concluir → conferir servidor + PDF
  (`test_relatorio_pdf` em `test_checklist_os.py`).
- **Impedida offline** com foto local mapeada
  (`test_sync_status_impedida_com_foto_local_mapeada`).
- **Conflito real** (novos testes em `test_sync_os.py`):
  - Gestor conclui a O.S enquanto o tablet está offline → resposta de
    checklist rejeitada (400 "encerrada"), transição rejeitada (422),
    apontamento rejeitado (400); lote não aborta e o estado do servidor é
    preservado.
  - Gestor cancela a O.S offline → transição divergente rejeitada (422).
  - Resposta duplicada (gestor e campo no mesmo item) → upsert: última vence.
- **Limpeza do dispositivo** (correção de falha encontrada na verificação):
  - `limparPacote` agora apaga também a **fila** e as **fotos** (antes
    vazavam para o próximo usuário) + meta de responsável;
  - Troca de usuário (login/logout em `App.jsx`) encerra o Modo Campo e
    apaga os dados locais do dispositivo.
- **Verificação:** 169 testes backend passando; lint e build do frontend OK.

### Manual (navegador — precisa de internet/simulação) — PENDENTE
- Teste no navegador com DevTools → Network → **Offline**: preparar pacote →
  responder checklist → fotos → play/pause → concluir → voltar online →
  auto-sync → conferir servidor e PDF do checklist.
- Revisar UX mobile (tablet) dos botões grandes no painel.

## Pendências / observações

- **Deploy:** backend na Render (incluir `JWT_VALIDADE_MINUTOS=720` e
  `CORS_ORIGINS` com as portas locais 5198/5199) e frontend no Vercel.
- Materiais **não** estão no offline (decisão do usuário); se precisar depois,
  o tipo `material_lancamento` deve ser adicionado ao sync + fila.
- Fotos antigas (não tiradas no dispositivo) podem não exibir offline — só as
  capturadas localmente ficam como Blob; possível melhoria futura: cachear
  fotos existentes no download do pacote.
- O `README.md` e o `GUIA_RAPIDO.md` podem ganhar uma seção do Modo Campo.

## Como testar o que já existe

1. Suba backend e frontend localmente (frontend dev na porta 5199 com CORS
   liberado) ou use o deploy.
2. Online: clique **"Preparar Modo Campo"** (deve baixar as O.S).
3. DevTools → Network → **Offline**.
4. Abra uma O.S aberta, preencha o checklist, tire fotos, play/pause, conclua.
5. DevTools → Online: o sync roda sozinho; confirme no backend/site.
