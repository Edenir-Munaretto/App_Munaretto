// Camada de armazenamento local (IndexedDB) do Modo Campo.
//
// Stores:
//   - os          : detalhe completo da O.S            (keyPath: os_id)
//   - checklist   : {os_id, itens, resumo}             (keyPath: os_id)
//   - os_lista    : itens do Kanban (resumo da lista)  (keyPath: os_id)
//   - produtos    : catálogo de serviços (lançamento)  (keyPath: id)
//   - fila        : operações aguardando sincronização (keyPath: id_local)
//   - fotos       : evidências tiradas offline (Blob)  (keyPath: id_local)
//   - meta        : metadados (pacote de campo etc.)   (keyPath: chave)

const DB_NAME = 'munaretto-campo';
// Incrementar em CADA mudança de schema (stores/índices). Migrações são por
// bloco no onupgradeneeded (crie o bloco correspondente ao subir a versão).
const DB_VERSION = 3;

const STORES = {
  os: 'os_id',
  checklist: 'os_id',
  os_lista: 'os_id',
  produtos: 'id',
  fila: 'id_local',
  fotos: 'id_local',
  meta: 'chave',
};

let _dbPromise = null;

function abrirDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Este navegador não suporta armazenamento offline (IndexedDB).'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const versaoAnterior = e.oldVersion;
      // v2 -> v3: sem mudança estrutural (próximas migrações entram aqui,
      // ex.: if (versaoAnterior < 4) { ... }).
      void versaoAnterior;
      for (const [store, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath });
        }
      }
    };
    // Outra aba segurando a versão antiga impede o upgrade: avisa e permite
    // nova tentativa na próxima chamada (a promise rejeitada é descartada).
    req.onblocked = () => {
      _dbPromise = null;
      reject(new Error('Outra aba está com o armazenamento offline aberto. Feche-a e recarregue.'));
    };
    req.onsuccess = () => {
      const db = req.result;
      // Outra aba abriu uma versão NOVA: fecha esta conexão e recarrega.
      db.onversionchange = () => {
        db.close();
        window.location.reload();
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function operar(store, modo, fn) {
  return abrirDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, modo);
        const st = tx.objectStore(store);
        const req = fn(st);
        tx.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export function dbPut(store, valor) {
  return operar(store, 'readwrite', (st) => st.put(valor));
}

export function dbGet(store, chave) {
  return operar(store, 'readonly', (st) => st.get(chave));
}

export function dbGetAll(store) {
  return operar(store, 'readonly', (st) => st.getAll());
}

export function dbDel(store, chave) {
  return operar(store, 'readwrite', (st) => st.delete(chave));
}

export function dbClearStore(store) {
  return operar(store, 'readwrite', (st) => st.clear());
}

export function dbCount(store) {
  return operar(store, 'readonly', (st) => st.count());
}

export async function limparTudoLocal() {
  for (const store of Object.keys(STORES)) {
    try {
      await dbClearStore(store);
    } catch {
      /* segue */
    }
  }
}
