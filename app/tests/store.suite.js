// Tests of saving: every change reaches the data file, and a change made by
// something else is detected instead of being overwritten.

import { describe, test, assert } from './harness.js';
import { listNames, readText, writeText } from './memfs.js';
import { addDeck, addNote, parseCollection, serializeCollection } from '../js/core/collection.js';
import { BACKUPS_DIR, DATA_FILE } from '../js/storage/folder.js';
import { BusyError, NoDataError, Store } from '../js/store.js';

const NOW = new Date(2026, 9, 1, 10, 0);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const deckNames = (col) => [...col.decks.values()].map((d) => d.name);
const onDisk = async (dir) => parseCollection(await readText(dir, DATA_FILE));

async function openNew(makeFolder) {
  const dir = await makeFolder();
  const store = new Store();
  await store.open(dir, { create: true, now: NOW });
  return { dir, store };
}

/** Change the data file the way another program or another PC would. */
async function changeElsewhere(dir, mutate) {
  const col = await onDisk(dir);
  mutate(col);
  await pause(15);
  await writeText(dir, DATA_FILE, serializeCollection(col));
}

/**
 * The same folder, except that writing the data file fails the first `failures`
 * times, as it does while another program has the file open.
 */
function flaky(dir, failures, errorName = 'NoModificationAllowedError') {
  const state = { left: failures, attempts: 0 };
  const bind = (target, prop) => {
    const value = target[prop];
    return typeof value === 'function' ? value.bind(target) : value;
  };
  const folder = new Proxy(dir, {
    get(target, prop) {
      if (prop !== 'getFileHandle') return bind(target, prop);
      return async (name, options) => {
        const handle = await target.getFileHandle(name, options);
        if (name !== DATA_FILE) return handle;
        return new Proxy(handle, {
          get(file, key) {
            if (key !== 'createWritable') return bind(file, key);
            return async (...args) => {
              state.attempts++;
              if (state.left > 0) {
                state.left--;
                throw new DOMException('The file is in use.', errorName);
              }
              return file.createWritable(...args);
            };
          },
        });
      };
    },
  });
  return { folder, state };
}

/**
 * The same folder, with two points where the test can hold things up:
 * `first` delays the first look at the data file, and `stamp` delays a save
 * between writing the file and reading back its new stamp.
 */
function gated(dir) {
  const gate = () => {
    let open;
    const promise = new Promise((resolve) => { open = resolve; });
    return { promise, open };
  };
  const first = gate();
  const stamp = gate();
  let looks = 0;
  const bind = (target, prop) => {
    const value = target[prop];
    return typeof value === 'function' ? value.bind(target) : value;
  };
  const folder = new Proxy(dir, {
    get(target, prop) {
      if (prop !== 'getFileHandle') return bind(target, prop);
      return async (name, options) => {
        const handle = await target.getFileHandle(name, options);
        if (name !== DATA_FILE) return handle;
        if (!options?.create) {
          if (looks++ === 0) await first.promise;
          return handle;
        }
        return new Proxy(handle, {
          get(file, key) {
            if (key !== 'getFile') return bind(file, key);
            return async () => {
              await stamp.promise;
              return file.getFile();
            };
          },
        });
      };
    },
  });
  return { folder, first, stamp };
}

export function defineStoreTests(label, makeFolder) {
  describe(`Saving (${label}): opening`, () => {
    test('a folder without data is refused unless a new collection is asked for', async () => {
      const dir = await makeFolder();
      const store = new Store();
      await assert.rejects(store.open(dir), /no flashcard data/);
      assert.equal(store.isOpen, false);
      assert.deepEqual(await listNames(dir), []);
    });

    test('creating writes the data file and the first backup', async () => {
      const { dir, store } = await openNew(makeFolder);
      assert.equal(store.isOpen, true);
      assert.equal(store.status, 'saved');
      assert.deepEqual(await listNames(dir), [BACKUPS_DIR, DATA_FILE]);
      assert.equal((await onDisk(dir)).id, store.col.id);
      assert.equal(store.backupCount, 1);
      assert.equal(store.lastBackup.name, 'data-2026-10-01_10-00-00.json');
    });

    test('reopening reads what was saved', async () => {
      const { dir, store } = await openNew(makeFolder);
      const deck = store.change((col) => addDeck(col, 'Statistics', NOW));
      store.change((col) => addNote(col, deck.id, { front: 'q', back: 'a', reversed: true }, NOW));
      await store.close();
      assert.equal(store.isOpen, false);

      const again = new Store();
      await again.open(dir, { now: NOW });
      assert.deepEqual(deckNames(again.col), ['Statistics']);
      assert.equal(again.col.cards.size, 2);
      assert.equal(again.col.id, store.col?.id ?? again.col.id);
    });

    test('a damaged data file is refused and left as it is', async () => {
      const dir = await makeFolder();
      await writeText(dir, DATA_FILE, '{"format": "simple-flashcards", "version": 1, "decks": [');
      const store = new Store();
      await assert.rejects(store.open(dir, { create: true, now: NOW }), /not valid JSON/);
      assert.equal(store.isOpen, false);
      assert.equal(await readText(dir, DATA_FILE), '{"format": "simple-flashcards", "version": 1, "decks": [');
      assert.deepEqual(await listNames(dir), [DATA_FILE], 'a damaged file is not backed up');
    });

    test('data already open in another window is refused', async () => {
      const { dir, store } = await openNew(makeFolder);
      const taken = new Set();
      const lock = async (id) => (taken.has(id) ? null : (taken.add(id), () => taken.delete(id)));
      const first = new Store();
      await store.close();
      await first.open(dir, { lock, now: NOW });
      const second = new Store();
      await assert.rejects(second.open(dir, { lock, now: NOW }), /already open/);
      assert.ok(second.isOpen === false);
      await first.close();
      await second.open(dir, { lock, now: NOW });
      assert.equal(second.isOpen, true);
      await second.close();
    });

    test('the error types can be told apart', async () => {
      const dir = await makeFolder();
      const store = new Store();
      let error = null;
      try {
        await store.open(dir);
      } catch (caught) {
        error = caught;
      }
      assert.ok(error instanceof NoDataError);
      assert.ok(!(error instanceof BusyError));
    });
  });

  describe(`Saving (${label}): every change is written`, () => {
    test('a change is on disk without anyone asking to save', async () => {
      const { dir, store } = await openNew(makeFolder);
      const statuses = [];
      store.on('status', (s) => statuses.push(s));
      store.change((col) => addDeck(col, 'Statistics', NOW));
      assert.equal(store.status, 'pending');
      assert.equal(store.hasUnsavedChanges, true);
      await store.flush();
      assert.equal(store.status, 'saved');
      assert.equal(store.hasUnsavedChanges, false);
      assert.deepEqual(deckNames(await onDisk(dir)), ['Statistics']);
      assert.deepEqual(statuses, ['pending', 'saving', 'saved']);
    });

    test('changes made in a burst all arrive, in few writes', async () => {
      const { dir, store } = await openNew(makeFolder);
      let changes = 0;
      store.on('change', () => changes++);
      for (let i = 0; i < 25; i++) store.change((col) => addDeck(col, `Deck ${i}`, NOW));
      await store.flush();
      assert.equal(changes, 25);
      assert.equal((await onDisk(dir)).decks.size, 25);
      assert.equal(store.status, 'saved');
    });

    test('a change made while a write is under way is written too', async () => {
      const { dir, store } = await openNew(makeFolder);
      store.change((col) => addDeck(col, 'First', NOW));
      const writing = store.flush();
      store.change((col) => addDeck(col, 'Second', NOW));
      await writing;
      await store.flush();
      assert.deepEqual(deckNames(await onDisk(dir)), ['First', 'Second']);
      assert.equal(store.hasUnsavedChanges, false);
    });

    test('closing waits for the last write', async () => {
      const { dir, store } = await openNew(makeFolder);
      store.change((col) => addDeck(col, 'Last minute', NOW));
      await store.close();
      assert.deepEqual(deckNames(await onDisk(dir)), ['Last minute']);
    });
  });

  describe(`Saving (${label}): when writing fails`, () => {
    test('a write that fails for a moment is retried without bothering the user', async () => {
      const { dir, store } = await openNew(makeFolder);
      const { folder, state } = flaky(dir, 2);
      store.dir = folder;
      store.retryDelays = [0, 0, 0];
      const statuses = [];
      store.on('status', (s) => statuses.push(s));
      store.change((col) => addDeck(col, 'Persistent', NOW));
      await store.flush();
      assert.equal(state.attempts, 3);
      assert.equal(store.status, 'saved');
      assert.equal(statuses.includes('error'), false);
      assert.deepEqual(deckNames(await onDisk(dir)), ['Persistent']);
    });

    test('a write that keeps failing is reported, and the change is written once it works again', async () => {
      const { dir, store } = await openNew(makeFolder);
      const { folder, state } = flaky(dir, 99);
      store.dir = folder;
      store.retryDelays = [0, 0, 0];
      store.change((col) => addDeck(col, 'Not yet', NOW));
      await store.flush();
      assert.equal(state.attempts, 4, 'one attempt and three retries');
      assert.equal(store.status, 'error');
      assert.equal(store.error.name, 'NoModificationAllowedError');
      assert.equal(store.hasUnsavedChanges, true);
      assert.deepEqual(deckNames(await onDisk(dir)), []);
      // More changes pile up in memory; nothing is lost.
      store.change((col) => addDeck(col, 'Nor this', NOW));
      await store.flush();
      assert.equal(store.status, 'error');
      state.left = 0;
      await store.flush();
      assert.equal(store.status, 'saved');
      assert.equal(store.error, null);
      assert.deepEqual(deckNames(await onDisk(dir)), ['Not yet', 'Nor this']);
    });

    test('a refusal by the browser is reported at once, without retries', async () => {
      const { dir, store } = await openNew(makeFolder);
      const { folder, state } = flaky(dir, 99, 'NotAllowedError');
      store.dir = folder;
      store.retryDelays = [0, 0, 0];
      store.change((col) => addDeck(col, 'Refused', NOW));
      await store.flush();
      assert.equal(state.attempts, 1);
      assert.equal(store.status, 'error');
      assert.equal(store.error.name, 'NotAllowedError');
    });
  });

  describe(`Saving (${label}): changes made elsewhere`, () => {
    test('a file changed by something else is not overwritten: a conflict is raised', async () => {
      const { dir, store } = await openNew(makeFolder);
      await changeElsewhere(dir, (col) => addDeck(col, 'From the other PC', NOW));
      let raised = null;
      store.on('conflict', (conflict) => { raised = conflict; });
      store.change((col) => addDeck(col, 'Mine', NOW));
      await store.flush();
      assert.deepEqual(raised, { missing: false });
      assert.equal(store.status, 'conflict');
      assert.equal(store.hasUnsavedChanges, true);
      assert.deepEqual(deckNames(await onDisk(dir)), ['From the other PC']);
      // Further changes stay in memory until the conflict is settled.
      store.change((col) => addDeck(col, 'Mine too', NOW));
      await store.flush();
      assert.deepEqual(deckNames(await onDisk(dir)), ['From the other PC']);
    });

    test('settling by reloading takes the version on disk', async () => {
      const { dir, store } = await openNew(makeFolder);
      await changeElsewhere(dir, (col) => addDeck(col, 'From the other PC', NOW));
      store.change((col) => addDeck(col, 'Mine', NOW));
      await store.flush();
      await store.resolveConflict('reload');
      assert.equal(store.status, 'saved');
      assert.equal(store.conflict, null);
      assert.deepEqual(deckNames(store.col), ['From the other PC']);
      // Saving works again afterwards.
      store.change((col) => addDeck(col, 'After', NOW));
      await store.flush();
      assert.deepEqual(deckNames(await onDisk(dir)), ['From the other PC', 'After']);
    });

    test('settling by overwriting keeps this window’s version', async () => {
      const { dir, store } = await openNew(makeFolder);
      await changeElsewhere(dir, (col) => addDeck(col, 'From the other PC', NOW));
      store.change((col) => addDeck(col, 'Mine', NOW));
      await store.flush();
      await store.resolveConflict('overwrite');
      assert.equal(store.status, 'saved');
      assert.equal(store.hasUnsavedChanges, false);
      assert.deepEqual(deckNames(await onDisk(dir)), ['Mine']);
    });

    test('the change is noticed on a check, before any save', async () => {
      const { dir, store } = await openNew(makeFolder);
      await store.checkDisk();
      assert.equal(store.conflict, null);
      await changeElsewhere(dir, (col) => addDeck(col, 'From the other PC', NOW));
      await store.checkDisk();
      assert.deepEqual(store.conflict, { missing: false });
    });

    test('a check that overlaps one of this window’s own saves raises no false alarm', async () => {
      const { dir, store } = await openNew(makeFolder);
      const { folder, first, stamp } = gated(dir);
      store.dir = folder;
      // The window gets the focus: a check starts and is held up reading the file…
      const check = store.checkDisk();
      // …a change is saved meanwhile, and the save is held up just after writing…
      store.change((col) => addDeck(col, 'Mine', NOW));
      const saving = store.flush();
      while ((await onDisk(dir)).decks.size === 0) await pause(5);
      // …so the check now sees a file this window has not finished accounting for.
      first.open();
      await check;
      assert.equal(store.conflict, null);
      stamp.open();
      await saving;
      assert.equal(store.status, 'saved');
      await store.checkDisk();
      assert.equal(store.conflict, null);
    });

    test('a file that was only touched, with the same content, is not a conflict', async () => {
      const { dir, store } = await openNew(makeFolder);
      store.change((col) => addDeck(col, 'Mine', NOW));
      await store.flush();
      await pause(15);
      await writeText(dir, DATA_FILE, await readText(dir, DATA_FILE));
      await store.checkDisk();
      assert.equal(store.conflict, null);
      store.change((col) => addDeck(col, 'More', NOW));
      await store.flush();
      assert.equal(store.status, 'saved');
      assert.deepEqual(deckNames(await onDisk(dir)), ['Mine', 'More']);
    });

    test('a deleted data file is a conflict that can only be settled by writing it again', async () => {
      const { dir, store } = await openNew(makeFolder);
      store.change((col) => addDeck(col, 'Mine', NOW));
      await store.flush();
      await dir.removeEntry(DATA_FILE);
      store.change((col) => addDeck(col, 'More', NOW));
      await store.flush();
      assert.deepEqual(store.conflict, { missing: true });
      await assert.rejects(store.resolveConflict('reload'), /no flashcard data/);
      assert.deepEqual(store.conflict, { missing: true });
      await store.resolveConflict('overwrite');
      assert.deepEqual(deckNames(await onDisk(dir)), ['Mine', 'More']);
    });
  });

  describe(`Saving (${label}): daily backup`, () => {
    test('opening backs up the file as it was before this session', async () => {
      const { dir, store } = await openNew(makeFolder);
      store.change((col) => addDeck(col, 'Day one', NOW));
      await store.close();

      const next = new Store();
      const tomorrow = new Date(2026, 9, 2, 10, 0);
      await next.open(dir, { now: tomorrow });
      next.change((col) => addDeck(col, 'Day two', tomorrow));
      await next.flush();

      assert.equal(next.backupCount, 2);
      const backups = await dir.getDirectoryHandle(BACKUPS_DIR);
      const saved = parseCollection(await readText(backups, 'data-2026-10-02_10-00-00.json'));
      assert.deepEqual(deckNames(saved), ['Day one']);
    });

    test('an app left open makes the next backup once 24 hours have passed', async () => {
      const { dir, store } = await openNew(makeFolder);
      store.change((col) => addDeck(col, 'Deck', NOW));
      await store.flush();
      assert.equal(await store.backupIfDue(new Date(2026, 9, 1, 22, 0)), null);
      assert.equal(await store.backupIfDue(new Date(2026, 9, 2, 10, 0)), 'data-2026-10-02_10-00-00.json');
      assert.equal(store.backupCount, 2);
      assert.deepEqual(store.lastBackup.time, new Date(2026, 9, 2, 10, 0));
      const backups = await dir.getDirectoryHandle(BACKUPS_DIR);
      assert.deepEqual(deckNames(parseCollection(await readText(backups, 'data-2026-10-02_10-00-00.json'))), ['Deck']);
    });
  });
}
