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

---

# Plano — Modo Campo contínuo (auto-preparo, refresh e limpeza)

> **Status:** Fase 1 e parte da Fase 2 **implementadas** (11/09/2026);
> Fase 3 pendente.
> **Decisões do usuário:** celulares **pessoais** (não compartilhados) ·
> upload manual no Wi-Fi · refresh automático em qualquer conexão ·
> logout **não** limpa os dados locais · troca de usuário no mesmo aparelho
> limpa com aviso · sem botão "Finalizar/Limpar dispositivo" no fluxo diário.

## Premissas

- Usuário `os_campo` entra no Modo Campo automaticamente (sem botão "Preparar").
- O pacote é mantido fresco: novas O.S entram sozinhas; as existentes são
  atualizadas; as que saíram da lista ativa são podadas (sem pendências).
- **Upload continua manual e só no Wi-Fi** (fotos pesadas).
- Pacote vinculado ao usuário (`meta.dono`): mesmo dono mantém; outro usuário
  no aparelho limpa com aviso.
- Sem ação de "finalizar" diária: limpeza total só no card de recuperação.

---

## Fase 1 — Pacote contínuo (IMPLEMENTADA)

### 1.1 `frontend/src/offline/offline.js`

- **`atualizarPacoteCampo()` virou merge completo**:
  1. Helper `_idsComPendenciaLocal()`: lê `fila` + `fotos` e devolve os
     `os_id` com pendência (operações na fila ou fotos não enviadas).
  2. Busca a lista do servidor (`_buscarListaOs()`); calcula `novas` e
     `existentes`.
  3. **Lista**: grava as novas; atualiza o resumo das existentes **sem
     pendência** (status/obra/equipe atualizados pelo gestor).
  4. **Detalhe + checklist**: baixa as novas e **re-baixa as existentes sem
     pendência** (pega mudanças feitas por outro aparelho/gestor); nunca toca
     nas que têm pendência (protege o estado otimista).
  5. **Poda**: remove `os_lista`/`os`/`checklist` das O.S que **saíram da lista
     ativa do servidor** e **não têm pendência** — apenas quando a lista veio
     completa (`LIMITE_LISTA_CAMPO = 500`, evita truncamento).
  6. **Catálogo**: atualiza `/os/produtos` via `_baixarCatalogo()` (materiais
     funcionam offline).
  7. Atualiza `meta.pacote` (quantidade/faltantes) e retorna
     `{ novas, atualizadas, removidas, faltantes }`.
- **`completarPacoteCampo()` foi removido** (a lógica de `faltantes` foi
  absorvida pelo merge).
- Dono do pacote: `salvarDonoPacote()`/`donoPacote()` (`meta.dono`);
  `limparPacote()` apaga também o dono.

### 1.2 `frontend/src/pages/OrdensServico.jsx` — auto-preparo (IMPLEMENTADO)

- `prepararModoCampoAutomatico()` no primeiro acesso online do usuário de
  campo (uma tentativa por sessão; falha libera nova tentativa ao reconectar).
- Indicador "Preparando Modo Campo..." enquanto baixa; botão "Preparar Modo
  Campo" removido.
- Offline sem pacote: melhoria prevista na Fase 3.3.

### 1.3 Refresh contínuo (qualquer conexão) — IMPLEMENTADO

- `refreshPacote()` com **throttle de 1 min**, disparado ao reconectar
  (`online`), ao voltar ao app (`focus`/`visibilitychange`) e a cada **4 min**
  enquanto no Modo Campo.
- Nunca roda concorrente com `sincronizando`/`preparandoPacote`/
  `baixandoNovas`; erro é silencioso (tenta no próximo gatilho).
- Se a O.S aberta no painel foi atualizada, incrementa `versaoPainel`.
- Após sync manual com fila zerada, o refresh já rodava (`sincronizarAgora`).

---

## Fase 2 — Barra enxuta, dono do pacote e logout (IMPLEMENTADA)

### 2.1 Botões (`OrdensServico.jsx`, barra do Modo Campo)

- **"Sincronizar agora"** (primário, azul): sempre visível; com pendências
  envia (Wi-Fi); sem pendências mostra "Nada pendente".
- **"Atualizar O.S"** (secundário): refresh manual com spinner (fallback do
  automático).
- **"Pendências (N)"** (âmbar, quando houver erros/conflitos): inalterado.
- Removidos: **"Preparar Modo Campo"** e **"Finalizar Modo Campo"**.

### 2.2 Dono do pacote (`App.jsx`)

- Pacote vinculado ao usuário (`meta.dono`).
- Login: mesmo dono mantém os dados; outro usuário → modal
  "Entrar com outro usuário neste aparelho?" (com contagem de pendências que
  serão perdidas) → **"Limpar e entrar"** ou cancelar (desfaz a sessão do novo
  usuário em `Login.jsx`).
- **Logout não limpa** os dados locais (celular pessoal).

### 2.3 Limpeza total

- Só no card de recuperação (`erroLeituraLocal`): "Limpar dados locais deste
  aparelho" / "Sair do Modo Campo e usar o servidor".
- Toast pós-sync sem atalho de finalizar ("Tudo sincronizado.").

---

## Fase 3 — Refinamentos (opcionais, após 1 e 2)

- **3.1 Cache das fotos já enviadas** no pacote (visualizar evidências
  offline) — pendência já registrada neste documento (linha 115).
- **3.2 Indicador "Atualizado há X min"** + feedback visual do refresh
  automático.
- **3.3 Estado "sem pacote offline"** com orientação para conectar (quando o
  auto-preparo nunca completou).
- **3.4 Documentação**: atualizar `PLANO_MODO_CAMPO.md` e `DIAGRAMA_OS.md`
  para o modelo contínuo (o auto-upload fica **excluído** por decisão).

---

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Refresh sobrescrever trabalho local | Nunca atualizar O.S com pendência (`_idsComPendenciaLocal`) |
| Pacote crescer sem limite | Poda das inativas sem pendência (só com lista completa) |
| Bateria/dados com refresh | Throttle de 1 min + intervalo de 4 min + download leve (upload segue Wi-Fi) |
| Troca de usuário no aparelho | Modal de confirmação no login + limpeza total antes de entrar |
| Conflito de dados (gestor muda durante o dia) | Refresh automático + modal de pendências existente |

## Verificação

- `npm run lint` + `npm run build` (OK em 11/09/2026).
- Manual: login campo → auto-preparo; gestor envia O.S nova → aparece em
  ≤4 min (ou ao voltar ao app); gestor cancela O.S sem pendência → some do
  quadro; O.S com pendência não é sobrescrita; sync manual Wi-Fi; login de
  outro usuário → modal de limpeza; logout mantém o pacote.
