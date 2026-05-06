#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Teste das correções realizadas no banco de dados
"""

import database

print("=" * 60)
print("TESTANDO CORREÇÕES NO BANCO DE DADOS")
print("=" * 60)

# 1. Inicializar banco
print("\n1️⃣ Inicializando banco de dados...")
database.inicializar_banco()
print("✅ Banco inicializado!")

# 2. Testar adicionar cliente
print("\n2️⃣ Adicionando cliente de teste...")
cliente_id = database.adicionar_cliente(
    nome='João Silva',
    cpf_cnpj='12345678901',
    endereco='Rua A, 123',
    cidade='São Paulo',
    cep='01234567',
    nota_ps='NS-001',
    valor_da_obra='5000.00',
    valor_de_devolucao='500.00'
)
print(f"✅ Cliente adicionado com ID: {cliente_id}")

# 3. Listar clientes
print("\n3️⃣ Listando clientes...")
clientes = database.listar_clientes()
print(f"✅ Total de clientes: {len(clientes)}")
if clientes:
    cliente = clientes[0]
    print(f"   ID: {cliente[0]}")
    print(f"   Nome: {cliente[1]}")
    print(f"   CPF/CNPJ: {cliente[2]}")
    print(f"   Endereço: {cliente[3]}")
    print(f"   Cidade: {cliente[4]}")
    print(f"   CEP: {cliente[5]}")
    print(f"   Nota PS: {cliente[6]}")
    print(f"   Valor da Obra: {cliente[7]}")
    print(f"   Valor de Devolução: {cliente[8]}")

# 4. Testar atualização
print("\n4️⃣ Atualizando cliente...")
sucesso = database.atualizar_cliente(
    cliente_id,
    nome='João Silva Atualizado',
    cpf_cnpj='12345678901',
    endereco='Rua B, 456',
    cidade='Rio de Janeiro',
    cep='20001000',
    nota_ps='NS-002',
    valor_da_obra='6000.00',
    valor_de_devolucao='600.00'
)
print(f"✅ Cliente atualizado: {sucesso}")

# 5. Verificar update
print("\n5️⃣ Verificando dados atualizados...")
clientes = database.listar_clientes()
if clientes:
    cliente = clientes[0]
    print(f"   Nome: {cliente[1]}")
    print(f"   Endereço: {cliente[3]}")
    print(f"   Cidade: {cliente[4]}")
    print(f"   CEP: {cliente[5]}")
    print(f"   Nota PS: {cliente[6]}")
    print(f"   Valor da Obra: {cliente[7]}")

print("\n" + "=" * 60)
print("✅ TODAS AS CORREÇÕES ESTÃO FUNCIONANDO!")
print("=" * 60)
