# 🚀 GUIA RÁPIDO - App Munaretto

## Iniciar o Programa
```bash
python main.py
```

## Menu Principal
```
1. Cadastrar cliente      → Adicione um novo cliente
2. Listar clientes        → Visualize todos os clientes
3. Editar cliente         → Modifique dados existentes
4. Deletar cliente        → Remove um cliente
5. Gerar documento        → Crie contrato/declaração/recibo/proposta
6. Histórico              → Veja documentos já gerados
7. Google Drive           → Sincronize com nuvem
8. Sair                   → Encerra o programa
```

## Fluxo Básico
1. **Cadastre um cliente** (opção 1)
   - Nome, CPF/CNPJ, Endereço, Telefone, Email

2. **Gere um documento** (opção 5)
   - Escolha o cliente
   - Escolha o tipo de documento
   - Escolha o formato (HTML, Word, Excel ou TXT)
   - Para HTML: opção de abrir no navegador

3. **Confira o histórico** (opção 6)
   - Veja todos os documentos gerados do cliente

## Formatos de Saída

| Formato | Extensão | Uso |
|---------|----------|-----|
| HTML | .html | Visualização no navegador + impressão |
| Word | .docx | Edição profissional em MS Word |
| PDF | .pdf | Portável, seguro, pronto para compartilhar |
| Texto | .txt | Simples, portável |

## Tipos de Documentos

| Tipo | Uso |
|------|-----|
| Contrato | Prestação de serviços profissional |
| Declaração | Declaração formal de dados |
| Recibo | Comprovante de pagamento |
| Proposta | Cotação comercial |

## Arquivos Gerados

- **clientes.db** → Banco de dados (criado automaticamente)
- **documentos_gerados/** → Documentos criados
- **backups/** → Cópias em JSON
- **token.pickle** → Autenticação Google (se configurado)

## Google Drive (Opcional)

1. Crie credenciais em https://console.cloud.google.com/
2. Baixe como JSON
3. Renomeie para `credentials.json`
4. Cole na pasta do projeto
5. Use opção 7 para sincronizar

## Dicas

✅ **Imprimir documento**
- Gere em HTML
- Abra no navegador
- Clique "Imprimir" ou Ctrl+P

✅ **Editar documento gerado**
- Gere em Word (.docx)
- Abra em MS Word ou LibreOffice
- Faça alterações

✅ **Visualizar dados do cliente**
- Opção 2 lista todos
- Opção 3 permite editar
- Opção 4 pode deletar

✅ **Recuperar dados**
- Opção 7 faz backup automático
- Arquivo em JSON pode ser compartilhado

## Troubleshooting

❌ "Cliente com CPF já existe"
- Verifique CPF digitado
- Ou edite cliente existente (opção 3)

❌ "Word/Excel não gerado"
- Instale: `pip install python-docx openpyxl`
- Tente novamente

❌ "Não consegue abrir no navegador"
- Arquivo foi gerado em `documentos_gerados/`
- Abra manualmente no navegador

❌ "Google Drive não funciona"
- Verifique arquivo `credentials.json`
- Faça novo login quando solicitado
- Arquivo `token.pickle` será criado

## Dados de Teste (Já Criados)

Execute uma vez:
```bash
python test_demo.py
```

Cria 3 clientes de teste e gera documentos em todos os formatos.

---

📞 **Suporte**: Verifique README.md para mais informações
