from datetime import datetime
import database

print('Inicializando banco...')
database.inicializar_banco()
print('Adicionando cliente...')
cliente_id = database.adicionar_cliente('Teste Unit', '11122233344', 'Rua Teste, 1')
print('cliente_id =', cliente_id)
print('Agendando ferias...')
sucesso, msg = database.adicionar_ferias('Teste Unit', datetime.now().strftime('%Y-%m-%d'), 5, '')
print('resultado:', sucesso, msg)
