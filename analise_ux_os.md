# Análise de UX — Módulo Controle de O.S

## Visão Geral do Módulo

O módulo é robusto e bem estruturado. Ele oferece:
- **Kanban drag-and-drop** com 6 colunas de status
- **Máquina de estados** rigorosa no backend (transições controladas)
- **Apontamento H.H.** com cronômetro Play/Pause + geolocalização
- **Lançamento de materiais** com autocomplete/bipagem e barra de progresso
- **Evidências fotográficas** com upload direto da câmera
- **Timeline de histórico** de mudanças
- **PDF exportável** e duplicação de O.S
- Dois modos: **Gestor (desktop/Kanban)** e **Campo (mobile/lista)**

---

## 🔴 Problemas Críticos de UX

### 1. Modal de Impedimento — Fluxo Quebrado para Usuário de Campo

**Problema:** Ao arrastar um card para "Impedida", o modal exige foto já anexada. Porém o modal **não tem acesso à aba de evidências**. O usuário precisa:
1. Cancelar o modal
2. Abrir a O.S
3. Ir para aba Evidências
4. Tirar a foto
5. Fechar o painel
6. Arrastar novamente para "Impedida"

Isso é um **fluxo de 6 etapas para o que deveria ser 2**. O usuário de campo, em obra, sob pressão, vai abandonar ou errar.

**Sugestão:** O `ModalImpedimento` deve incorporar a aba de upload de fotos **dentro do próprio modal**, permitindo tirar/anexar a evidência sem sair do fluxo.

---

### 2. Sem Feedback Visual do Cronômetro em Tempo Real

**Problema:** O botão "INICIAR TRABALHO" muda para "PAUSAR TRABALHO", mas **não há cronômetro visível correndo** enquanto o trabalho está ativo. O usuário não sabe quanto tempo passou.

**Sugestão:** Exibir um contador `HH:MM:SS` animado ao lado do botão "PAUSAR" calculado a partir do `cronometro_aberto.inicio`.

---

### 3. Drag-and-Drop sem Indicação de Transições Inválidas

**Problema:** O backend tem uma máquina de estados (`TRANSICOES_STATUS`), mas o Kanban permite arrastar um card para **qualquer coluna** visualmente. Se a transição for inválida (ex: `rascunho → concluida`), o usuário vê um erro Toast apenas **depois** de soltar o card — experiência frustrante.

**Sugestão:** Ao iniciar o drag, calcular localmente as colunas-destino válidas (replicar `TRANSICOES_STATUS` no frontend) e aplicar visual de **bloqueio** nas colunas inválidas (opacidade reduzida, cursor `not-allowed`).

---

### 4. Painel de Insumos — Sem Feedback de Estoque / Quantidade Orçada

**Problema:** O usuário lança materiais sem saber se está excedendo o orçado para aquele produto específico. O alerta de "vermelho" aparece só no card (barra geral), não na hora do lançamento.

**Sugestão:** No autocomplete de seleção do produto, exibir em tempo real: `Orçado: X | Aplicado: Y | Saldo: Z`. Se `aplicado > orçado`, mostrar aviso antes do botão "Aplicar".

---

## 🟡 Problemas Importantes de Usabilidade

### 5. Filtros Sem Botão "Limpar"

**Problema:** Quando obra, equipe e prioridade estão filtradas, não há um botão "Limpar filtros" — o usuário precisa desfazer cada select manualmente. Com 6+ colunas e filtros ativos, fica difícil saber por que aparecem poucos cards.

**Sugestão:** Exibir badge "X filtros ativos" com botão `×` para limpar tudo de uma vez.

---

### 6. Kanban — Colunas Não Rolam Independentemente

**Problema:** Com muitos cards, todas as colunas crescem verticalmente junto com a página. O visual de Kanban se quebra — você precisa rolar a página inteira para ver os cards no final de uma coluna específica.

**Sugestão:** Definir `max-h` nas colunas com `overflow-y: auto` para que cada coluna role internamente (padrão de todo Kanban maduro).

---

### 7. Mobile — Lista Não Agrupa por Status

**Problema:** No modo campo (mobile), todos os cards são listados em uma única lista flat sem separação por status. Com 20+ O.S, fica difícil encontrar as "em andamento" rapidamente.

**Sugestão:** Adicionar cabeçalhos de grupo por status na lista mobile, ou incluir um filtro rápido de status por chips horizontais rolável.

---

### 8. Modal de Nova O.S — Sem Previsão de Custo Total

**Problema:** O usuário adiciona itens orçados (produto + quantidade) mas **não vê o custo total calculado** do orçamento durante o preenchimento. Só descobre o total depois que a O.S é criada.

**Sugestão:** Calcular e exibir o custo total dos itens em tempo real dentro do modal (`Σ custo total orçado: R$ X.XXX,XX`).

---

### 9. Estorno de Material Sem Confirmação

**Problema:** O botão de estorno (lixeira) nos últimos lançamentos executa a exclusão **imediatamente** sem nenhuma confirmação. Um clique acidental apaga um lançamento de material que pode ter impacto financeiro.

**Sugestão:** Usar o `ModalConfirmacao` já existente no projeto antes de executar o estorno.

---

### 10. Excluir Foto Sem Confirmação

**Problema:** Mesmo problema do estorno — botão `×` na foto exclui imediatamente. Se a foto era a única evidência de um impedimento registrado, isso pode ser problemático.

**Sugestão:** Adicionar confirmação para exclusão de fotos, especialmente se a O.S estiver com status "impedida".

---

### 11. Sem Contagem de Fotos no Card do Kanban

**Problema:** O card não mostra se há fotos anexadas. Para saber isso, o usuário precisa abrir o painel e navegar para a aba Evidências.

**Sugestão:** Exibir um ícone 📷 com contagem no card quando `fotos.length > 0`. A API já retorna `fotos` no detalhe — poderia incluir `fotos_count` no endpoint de listagem.

---

## 🟢 Melhorias de Experiência Geral

### 12. Apontamentos — Histórico sem Detalhe por Funcionário no Painel

**Problema:** O painel de execução exibe apenas o total de horas e custo, mas não mostra o breakdown por funcionário de forma destacada.

**Sugestão:** Adicionar uma mini-seção colapsável "Quem trabalhou" com cada funcionário e suas horas, visível no painel de execução (o dado já existe no `mao_de_obra.por_funcionario`).

---

### 13. Nenhuma Ação Rápida de "Abrir → Em Andamento" sem Cronômetro

**Problema:** Para avançar uma O.S de "Aberta" para "Em Andamento" **sem** usar o cronômetro, o usuário precisa arrastar o card no Kanban. No mobile (modo campo), isso não é possível.

**Sugestão:** No painel de execução mobile, exibir botões de transição de status claros (ex: "▶ Iniciar Execução", "✓ Concluir") além do cronômetro, para usuários que não querem registrar horas.

---

### 14. Campo "Check-in" sem Integração com a O.S Selecionada

**Problema:** O check-in registra hora + GPS no estado local (`checkinInfo`), mas esse dado **não é associado a nenhuma O.S específica**. É apenas um registro visual que some quando o componente desmonta.

**Sugestão:** Integrar o check-in ao apontamento de horas — ao fazer o play em uma O.S após o check-in, usar automaticamente o GPS do check-in como geolocalização do apontamento.

---

### 15. Busca de Produto — UX de Bipagem Ineficaz

**Problema:** Ao bipar um código de barras, o campo recebe o código do produto. Mas se o código exato não bater com `p.codigo`, o autocomplete não mostrará nada (a busca é por `.includes()`). Além disso, o usuário não recebe nenhum feedback de "produto não encontrado".

**Sugestão:** Adicionar um estado explícito de "nenhum produto encontrado" com sugestão de cadastro, e garantir que a busca por código seja exata (`.eq()`) além de parcial.

---

## Resumo Priorizado

| # | Problema | Impacto | Esforço |
|---|----------|---------|---------|
| 1 | Modal Impedimento sem upload de foto | 🔴 Crítico | Médio |
| 2 | Sem cronômetro visual em tempo real | 🔴 Crítico | Baixo |
| 3 | Drag-and-drop sem bloqueio de transições inválidas | 🔴 Crítico | Baixo |
| 4 | Sem feedback de saldo ao lançar material | 🟡 Importante | Baixo |
| 5 | Filtros sem "Limpar tudo" | 🟡 Importante | Muito Baixo |
| 6 | Colunas Kanban sem scroll independente | 🟡 Importante | Muito Baixo |
| 7 | Lista mobile flat sem agrupamento | 🟡 Importante | Baixo |
| 8 | Modal Nova O.S sem custo total dinâmico | 🟡 Importante | Baixo |
| 9 | Estorno de material sem confirmação | 🟡 Importante | Muito Baixo |
| 10 | Exclusão de foto sem confirmação | 🟡 Importante | Muito Baixo |
| 11 | Card Kanban sem contagem de fotos | 🟢 Melhoria | Médio |
| 12 | Horas por funcionário ocultas | 🟢 Melhoria | Muito Baixo |
| 13 | Sem botões de transição de status no mobile | 🟢 Melhoria | Baixo |
| 14 | Check-in desconectado dos apontamentos | 🟢 Melhoria | Médio |
| 15 | Busca por bipagem sem feedback de "não encontrado" | 🟢 Melhoria | Baixo |
