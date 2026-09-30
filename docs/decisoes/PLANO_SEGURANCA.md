# 🛡️ PLANO DE SEGURANÇA — App Munaretto

**Criado em:** 05/08/2026
**Base:** Análise de vulnerabilidades do código
**Objetivo:** Endurecer o app por etapas, com atividades rastreáveis por ID.

---

## 🎯 COMO USAR ESTE PLANO

Cada melhoria tem um **ID** único (ex: `T1.2`). Para executar, basta solicitar:

> "Execute a atividade **T2.1**"

Eu localizo a atividade no plano, implemento o código, verifico (build/lint) e atualizo o
checklist abaixo. Você também pode pedir para executar uma **fase inteira**:

> "Execute a **Fase 2**"

---

## 📊 STATUS GERAL

| Fase | Descrição | Status |
|------|-----------|--------|
| Fase 1 | Autenticação e Autorização | ✅ Concluída |
| Fase 2 | Correções de Injeção e Input | ✅ Concluída |
| Fase 3 | Infraestrutura e Configuração | ✅ Concluída |
| Fase 4 | Frontend | ✅ Concluída |
| Fase 5 | Qualidade, Testes e Verificação Final | ✅ Concluída |

---

## FASE 1 — AUTENTICAÇÃO E AUTORIZAÇÃO 🔴 (prioridade máxima)

### T1.1 — Criar sistema de tokens de sessão
- **Descrição:** Implementar emissão de token (JWT) no login com secret em variável de
  ambiente, expiração e assinatura segura. Manter compatibilidade com hash de senha atual.
- **Arquivos:** `backend/routers/usuarios.py`, `backend/.env.example` (novo), `backend/requirements.txt`
- **Concluído quando:** login retorna `token` + dados do usuário; token expirado é rejeitado.

### T1.2 — Criar dependência de autenticação reutilizável
- **Descrição:** Criar `backend/auth.py` (novo) com `get_current_user()` que valida o token
  (`Authorization: Bearer <token>`) e retorna o usuário.
- **Arquivos:** `backend/auth.py` (novo), `backend/supabase_client.py`
- **Concluído quando:** a dependência pode ser injetada em qualquer rota.

### T1.3 — Proteger todas as rotas com autenticação
- **Descrição:** Aplicar `Depends(get_current_user)` em todos os routers: clientes, férias,
  fluxo de caixa, documentos, comprovantes, recebimentos, notificações, funcionários e
  CRUD de usuários. **Exceção:** apenas `POST /api/usuarios/login`.
- **Arquivos:** todos os `backend/routers/*.py`
- **Concluído quando:** chamadas sem token retornam `401`; com token inválido também.

### T1.4 — Validação de permissões por módulo no servidor
- **Descrição:** Criar `require_permisao(modulo)` que verifica se o usuário autenticado tem a
  permissão do módulo antes de executar. Aplicar por router/rota conforme o módulo.
- **Arquivos:** `backend/auth.py`, todos os `backend/routers/*.py`
- **Concluído quando:** a permissão é validada no servidor (não só no menu do frontend).

### T1.5 — Rate limiting no login
- **Descrição:** Limitar tentativas de login (ex: 5 por minuto por IP/e-mail) para impedir
  força bruta. Usar implementação simples sem dependência pesada.
- **Arquivos:** `backend/routers/usuarios.py`, `backend/auth.py`
- **Concluído quando:** tentativas excedentes retornam `429`.

---

## FASE 2 — CORREÇÕES DE INJEÇÃO E INPUT 🟠

### T2.1 — Corrigir injeção PostgREST em buscas
- **Descrição:** Substituir as f-strings em `query.or_(f"...ilike.%{busca}%...")` por chamadas
  estruturadas com `ilike` por coluna e OR construído com parâmetros.
- **Arquivos:** `backend/routers/clientes.py`, `backend/routers/funcionarios.py`
- **Concluído quando:** busca com caracteres especiais (vírgula, aspas, `)`) não quebra nem injeta.

### T2.2 — Corrigir path traversal e upload inseguro de templates
- **Descrição:** Sanitizar nome do arquivo com `os.path.basename`, validar extensão e tamanho
  máximo (ex: 10 MB), impedir sobrescrita acidental e não confiar no `filename` do cliente.
- **Arquivos:** `backend/routers/documentos.py`
- **Concluído quando:** upload com nome `../../x.docx` é bloqueado; tamanho acima do limite é rejeitado.

### T2.3 — Validar status de férias contra enum
- **Descrição:** Restringir valores aceitos em `PATCH /ferias/{id}/status` (ex: Programado,
  Agendado, Em Férias, Concluído, Gozadas, Cancelado).
- **Arquivos:** `backend/routers/ferias.py`
- **Concluído quando:** status inválido retorna `400`.

### T2.4 — Sanitizar mensagens de erro (não expor detalhes internos)
- **Descrição:** Substituir `detail=f"Erro: {str(e)}"` por mensagem genérica; logar o erro real
  no servidor com `logging.exception`.
- **Arquivos:** todos os `backend/routers/*.py`
- **Concluído quando:** respostas de erro não vazam caminhos/stacktrace do servidor.

### T2.5 — Proteger notificações por usuário autenticado
- **Descrição:** Listar/marcar notificações apenas do usuário autenticado (derivar e-mail do
  token, ignorando o parâmetro `destinatario` do cliente).
- **Arquivos:** `backend/routers/notificacoes.py`, `backend/auth.py`
- **Concluído quando:** um usuário não consegue ler nem marcar notificações de outro.

---

## FASE 3 — INFRAESTRUTURA E CONFIGURAÇÃO 🟡

### T3.1 — Restringir CORS
- **Descrição:** Trocar `allow_origins=["*"]` por lista vinda de variável de ambiente
  (`CORS_ORIGINS`), mantendo credenciais apenas para origens explícitas.
- **Arquivos:** `backend/main.py`, `backend/.env.example`
- **Concluído quando:** origens não listadas não conseguem acessar a API.

### T3.2 — Criar `.env.example` e documentar variáveis
- **Descrição:** Documentar `SUPABASE_URL`, `SUPABASE_KEY`, `JWT_SECRET`, `CORS_ORIGINS` etc.
- **Arquivos:** `backend/.env.example` (novo), `README.md`
- **Concluído quando:** novo desenvolvedor consegue configurar o ambiente só com o exemplo.

### T3.3 — Cookies seguros e HTTPS
- **Descrição:** Configurar flags `Secure`, `HttpOnly`, `SameSite` no cookie de sessão (se usado),
  e documentar exigência de HTTPS/TLS em produção.
- **Arquivos:** `backend/auth.py`, `README.md`
- **Concluído quando:** sessão não acessível via JavaScript e documentado TLS.

### T3.4 — RLS no Supabase + schema atualizado
- **Descrição:** Adicionar políticas de Row Level Security no `schema.sql` para todas as tabelas
  e documentar passos de aplicação no Supabase.
- **Arquivos:** `backend/schema.sql`, `README.md`
- **Concluído quando:** políticas RLS documentadas e aplicáveis por script.

### T3.5 — Credenciais padrão e política de senha
- **Descrição:** Remover/desabilitar o admin padrão `admin123`, forçar troca de senha no primeiro
  acesso e elevar `min_length` da senha (ex: 8+).
- **Arquivos:** `backend/routers/usuarios.py`
- **Concluído quando:** não há credencial padrão fraca; senha nova exige 8+ caracteres.

---

## FASE 4 — FRONTEND 🟢

### T4.1 — Gerenciar token no frontend
- **Descrição:** Salvar o token retornado no login e enviar `Authorization: Bearer <token>` em
  todas as requisições.
- **Arquivos:** `frontend/src/App.jsx`, `frontend/src/pages/Login.jsx`, páginas com `fetch`
- **Concluído quando:** toda chamada API autenticada.

### T4.2 — Tratar 401 e centralizar chamadas API
- **Descrição:** Criar helper `apiFetch` (ex: `frontend/src/api.js`) que injeta o token, trata
  `401` com logout automático e erro genérico.
- **Arquivos:** `frontend/src/api.js` (novo), `frontend/src/App.jsx`, páginas
- **Concluído quando:** sessão expirada redireciona ao login automaticamente.

### T4.3 — Alinhar menu e ações às permissões do servidor
- **Descrição:** Revisar exibição de menu/ações conforme permissões reais validadas no servidor.
- **Arquivos:** `frontend/src/App.jsx`, `frontend/src/modules.js`
- **Concluído quando:** UI reflete as permissões autorizadas pelo backend.

### T4.4 — Validações de formulário de login
- **Descrição:** Exigir senha com comprimento mínimo e exibir mensagens genéricas (sem detalhes).
- **Arquivos:** `frontend/src/pages/Login.jsx`
- **Concluído quando:** validações no cliente antes do envio.

---

## FASE 5 — QUALIDADE, TESTES E VERIFICAÇÃO FINAL 🧪

### T5.1 — Testes básicos de autenticação
- **Descrição:** Testar: login OK, senha errada, token inválido, rota protegida sem token,
  permissão negada.
- **Arquivos:** `backend/tests/` (novo) — se pytest instalado
- **Concluído quando:** testes passam.

### T5.2 — Verificação final e checklist
- **Descrição:** Rodar build do frontend, validar rotas com curl/postman e atualizar este
  documento com status final.
- **Arquivos:** `PLANO_SEGURANCA.md`
- **Concluído quando:** checklist abaixo 100% marcado.

---

## ✅ CHECKLIST DE EXECUÇÃO

| ID | Atividade | Status |
|----|-----------|--------|
| T1.1 | Tokens de sessão (JWT) | ✅ |
| T1.2 | Dependência de autenticação | ✅ |
| T1.3 | Proteger todas as rotas | ✅ |
| T1.4 | Permissões validadas no servidor | ✅ |
| T1.5 | Rate limiting no login | ✅ |
| T2.1 | Corrigir injeção PostgREST | ✅ |
| T2.2 | Upload seguro de templates | ✅ |
| T2.3 | Validar status de férias | ✅ |
| T2.4 | Mensagens de erro sanitizadas | ✅ |
| T2.5 | Notificações por usuário | ✅ |
| T3.1 | Restringir CORS | ✅ |
| T3.2 | `.env.example` | ✅ |
| T3.3 | Cookies seguros / HTTPS | ✅ |
| T3.4 | RLS no Supabase | ✅ |
| T3.5 | Credenciais padrão / senha forte | ✅ |
| T4.1 | Token no frontend | ✅ |
| T4.2 | Centralizar chamadas API + 401 | ✅ |
| T4.3 | Menu conforme permissões | ✅ |
| T4.4 | Validações no login | ✅ |
| T5.1 | Testes de autenticação | ✅ |
| T5.2 | Verificação final | ✅ |

---

## 🚀 COMEÇANDO AGORA

Recomendação de ordem: **T1.1 → T1.2 → T1.3** primeiro, pois destravam toda a autenticação.

Para iniciar, diga: **"Execute a atividade T1.1"**.

> **Todas as atividades do plano estão concluídas ✅.**

---

## 📝 NOTAS DE IMPLEMENTAÇÃO

- **T3.1 (CORS):** `backend/main.py` agora lê `CORS_ORIGINS` do `.env` (padrão localhost:5173). Origens não listadas são bloqueadas.
- **T3.4 (RLS):** `backend/schema.sql` contém seção RLS com políticas exclusivas para `service_role` e instruções de aplicação. O backend deve usar a **service role key** (nunca expor no frontend).
- **T3.5 (Senha forte):** senha mínima de 8 caracteres; o admin padrão não usa mais `admin123` — a senha é gerada aleatoriamente e exibida **uma vez** no log do servidor; novo endpoint `POST /api/usuarios/trocar-senha` (auto-serviço, exige senha atual) e flag `precisa_trocar_senha` no primeiro acesso. Coluna `precisa_trocar_senha` foi adicionada à tabela `usuarios` no `schema.sql`.
- **T5.1 (Testes):** `backend/tests/` com cliente Supabase fake — 7 testes de autenticação passando (`python -m pytest backend/tests`). Dependências `pytest` e `httpx` adicionadas ao `requirements.txt`.

---
**Última atualização:** 05/08/2026
