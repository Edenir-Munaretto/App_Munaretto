import os
import tempfile
import unittest
from datetime import datetime, timedelta

import database

class DatabaseVacationTests(unittest.TestCase):
    def setUp(self):
        # Cria um banco temporário
        fd, path = tempfile.mkstemp(prefix="test_clientes_", suffix=".db")
        os.close(fd)
        self.db_path = path
        database.DATABASE_FILE = self.db_path
        database.inicializar_banco()

    def tearDown(self):
        try:
            os.remove(self.db_path)
        except Exception:
            pass

    def test_add_client_and_vacation(self):
        cid = database.adicionar_cliente('Unit Test', '99988877766', 'Addr 1')
        self.assertIsNotNone(cid)

        # Agendar férias
        inicio = datetime.now().strftime('%Y-%m-%d')
        ok, msg = database.adicionar_ferias('Unit Test', inicio, 0, '')
        self.assertTrue(ok, msg)

    def test_vacation_conflict(self):
        cid = database.adicionar_cliente('Conf Test', '11122233300', 'Addr 2')
        inicio = datetime.now().strftime('%Y-%m-%d')
        ok, msg = database.adicionar_ferias('Conf Test', inicio, 0, '')
        self.assertTrue(ok)

        # Tentar agendar conflito
        ok2, msg2 = database.adicionar_ferias('Conf Test', inicio, 0, '')
        self.assertFalse(ok2)

if __name__ == '__main__':
    unittest.main()
