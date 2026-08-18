# Plano de Melhorias — App Munaretto

> Análise completa do backend (FastAPI + Supabase) e frontend (React + Vite).
> Organizado por **prioridade de impacto** × **esforço de implementação**.

---

## 🔴 Prioridade 1 — Performance (Alto impacto, baixo risco)

### 1.1 — Comprovantes.jsx: filtros 100% no frontend sem memoização
**Arquivo:** [`Comprovantes.jsx`](file:///c:/Users/User/Desktop/App_Munaretto/frontend/src/pages/Comprovantes.jsx)

| | Atual | Proposto |
|---|---|---|
| Filtro | `recebimentos.filter()` sem `useMemo` sobre 1.165 linhas de componente | `useMemo` com dependências corretas |
| Busca por data | Só no frontend, sem passar para a API | Parâmetros `data_inicio` / `data_fim` no backend |
| Tipo | Filtrado localmente | Query param `tipo_documento` no backend |

**Solução:** Mesmo padrão aplicado em `Recebimentos.jsx` — `useMemo` + query params no `GET /comprovantes/`.

---

### 1.2 — Dashboard: busca sem cache, rodando a cada render
**Arquivo:** [`Dashboard.jsx`](file:///c:/Users/User/Desktop/App_Munaretto/frontend/src/pages/Dashboard.jsx) + [`dashboard.py`](file:///c:/Users/User/Desktop/App_Munaretto/backend/routers/dashboard.py)

O endpoint `/api/dashboard/resumo` faz **4 queries ao Supabase** a cada chamada, sem nenhum cache. No `App.jsx`, `atualizarUsuarioAtual` é chamado a cada `window.focus` — o que pode causar chamadas extras ao backend.

**Solução:** Adicionar cache em memória simples no backend (TTL de 60 segundos) para o endpoint `/dashboard/resumo`, usando `functools.lru_cache` com invalidação por tempo.

---

### 1.3 — App.jsx: polling e eventos desnecessários em cada foco de janela
**Arquivo:** [`App.jsx`](file:///c:/Users/User/Desktop/App_Munaretto/frontend/src/App.jsx#L288-L298)

O `window.focus` dispara `atualizarUsuarioAtual` e `fetchAlerts` a cada troca de aba — mesmo que o usuário tenha acabado de usar o sistema.

```js
// Atual: dispara em qualquer focus
window.addEventListener('focus', onFocus);
```

**Solução:** Debounce de 30 segundos para não disparar se a última atualização foi recente.

---

### 1.4 — Clientes.py: busca com N queries (uma por coluna)
**Arquivo:** [`clientes.py`](file:///c:/Users/User/Desktop/App_Munaretto/backend/routers/clientes.py#L35-L48)

```python
# Atual: 2 queries separadas + merge em Python
for coluna in ("nome", "cpf_cnpj"):
    resposta = base().ilike(coluna, f"%{busca}%").execute()
```

**Solução:** Usar `or_()` do Supabase para buscar nas duas colunas em uma única query.

---

### 1.5 — SST.py e Ferias.py: funções helper duplicadas entre módulos
**Arquivos:** [`sst.py`](file:///c:/Users/User/Desktop/App_Munaretto/backend/routers/sst.py), [`dashboard.py`](file:///c:/Users/User/Desktop/App_Munaretto/backend/routers/dashboard.py), [`ferias.py`](file:///c:/Users/User/Desktop/App_Munaretto/backend/routers/ferias.py)

As funções `_hoje()`, `_parse_data()`, `_status_vencimento()` estão **copiadas em 3 arquivos diferentes**.

**Solução:** Criar `utils/date_helpers.py` com as funções compartilhadas e importá-las nos routers.

---

## 🟡 Prioridade 2 — Qualidade de Código (Manutenibilidade)

### 2.1 — Falta paginação em todos os endpoints de listagem
**Arquivos:** Todos os routers (`GET /`)

Nenhum endpoint tem `limit` / `offset` — quando a tabela crescer (centenas de registros), todas as listas vão degradar significativamente.

**Solução:** Adicionar parâmetros opcionais `limit: int = 100` e `offset: int = 0` nos endpoints críticos: `/comprovantes/`, `/recebimentos/`, `/funcionarios/`, `/ferias/`.

---

### 2.2 — Ausência de testes automatizados nos routers críticos
**Arquivo:** [`tests/`](file:///c:/Users/User/Desktop/App_Munaretto/backend/tests/)

O `requirements.txt` já inclui `pytest` e `httpx`, mas a estrutura de testes está vazia ou incompleta.

**Solução:** Criar testes de integração para os fluxos críticos: login, permissões, CRUD de recebimentos e fluxo de caixa, usando `TestClient` do FastAPI + mock do Supabase.

---

### 2.3 — Validação de e-mail sem formato no Pydantic
**Arquivo:** [`usuarios.py`](file:///c:/Users/User/Desktop/App_Munaretto/backend/routers/usuarios.py#L44-L56)

```python
email: str = Field(..., description="E-mail de acesso")  # sem validação de formato
```

**Solução:** Usar `pydantic.EmailStr` (requer `email-validator` no `requirements.txt`).

---

### 2.4 — `Sst.jsx` com 120 KB — componente monolítico
**Arquivo:** [`Sst.jsx`](file:///c:/Users/User/Desktop/App_Munaretto/frontend/src/pages/Sst.jsx) (120.252 bytes, maior do projeto)

Um único componente com todo o SST (treinamentos, ASO, EPIs, cargos, alertas) dificulta manutenção e causa re-renders desnecessários.

**Solução:** Separar em sub-componentes: `SstTreinamentos`, `SstAso`, `SstEpi`, `SstCargos` — cada um com seu próprio estado e fetch.

---

### 2.5 — `Comprovantes.jsx` com 1.165 linhas sem useMemo
**Arquivo:** [`Comprovantes.jsx`](file:///c:/Users/User/Desktop/App_Munaretto/frontend/src/pages/Comprovantes.jsx)

O filtro por data, tipo e busca são calculados a cada render sem memoização. O componente de preview de importação também está inline.

**Solução:** Adicionar `useMemo` nos filtros e extrair o modal/formulário de importação como componente separado.

---

### 2.6 — Falta de loading state granular nas páginas
**Arquivos:** Vários JSX

Todos os módulos usam um único `loading` booleano. Se houver erro parcial (ex: clientes carregou, mas recebimentos falhou), a UI não reflete.

**Solução:** Usar um estado estruturado `{ status: 'idle' | 'loading' | 'success' | 'error', error: null }` por recurso.

---

### 2.7 — `LoginRateLimiter` em memória — não persiste entre instâncias
**Arquivo:** [`auth.py`](file:///c:/Users/User/Desktop/App_Munaretto/backend/auth.py#L132-L162)

O rate limiter está em memória Python. Se o servidor reiniciar (comum no Render free tier) ou se houver múltiplas instâncias, o estado se perde.

**Solução:** Persitir contadores no Supabase com TTL, ou usar Redis (se disponível). Alternativa simples: adicionar tabela `login_tentativas` no Supabase.

---

## 🟢 Prioridade 3 — UX / Interface

### 3.1 — Sem feedback de "salvando..." nos formulários
**Arquivos:** `Recebimentos.jsx`, `Clientes.jsx`, `FluxoCaixa.jsx`, etc.

O botão de submit não desabilita durante o envio — o usuário pode clicar várias vezes e criar duplicatas.

**Solução:** Adicionar estado `submitting` e desabilitar o botão + mostrar spinner durante o `await apiFetch(...)`.

---

### 3.2 — Confirmação de exclusão via `window.confirm()` nativo
**Arquivos:** Todos os módulos com exclusão

O `window.confirm()` bloqueia a thread principal e tem aparência muito diferente da UI da aplicação.

**Solução:** Criar um componente `<ModalConfirmacao>` reutilizável com estilo consistente ao design system.

---

### 3.3 — Sem indicador visual de "sessão expirando em breve"
**Arquivo:** [`auth.py`](file:///c:/Users/User/Desktop/App_Munaretto/backend/auth.py#L34) + [`App.jsx`](file:///c:/Users/User/Desktop/App_Munaretto/frontend/src/App.jsx)

O token JWT expira em 480 minutos (8h). Quando expira, o usuário perde o que estava fazendo. Não há aviso prévio.

**Solução:** No frontend, decodificar o JWT no localStorage, calcular o tempo restante e exibir um banner de aviso 10 minutos antes da expiração com botão "Renovar sessão".

---

### 3.4 — Módulo de Comprovantes sem exportação CSV/Excel
**Arquivo:** [`Comprovantes.jsx`](file:///c:/Users/User/Desktop/App_Munaretto/frontend/src/pages/Comprovantes.jsx)

O backend já tem lógica de importação de XLSX mas não tem exportação. O usuário não consegue extrair os dados filtrados.

**Solução:** Adicionar endpoint `GET /comprovantes/exportar?...` que retorna XLSX com os filtros aplicados, aproveitando o `openpyxl` já instalado.

---

### 3.5 — Sem paginação visual nas tabelas grandes
**Arquivos:** `Comprovantes.jsx`, `Sst.jsx`, `Recebimentos.jsx`

Todas as tabelas renderizam todos os registros de uma vez no DOM. Com centenas de linhas, o scroll fica pesado.

**Solução:** Implementar paginação simples no frontend (ex: 50 registros por página com controles Anterior/Próximo) ou virtualização com `react-window`.

---

## 🔵 Prioridade 4 — Segurança

### 4.1 — Refresh Token não implementado
**Arquivo:** [`auth.py`](file:///c:/Users/User/Desktop/App_Munaretto/backend/auth.py), [`api.js`](file:///c:/Users/User/Desktop/App_Munaretto/frontend/src/api.js)

Não existe refresh token — quando o access token expira, o usuário é deslogado abruptamente.

**Solução:** Implementar endpoint `POST /api/usuarios/refresh` que valida o token próximo do vencimento e emite um novo, chamado automaticamente pelo frontend antes da expiração.

---

### 4.2 — Ausência de logging estruturado com nível de severidade
**Arquivo:** Todos os routers

O `logger.exception()` existe, mas não há configuração centralizada de nível, formato ou destino (arquivo, serviço externo).

**Solução:** Configurar logging centralizado em `main.py` com `logging.basicConfig` (JSON format para produção, texto para dev), controlado por variável de ambiente `LOG_LEVEL`.

---

### 4.3 — Senha com hash PBKDF2 de 100.000 iterações — adequado, mas sem upgrade path
**Arquivo:** [`usuarios.py`](file:///c:/Users/User/Desktop/App_Munaretto/backend/routers/usuarios.py#L23-L38)

O algoritmo atual é bom, mas não há mecanismo para migrar para bcrypt/argon2 no futuro sem forçar reset de senhas.

**Solução:** Armazenar o algoritmo no prefixo do hash (`pbkdf2$salt$hash`) para permitir migração transparente.

---

## ⚙️ Prioridade 5 — Infraestrutura / DevOps

### 5.1 — `requirements.txt` sem versões fixas nos pacotes críticos
**Arquivo:** [`requirements.txt`](file:///c:/Users/User/Desktop/App_Munaretto/backend/requirements.txt)

`fastapi>=0.100.0` e `supabase>=1.0.0` permitem atualizações que podem quebrar a API silenciosamente.

**Solução:** Gerar `requirements-lock.txt` com `pip freeze` e usar versões exatas nos pacotes críticos. Idealmente usar `uv` ou `pip-compile`.

---

### 5.2 — Sem variável de ambiente para controle de ambiente (dev/prod)
**Arquivo:** [`main.py`](file:///c:/Users/User/Desktop/App_Munaretto/backend/main.py), [`supabase_client.py`](file:///c:/Users/User/Desktop/App_Munaretto/backend/supabase_client.py)

Não existe distinção entre ambiente de desenvolvimento e produção. O Swagger UI fica exposto em produção.

**Solução:** Adicionar variável `APP_ENV=production|development`. Em produção, desabilitar `/docs` e `/redoc`:
```python
app = FastAPI(docs_url=None if ENV == "production" else "/docs")
```

---

### 5.3 — Supabase Client singleton sem reconexão automática
**Arquivo:** [`supabase_client.py`](file:///c:/Users/User/Desktop/App_Munaretto/backend/supabase_client.py)

O cliente é criado uma vez na inicialização. Se a conexão cair (timeout, reinício), não há retry automático.

**Solução:** Usar o padrão de `Depends` já implementado, mas adicionar try/except com retry exponencial nas operações críticas de banco.

---

## 📊 Resumo por Prioridade

| Prioridade | Itens | Esforço estimado | Impacto |
|---|---|---|---|
| 🔴 Performance | 5 itens | 2–4 horas | Imediato e visível |
| 🟡 Qualidade | 7 itens | 1–2 dias | Manutenibilidade longo prazo |
| 🟢 UX/Interface | 5 itens | 1 dia | Experiência do usuário |
| 🔵 Segurança | 3 itens | 4–8 horas | Resiliência e segurança |
| ⚙️ Infraestrutura | 3 itens | 2–4 horas | Estabilidade em produção |

> [!IMPORTANT]
> Aguardo sua aprovação para iniciar as implementações. Pode indicar quais grupos ou itens específicos deseja priorizar.
