// Remembers which data folder was used last, so the app can reopen it.
// What is kept in the browser is only a handle (a pointer) to the folder,
// never any of its contents.

const DB_NAME = 'flashcards-app';
const STORE_NAME = 'handles';
const KEY = 'data-folder';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(mode, action) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

// `key` is only ever changed by the tests, so that they leave the real entry alone.

export async function rememberFolder(handle, key = KEY) {
  try {
    await run('readwrite', (handles) => handles.put(handle, key));
  } catch {
    // Not remembered: the user picks the folder again next time.
  }
}

/** The folder handle used last, or null. */
export async function recallFolder(key = KEY) {
  try {
    return (await run('readonly', (handles) => handles.get(key))) ?? null;
  } catch {
    return null;
  }
}

export async function forgetFolder(key = KEY) {
  try {
    await run('readwrite', (handles) => handles.delete(key));
  } catch {
    // Nothing to forget.
  }
}
