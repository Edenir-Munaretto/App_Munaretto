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
const DB_VERSION = 2;

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
      for (const [store, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
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
