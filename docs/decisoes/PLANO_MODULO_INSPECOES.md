# Módulo Inspeções

> **Status:** implementado (nov/2026).
>
> Checklists configuráveis, inspeções de campo offline, fotos, PDF com
> assinaturas e vínculo com obras.

## Decisões

- **Atividade** é um cadastro configurável (seed: “Segurança”) e o **Tipo de
  Inspeção** é um modelo de checklist vinculado à atividade.
- **Formato de resposta configurável por modelo:** Conforme/Não Conforme/N/A
  (padrão) ou Sim/Não/N/A. Este último é usado no checklist do caminhão
  guindauto, onde “Não” não significa, por si só, não conformidade.
- **Tipo de serviço** é um campo separado no modelo, copiado para a inspeção e
  exibido no PDF (ex.: “Guindauto”).
- **Funcionário** e **Equipe inspecionada** são opcionais; **Veículo** e
  **Setor** são texto livre. **Obra** é opcional (quando vinculada, entra na
  contagem do Painel da Obra).
- **Inspetor** é pré-preenchido com o usuário logado; o gestor pode alterar.
- **Assinaturas** usam funcionários do cadastro (a equipe selecionada
  pré-seleciona os membros).
- **PDF gerado no servidor** (`fpdf2`), com capa, tabela do checklist,
  observações gerais, fotos e assinaturas (Técnico de Segurança do Trabalho,
  Responsável Empresa e pessoas presentes).
- **Permissões:** `inspecoes` (gestor) e `inspecoes_campo` (técnico, vê apenas
  as próprias inspeções).
- **Offline:** rascunho criado no IndexedDB com snapshot do checklist; fotos em
  Blob; sincronização automática em Wi-Fi (e botão manual).

## Banco (schema.sql)

- `inspecao_atividades`, `inspecao_modelos` (`tipo_resposta`, `tipo_servico`),
  `inspecao_modelo_grupos`, `inspecao_modelo_itens`;
- `inspecoes` (snapshot de `tipo_resposta`/`tipo_servico`), `inspecao_itens`,
  `inspecao_respostas` (aceita C/NC/NA e Sim/Não/N/A), `inspecao_fotos`,
  `inspecao_assinantes`;
- `inspecao_sync_ops` (idempotência por `dispositivo + id_local`).

Rode o `backend/schema.sql` no Supabase antes do deploy do backend novo. A
atividade “Segurança” é criada de forma idempotente. O schema também cria, se
ainda não existir, o modelo **“Inspeção de Segurança do Caminhão Guindauto”**
com 6 grupos e 32 itens (formato Sim/Não/N/A, tipo de serviço Guindauto).

## API (`/api/inspecoes`)

- `GET /opcoes` — atividades, modelos, obras, funcionários e equipes;
- CRUD de atividades e modelos (escrita restrita ao gestor);
- `GET /` e `GET /{id}` — lista/detalhe (campo vê apenas as próprias);
- `POST /` e `POST /{id}/finalizar` — criação e conclusão;
- `POST /{id}/fotos` — evidências por item (idempotentes no sync);
- `POST /{id}/cancelar`, `DELETE /{id}` — gestão;
- `GET /{id}/pdf` — relatório para impressão/assinatura;
- `POST /sincronizar` — criação/atualização/finalização offline em lote.

Regras de conclusão: todos os itens respondidos; no formato
Conforme/Não Conforme/N/A, “Não Conforme” exige observação; no formato
Sim/Não/N/A, a observação é geral da inspeção. Itens que exigem foto precisam
de pelo menos uma evidência (exceto N/A).

## Frontend

- **Nova Inspeção:** Data, Inspetor, Obra (autocomplete por nome/Nota PS e
  cliente), Local, Atividade, Tipo de Inspeção, Tipo de serviço, Funcionário,
  Equipe inspecionada, Encarregado, Veículo, Setor, assinantes e “Iniciar”.
- **Editor:** checklist por grupos, respostas dinâmicas (C/NC/N/A ou
  Sim/Não/N/A), observações gerais, câmera/galeria, progresso e finalização.
- **Lista:** filtros (obra, atividade, status, busca), status de sincronização,
  PDF, exclusão de rascunhos.
- **Modelos e atividades:** cadastro de grupos, perguntas, classificação,
  formato de resposta, tipo de serviço e item que exige foto.
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

- Backend: `pytest backend/tests` (501 testes) e `ruff check`.
- Frontend: `npm run lint`, `npm test` (107 testes) e `npm run build`.
