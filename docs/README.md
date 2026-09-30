# Documentação — índice

Ponto de partida: [README.md](../README.md) (visão geral, setup local e links).

## Referência (documentação viva)

| Documento | Conteúdo |
|---|---|
| [ARQUITETURA.md](ARQUITETURA.md) | Visão técnica: stack, pastas, auth/permissões, módulos, banco, padrões e dívida técnica |
| [DIAGRAMA_OS.md](DIAGRAMA_OS.md) | Fluxo completo do módulo de O.S: máquina de estados, gates, dia a dia, Modo Campo |
| [IMPLANTACAO.md](IMPLANTACAO.md) | Deploy: Supabase, Render (Docker), Vercel, Backblaze B2 e variáveis de ambiente |

## Registros de decisões e planos (`decisoes/`)

Documentos históricos de planejamento/revisão. O **status** indica se já foi implementado.

| Documento | Assunto | Status |
|---|---|---|
| [PLANO_MODO_CAMPO.md](decisoes/PLANO_MODO_CAMPO.md) | Modo Campo offline → pacote contínuo (auto-preparo/refresh) | Implementado |
| [PLANO_FIX_TELA_BRANCA_PWA.md](decisoes/PLANO_FIX_TELA_BRANCA_PWA.md) | Correção da tela branca do PWA em rede móvel instável | Concluído (set/2026) |
| [PLANO_SEGURANCA.md](decisoes/PLANO_SEGURANCA.md) | Hardening de segurança (auth, CORS, RLS, rate limit) | Implementado (todas as fases) |
| [PLANO_GESTAO_POR_OBRA.md](decisoes/PLANO_GESTAO_POR_OBRA.md) | Resumo/relatórios consolidados por obra | Implementado (Fase 1) |
| [analise_revisao_os_offline.md](decisoes/analise_revisao_os_offline.md) | Revisão de integridade do módulo O.S/offline | Implementado (set/2026) |
| [analise_ux_os.md](decisoes/analise_ux_os.md) | Análise de UX do módulo de O.S | Referência (sugestões) |
| [implementation_plan.md](decisoes/implementation_plan.md) | Plano de melhorias do backend/frontend | Histórico (parcial) |
| [PLANO_CONTAS_A_PAGAR.md](decisoes/PLANO_CONTAS_A_PAGAR.md) | Módulo de contas a pagar (parcelas, baixas, relatório) | **Pendente** (não implementado) |

## Convenções

- Novo registro de decisão/plano vai em `docs/decisoes/`, em português, com um bloco de **status** no topo (`pendente`, `em execução`, `implementado`) e data quando fizer sentido.
- Mudou comportamento ou arquitetura? Atualize o documento correspondente no **mesmo PR** (ver [CONTRIBUTING.md](../CONTRIBUTING.md)).
