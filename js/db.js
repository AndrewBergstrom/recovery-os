// db.js — IndexedDB event store with versioned migrations and all-or-nothing writes.
// A MemoryStore with the same interface is used in tests and as a visible
// fallback when IndexedDB is unavailable (the UI warns that data will not persist).

export const DB_NAME = 'recovery-os';
export const DB_VERSION = 1;

export const STORE_NAMES = ['events', 'orders', 'questions', 'milestones', 'appointments', 'contacts', 'meta'];

export const KEY_PATHS = {
  events: 'id',
  orders: 'key', // `${id}@v${version}` — every order version is kept
  questions: 'id',
  milestones: 'id',
  appointments: 'id',
  contacts: 'id',
  meta: 'key',
};

/** Ordered migrations. Each runs inside the upgrade transaction. */
export const MIGRATIONS = [
  {
    version: 1,
    up(db) {
      const events = db.createObjectStore('events', { keyPath: 'id' });
      events.createIndex('occurred_at', 'occurred_at', { unique: false });
      events.createIndex('event_type', 'event_type', { unique: false });
      for (const name of STORE_NAMES) {
        if (name === 'events') continue;
        db.createObjectStore(name, { keyPath: KEY_PATHS[name] });
      }
    },
  },
];

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function keyOf(store, obj) {
  const k = obj?.[KEY_PATHS[store]];
  if (k === undefined || k === null || k === '') throw new Error(`Object for "${store}" is missing its key "${KEY_PATHS[store]}".`);
  return k;
}

export class MemoryStore {
  constructor() {
    this.kind = 'memory';
    this.maps = Object.fromEntries(STORE_NAMES.map((n) => [n, new Map()]));
  }
  async get(store, key) {
    return clone(this.maps[store].get(key));
  }
  async getAll(store) {
    return [...this.maps[store].values()].map(clone);
  }
  async count(store) {
    return this.maps[store].size;
  }
  async put(store, obj) {
    this.maps[store].set(keyOf(store, obj), clone(obj));
  }
  /** All-or-nothing: every item is validated before any is written. */
  async bulkPut(items) {
    const prepared = items.map(({ store, obj }) => {
      if (!this.maps[store]) throw new Error(`Unknown store "${store}".`);
      return { store, key: keyOf(store, obj), obj: clone(obj) };
    });
    for (const p of prepared) this.maps[p.store].set(p.key, p.obj);
  }
  async delete(store, key) {
    this.maps[store].delete(key);
  }
  async clear(stores = STORE_NAMES) {
    for (const s of stores) this.maps[s].clear();
  }
  close() {}
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

export class IDBStore {
  constructor(db) {
    this.kind = 'indexeddb';
    this.db = db;
  }
  async get(store, key) {
    const tx = this.db.transaction(store, 'readonly');
    return requestToPromise(tx.objectStore(store).get(key));
  }
  async getAll(store) {
    const tx = this.db.transaction(store, 'readonly');
    return requestToPromise(tx.objectStore(store).getAll());
  }
  async count(store) {
    const tx = this.db.transaction(store, 'readonly');
    return requestToPromise(tx.objectStore(store).count());
  }
  async put(store, obj) {
    keyOf(store, obj);
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).put(obj);
    await transactionDone(tx);
  }
  /** One readwrite transaction across every store touched — commits or rolls back as a unit. */
  async bulkPut(items) {
    if (!items.length) return;
    const stores = [...new Set(items.map((i) => i.store))];
    for (const i of items) keyOf(i.store, i.obj);
    const tx = this.db.transaction(stores, 'readwrite');
    for (const { store, obj } of items) tx.objectStore(store).put(obj);
    await transactionDone(tx);
  }
  async delete(store, key) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await transactionDone(tx);
  }
  async clear(stores = STORE_NAMES) {
    const tx = this.db.transaction(stores, 'readwrite');
    for (const s of stores) tx.objectStore(s).clear();
    await transactionDone(tx);
  }
  close() {
    this.db.close();
  }
}

function openDatabase(idb) {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = idb.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion || 0;
      for (const m of MIGRATIONS) if (m.version > oldVersion) m.up(db, req.transaction);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open IndexedDB'));
    req.onblocked = () => reject(new Error('IndexedDB open was blocked by another tab'));
  });
}

/**
 * Open the on-device store. Falls back to a MemoryStore (flagged `volatile`)
 * when IndexedDB is missing or refuses to open, so the UI can say so plainly.
 */
export async function openStore({ indexedDB: idb = typeof indexedDB !== 'undefined' ? indexedDB : null } = {}) {
  if (!idb) {
    const m = new MemoryStore();
    m.volatile = true;
    m.reason = 'IndexedDB is not available in this browser context.';
    return m;
  }
  try {
    const db = await openDatabase(idb);
    db.onversionchange = () => db.close();
    return new IDBStore(db);
  } catch (e) {
    const m = new MemoryStore();
    m.volatile = true;
    m.reason = e?.message || String(e);
    return m;
  }
}

export async function deleteDatabase(idb = typeof indexedDB !== 'undefined' ? indexedDB : null) {
  if (!idb) return;
  await new Promise((resolve, reject) => {
    const req = idb.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}
