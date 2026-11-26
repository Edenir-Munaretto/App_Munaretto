# Módulo Inspeções

> **Status:** implementado (nov/2026).
>
> Checklists configuráveis, inspeções de campo offline, fotos, PDF com
> assinaturas e vínculo com obras.

## Decisões

- **Atividade** é um cadastro configurável (seed: “Segurança”) e o **Tipo de
  Inspeção** é um modelo de checklist vinculado à atividade.
- **Funcionário** e **Equipe** são opcionais; **Veículo** e **Setor** são texto
  livre. **Obra** é opcional (quando vinculada, entra na contagem do Painel da
  Obra).
- **Inspetor** é pré-preenchido com o usuário logado; o gestor pode alterar.
- **Assinaturas** usam funcionários do cadastro (a equipe selecionada
  pré-seleciona os membros).
- **PDF gerado no servidor** (`fpdf2`), com capa, tabela do checklist,
  não conformidades, fotos e bloco de assinaturas.
- **Permissões:** `inspecoes` (gestor) e `inspecoes_campo` (técnico, vê apenas
  as próprias inspeções).
- **Offline:** rascunho criado no IndexedDB com snapshot do checklist; fotos em
  Blob; sincronização automática em Wi-Fi (e botão manual).

## Banco (schema.sql)

- `inspecao_atividades`, `inspecao_modelos`, `inspecao_modelo_grupos`,
  `inspecao_modelo_itens`;
- `inspecoes`, `inspecao_itens` (snapshot), `inspecao_respostas`,
  `inspecao_fotos`, `inspecao_assinantes`;
- `inspecao_sync_ops` (idempotência por `dispositivo + id_local`).

Rode o `backend/schema.sql` no Supabase antes do deploy do backend novo. A
atividade “Segurança” é criada de forma idempotente.

## API (`/api/inspecoes`)

- `GET /opcoes` — atividades, modelos, obras, funcionários e equipes;
- CRUD de atividades e modelos (escrita restrita ao gestor);
- `GET /` e `GET /{id}` — lista/detalhe (campo vê apenas as próprias);
- `POST /` e `POST /{id}/finalizar` — criação e conclusão;
- `POST /{id}/fotos` — evidências por item (idempotentes no sync);
- `POST /{id}/cancelar`, `DELETE /{id}` — gestão;
- `GET /{id}/pdf` — relatório para impressão/assinatura;
- `POST /sincronizar` — criação/atualização/finalização offline em lote.

Regras de conclusão: todos os itens respondidos; “Não Conforme” com observação;
itens que exigem foto com pelo menos uma evidência (exceto N/A).

## Frontend

- **Nova Inspeção:** Data, Inspetor, Obra (autocomplete por nome/Nota PS e
  cliente), Local, Atividade, Tipo de Inspeção, Funcionário, Equipe,
  Encarregado, Veículo, Setor, assinantes e “Iniciar”.
- **Editor:** checklist por grupos, respostas Conforme/Não Conforme/N/A,
  observações, câmera/galeria, progresso e finalização.
- **Lista:** filtros (obra, atividade, status, busca), status de sincronização,
  PDF, exclusão de rascunhos.
- **Modelos e atividades:** cadastro de grupos, perguntas, classificação e item
  que exige foto.
- **Offline:** stores `insp_*` no IndexedDB (`munaretto-campo`, v5), pacote de
  consulta, cache de fotos e modal de pendências.
- **Painel da Obra:** card com inspeções concluídas/total da obra.

## Como testar

1. Rodar o schema novo no Supabase e subir backend/frontend.
2. Liberar as permissões `inspecoes` e/ou `inspecoes_campo` em **Configurações**
   e cadastrar uma atividade/modelo em **Inspeções → Modelos e atividades**.
3. Criar uma inspeção, preencher o checklist e anexar as fotos.
4. Com o DevTools → Network → Offline: criar/editar uma inspeção e tirar fotos.
5. Voltar ao Wi-Fi: sincronização automática (ou botão “Sincronizar”), conferir
   no servidor e gerar o PDF.
6. Abrir uma obra no Controle de O.S e conferir o card de inspeções.

## Verificação

- Backend: `pytest backend/tests` (500+ testes) e `ruff check`.
- Frontend: `npm run lint`, `npm test` e `npm run build`.
