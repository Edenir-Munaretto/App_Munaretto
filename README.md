# 📄 Gerenciador de Contratos - App Munaretto

Um programa completo em Python para gerenciar contratos, declarações e documentos comerciais de forma simples e profissional.

## ✨ Funcionalidades

- ✅ **Cadastro de Clientes**: Armazene dados de clientes em banco de dados SQLite
- ✅ **Múltiplos Templates**: Contrato, Declaração, Recibo, Proposta Comercial
- ✅ **Geração de Documentos**: Exporte em Word (.docx) e PDF (.pdf)
- ✅ **Histórico**: Rastreie todos os documentos gerados por cliente
- ✅ **Google Drive**: Sincronize backups com Google Drive automaticamente
- ✅ **Backup JSON**: Exportação automática dos dados

## 🚀 Instalação

### Pré-requisitos
- Python 3.7 ou superior
- pip (gerenciador de pacotes Python)

### Passos

1. **Clone ou baixe o projeto**
   ```bash
   cd App_Munaretto
   ```

2. **Instale as dependências**
   ```bash
   pip install -r requirements.txt
   ```

3. **(Opcional) Configure Google Drive**
   - Vá para [Google Cloud Console](https://console.cloud.google.com/)
   - Crie um projeto e ative a API do Google Drive
   - Faça download de `credentials.json` (tipo: OAuth 2.0 Client ID - Aplicação desktop)
   - Coloque o arquivo `credentials.json` na pasta do projeto

## 💻 Como Usar

### Executar o programa

```bash
python main.py
```

### Menu Principal

```
1. Cadastrar cliente        - Adicionar novo cliente
2. Listar clientes          - Visualizar todos os clientes
3. Editar cliente           - Modificar dados de um cliente
4. Deletar cliente          - Remover um cliente
5. Gerar documento          - Criar documento com dados do cliente
6. Histórico de documentos  - Ver documentos gerados
7. Backup no Google Drive   - Sincronizar com Google Drive
8. Sair                     - Encerrar o programa
```

## 📋 Tipos de Documentos Disponíveis

1. **Contrato de Prestação de Serviços**
   - Documento padrão para contratos comerciais
   - Campos: valor, prazo, local de prestação

2. **Declaração**
   - Modelo de declaração formal
   - Personalizável conforme necessidade

3. **Recibo**
   - Comprovante de pagamento
   - Campos para valor e motivo

4. **Proposta Comercial**
   - Documento para propostas de venda
   - Inclui prazos e condições de pagamento

## 📤 Formatos de Saída

- **Word (.docx)**: Arquivo editável no Microsoft Word
- **PDF (.pdf)**: Portável, seguro e pronto para compartilhar

## 💾 Armazenamento de Dados

### Banco de Dados Local
- **clientes.db**: Banco SQLite com dados dos clientes
- **documentos_gerados/**: Pasta com documentos gerados
- **backups/**: Pasta com backups em JSON

### Google Drive (Opcional)
- Sincronize backups com Google Drive
- Crie pasta "App_Munaretto_Backups" automaticamente
- Faça download de backups sempre que necessário

## 🔐 Segurança

- Dados salvos localmente em SQLite
- Backup em JSON para portabilidade
- Autenticação OAuth 2.0 para Google Drive
- Soft delete: clientes deletados são marcados como inativos

## 📝 Personalizando Documentos

Para editar os templates de documentos, abra `documents.py` e modifique o dicionário `TEMPLATES`:

```python
TEMPLATES = {
    "seu_documento": {
        "nome": "Nome do Documento",
        "template": """Seu template aqui com placeholders como {nome}, {cpf_cnpj}, etc."""
    }
}
```

## 🆘 Solução de Problemas

### Erro: "credentials.json não encontrado"
- Baixe suas credenciais do Google Cloud Console
- Coloque o arquivo na pasta do projeto

### Erro: "python-docx não está instalado"
```bash
pip install python-docx
```

### Erro: "openpyxl não está instalado"
```bash
pip install openpyxl
```

### Documentos não abrem no navegador
- Verifique se o arquivo HTML foi criado em `documentos_gerados/`
- Teste com um navegador diferente

## 📄 Estrutura de Arquivos

```
App_Munaretto/
├── main.py                    # Arquivo principal
├── menu.py                    # Interface de menu
├── database.py                # Gerenciamento de banco de dados
├── documents.py               # Geração de documentos
├── google_drive.py            # Integração com Google Drive
├── requirements.txt           # Dependências do projeto
├── clientes.db               # Banco de dados (criado automaticamente)
├── token.pickle              # Token Google Drive (criado após login)
├── credentials.json          # Credenciais Google (coloque manualmente)
├── documentos_gerados/       # Documentos gerados (criado automaticamente)
└── backups/                  # Backups em JSON (criado automaticamente)
```

## 🎯 Próximas Funcionalidades

- [ ] Interface gráfica (Tkinter/PyQt)
- [ ] Modelos de documentos customizáveis
- [ ] Assinatura digital de documentos
- [ ] Envio de documentos por e-mail
- [ ] Integração com OneDrive/Dropbox
- [ ] Relatórios de clientes

## 📧 Suporte

Para problemas ou sugestões, abra uma issue no repositório.

## 📜 Licença

Este projeto é de código aberto e está disponível sob a licença MIT.

---

**Desenvolvido com ❤️ para gerenciamento simples de contratos**
