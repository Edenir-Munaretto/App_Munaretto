# Diagrama — Módulo Controle de O.S (Ordens de Serviço)

Explicação visual do funcionamento do módulo, passo a passo. Fontes:
`backend/routers/os.py`, `backend/utils/checklist_os.py` e
`frontend/src/pages/OrdensServico.jsx`.

---

## 1. Visão geral da arquitetura

```mermaid
flowchart LR
    subgraph Frontend["Frontend (React/Vite)"]
        Kanban["Kanban + lista mobile"]
        Painel["Painel de execução<br/>(checklist, H.H., serviços, fotos)"]
        Campo["Modo Campo<br/>(IndexedDB + fila offline)"]
    end

    subgraph Backend["Backend (FastAPI /api/os/*)"]
        Estados["Máquina de estados"]
        Gates["Gates do checklist"]
        HH["H.H. (play/pause)"]
        Fotos["Materiais e fotos (S3)"]
        PDF["PDFs (checklist, execução, capa oficial)"]
    end

    subgraph Dados["Supabase (Postgres) + S3"]
        Tabelas["ordens_servico · os_checklist_itens/respostas<br/>os_apontamentos · os_fotos · os_historico<br/>os_materiais · obras · equipes · produtos"]
    end

    Frontend <-->|"HTTPS / JWT"| Backend
    Backend --> Dados
```

```
┌───────────────────────────┐   HTTPS / JWT   ┌──────────────────────────────┐
│  FRONTEND (React/Vite)    │ ◄─────────────► │  BACKEND (FastAPI /api/os/*) │
│  · Kanban + lista mobile  │                 │  · Máquina de estados        │
│  · Painel de execução     │                 │  · Gates do checklist        │
│  · Modo Campo (IndexedDB) │                 │  · H.H. (play/pause)         │
└───────────────────────────┘                 │  · Materiais e fotos (S3)    │
                                              │  · PDFs (checklist, execução,│
                                              │    capa oficial)             │
                                              └──────────────┬───────────────┘
                                                             │
                              ┌──────────────────────────────▼───────────────┐
                              │  SUPABASE (Postgres) + S3 (fotos)            │
                              │  ordens_servico · os_checklist_itens/respostas│
                              │  os_apontamentos · os_fotos · os_historico   │
                              │  os_materiais · obras · equipes · produtos   │
                              └──────────────────────────────────────────────┘
```

---

## 2. Ciclo de vida da O.S (máquina de estados)

```mermaid
stateDiagram-v2
    [*] --> Rascunho: criar (gestor)
    Rascunho --> Aberta: abrir
    Rascunho --> Cancelada: cancelar (gestor)
    Aberta --> EmAndamento: Grupo 1 completo / play H.H.
    Aberta --> Impedida: justificativa ≥20 + foto
    Aberta --> Cancelada: cancelar (gestor)
    EmAndamento --> Impedida: justificativa ≥20 + foto
    EmAndamento --> Concluida: checklist 100%
    EmAndamento --> Cancelada: cancelar (gestor)
    Impedida --> EmAndamento: retomar
    Concluida --> [*]
    Cancelada --> [*]
```

```
                    criar (gestor)
              ┌────────────────────┐
              ▼                    │
         ┌──────────┐              │
         │ Rascunho │              │
         └────┬─────┘              │
              │ abrir              │
              ▼                    │
         ┌─────────┐               │   cancelar (SÓ gestor)
         │  Aberta ├───────────────┼──────────────►┐
         └────┬────┘               │                │
              │                    │                │
              │ ① Grupo 1 completo │                ▼
              │ ② ou play do H.H.  │           ┌────────────┐
              ▼ (com gate ①)       │           │ Cancelada  │
         ┌──────────────┐          │           └────────────┘
         │Em Andamento  │◄─────────┼──────────────┐
         └──┬───────┬───┘          │              │
            │       │              │              │
            │       │ impedida:    │              │
            │       │ justif. ≥20  │              │
            │       │ + 1 foto     │              │
            │       ▼              │              │
            │  ┌──────────┐        │              │
            │  │ Impedida │──retomar──────────────┘
            │  └──────────┘        │
            │  (fim 95)            │
            │ checklist 100%       │
            ▼ respondido           │
         ┌────────────┐            │
         │ Concluída  │ (encerra cronômetros abertos)
         └────────────┘
```

**Gates (validações no servidor, `alterar_status`):**

| Transição | Regra |
|---|---|
| `aberta → em_andamento` | Checklist **Grupo 1 (Preparação)** 100% respondido |
| `→ impedida` | Justificativa ≥ 20 caracteres + pelo menos 1 foto de evidência |
| `→ concluida` | Checklist completo (todos os itens de todos os grupos) |
| `→ cancelada` | Exige permissão de gestor (`os`) |
| qualquer outra | Rejeitada com 422 (destinos permitidos informados na mensagem) |

---

## 3. Passo a passo do dia (fluxo do usuário)

```mermaid
flowchart TD
    A["1. GESTOR cria a O.S<br/>obra + equipe + prioridade + prazo + orçamento<br/>capa (tipo construção / linha viva)"] --> B
    B["2. NA BASE (online)<br/>check-in (hora + GPS) e preenchimento do<br/>Grupo 1 'Preparação (base)'"] --> C
    C["3. LIBERAÇÃO: aberta → em_andamento<br/>botão de status (gate Grupo 1) ou play do H.H."] --> D
    D["4. NO CAMPO — Painel de Execução (abas)<br/>checklist (2–5) · cronômetro H.H. · serviços<br/>evidências (fotos) · timeline"] --> E
    E["5. IMPEDIMENTO (se necessário)<br/>justificativa ≥20 + fotos → impedida<br/>retomar → em_andamento"] --> F
    F["6. CONCLUSÃO<br/>checklist 100% → concluída (encerra H.H.<br/>esquecidos, registra data_fim, notifica criador)"] --> G
    G["7. RELATÓRIOS<br/>PDF do checklist · PDF de execução<br/>capa oficial (imprimir) · aplicado vs orçado + custo M.O."]
```

```
 1. GESTOR cria a O.S (ModalNovaOS)
    · obra + equipe + prioridade + prazo + custo M.O. orçado
    · itens orçados (produto x qtd) e "capa" (tipo construção/linha viva)
    · O sistema copia o catálogo do checklist → SNAPSHOT fixo na O.S
      (mudanças futuras no catálogo não alteram O.S antigas)

 2. NA BASE (online) — líder faz CHECK-IN (hora + GPS) e abre o painel
    · preenche o Grupo 1 "Preparação (base)" → libera execução

 3. LIBERAÇÃO: aberta → em_andamento
    · via botão de status (gate ①) OU automaticamente ao dar PLAY no H.H.

 4. NO CAMPO — dentro do Painel de Execução (abas):
    · Checklist  ─► grupos 2–5; respostas sim/nao/na; "não" registra a seleção
                    (justificativa opcional); itens podem exigir foto
    · Cronômetro ─► PLAY abre bloco de H.H. (só 1 aberto por pessoa/O.S);
                    PAUSE fecha e calcula minutos; impedida/concluída não aponta
    · Serviços   ─► lançar aplicado x orçado; estorno só gestor
    · Evidências ─► fotos (câmera/galeria) no S3; excluir só gestor
    · Timeline   ─► histórico de transições (quem/quando/GPS)

 5. IMPEDIMENTO (se necessário): justif. ≥20 + fotos → impedida;
    retomar → em_andamento; gestor pode cancelar

 6. CONCLUSÃO: checklist 100% → concluída → encerra cronômetros esquecidos,
    registra data_fim e notifica o criador

 7. RELATÓRIOS: PDF do checklist · PDF de execução · capa oficial (imprimir)
    · resumo aplicado vs orçado + custo real de M.O.
```

---

## 4. Modo Campo (offline) — sincronização

```mermaid
flowchart LR
    subgraph Base["BASE (online)"]
        P["Preparar pacote<br/>lista + detalhes + checklist → IndexedDB"]
    end
    subgraph Campo["CAMPO (offline)"]
        F["Fila de operações (IndexedDB)<br/>checklist (1–5) · fotos (Blob)<br/>H.H. play/pause · status (impedida/…)<br/>+ reflexo otimista na lista/painel"]
    end
    subgraph Retorno["RETORNO (online)"]
        S["1. auto-sync (evento online)<br/>2. fotos primeiro: id local → id servidor<br/>3. lote /os/sincronizar (revalidado pelos gates)<br/>4. pendências: reenviar individual ou descartar"]
    end

    Base -->|"baixa o pacote"| Campo
    Campo -->|"volta à internet"| Retorno
```

```
 BASE (online)            CAMPO (offline)                 RETORNO (online)
┌────────────────┐   ┌────────────────────────┐   ┌──────────────────────────┐
│ Preparar pcte  │   │ Ações → fila IndexedDB │   │ 1. auto-sync (online)    │
│ (lista+detalhes│   │ · checklist grupos 1-5 │   │ 2. fotos primeiro: id    │
│ +checklist) →  │──►│ · fotos (Blob local)   │──►│    local → id servidor   │
│ IndexedDB      │   │ · H.H. play/pause      │   │ 3. lote /os/sincronizar  │
└────────────────┘   │ · status (impedida/…)  │   │    (revalidado p/ gates) │
                     │ · reflexo otimista na  │   │ 4. pendências: reenviar  │
                     │   lista/painel         │   │    individual ou descartar
                     └────────────────────────┘   └──────────────────────────┘
```

---

## Permissões

| Perfil | Permissão | Pode |
|---|---|---|
| Gestor | `os` | Criar/editar/cancelar O.S, estornar serviços, excluir evidências, ver tudo |
| Campo | `os_campo` | Executar tarefas (status, H.H., fotos, serviços, imprimir) das O.S das equipes em que atua |

O vínculo do usuário com o funcionário/equipe é feito em **Configurações → Usuários**.
