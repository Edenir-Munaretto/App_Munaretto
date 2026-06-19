# Guia de Implantação: App Munaretto Web

Este guia descreve o passo a passo para colocar a versão Web do **App Munaretto** em produção na nuvem, utilizando serviços com camadas gratuitas: **Supabase** (Banco de Dados e Autenticação), **Render** ou **Railway** (Servidor FastAPI) e **Vercel** ou **Netlify** (Interface React).

---

## 💾 Passo 1: Configuração do Supabase (Banco de Dados)

1. Crie uma conta gratuita em [supabase.com](https://supabase.com/).
2. Crie um novo projeto (ex: `App-Munaretto`). Defina uma senha forte para o banco de dados.
3. No painel do projeto, vá em **SQL Editor** -> **New Query**.
4. Abra o arquivo [backend/schema.sql](file:///c:/Users/User/Desktop/App_Munaretto/backend/schema.sql), copie todo o seu conteúdo, cole no SQL Editor do Supabase e clique em **Run**.
   * *Isso criará todas as tabelas e os gatilhos (triggers) de data.*

---

## 🚀 Passo 2: Migração dos Dados Locais (Clientes e Históricos)

Para transferir todos os dados que você já cadastrou no aplicativo desktop para a nuvem:

1. No terminal do seu computador atual, na pasta do projeto, execute o script:
   ```bash
   python migrar_para_supabase.py
   ```
2. O script lerá o banco local e gerará o arquivo `dump_para_supabase.sql` na raiz do projeto.
3. Abra esse arquivo gerado, copie o conteúdo.
4. Volte ao **SQL Editor** do Supabase, crie uma **New Query**, cole o script de dump e clique em **Run**.
   * *Pronto! Todos os seus 27 clientes, históricos de documentos e fluxos de caixa já estarão salvos na nuvem.*

---

## ⚡ Passo 3: Hospedagem do Backend (FastAPI)

Você pode hospedar o backend no **Render** ou **Railway**. A seguir, mostramos a configuração para o **Render**:

1. Crie uma conta em [render.com](https://render.com/).
2. Crie um novo **Web Service** e conecte o seu repositório Git.
3. Configure os detalhes do build:
   * **Runtime:** `Python 3`
   * **Build Command:** `pip install -r backend/requirements.txt`
   * **Start Command:** `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
4. Na aba **Environment**, adicione as seguintes variáveis de ambiente obtidas no painel do seu Supabase (em **Project Settings** -> **API**):
   * `SUPABASE_URL`: A URL do seu projeto Supabase.
   * `SUPABASE_KEY`: A chave da API `anon` ou `service_role`.
5. Se for utilizar conversão automática de Word para PDF via LibreOffice no servidor Linux, utilize o arquivo `Dockerfile` na pasta do backend para criar o container com o LibreOffice pré-instalado.
6. Copie a URL gerada pelo Render (ex: `https://app-munaretto-backend.onrender.com`).

---

## 🖥️ Passo 4: Hospedagem do Frontend (Vite + React)

A melhor opção para hospedar a interface React é a **Vercel**:

1. Crie uma conta gratuita em [vercel.com](https://vercel.com/).
2. Clique em **Add New** -> **Project** e conecte o seu repositório Git.
3. Selecione a subpasta `frontend` como raiz do projeto (Root Directory).
4. O framework será detectado automaticamente como **Vite**.
5. Em **Environment Variables**, adicione a variável de ambiente:
   * `VITE_API_URL`: A URL completa do seu backend hospedado no Passo 3 com o sufixo `/api` (ex: `https://app-munaretto-backend.onrender.com/api`).
6. Clique em **Deploy**.
7. A Vercel fornecerá um endereço seguro (HTTPS) para você acessar o sistema de qualquer dispositivo (computador, celular ou tablet).
