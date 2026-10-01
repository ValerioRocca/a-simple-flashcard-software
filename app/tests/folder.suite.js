// Tests of everything written to and read from the data folder.
// The same tests run against the in-memory folder (Node and browser) and, in
// the browser, against real file handles.

import { describe, test, assert } from './harness.js';
import { listNames, readText, writeText } from './memfs.js';
import {
  BACKUPS_DIR, DATA_FILE, IMAGES_DIR, backupIfDue, backupName, backupTime, dataFileStamp, inspectFolder,
  isInsideApp, listBackups, readDataFile, readImage, sameStamp, saveImage, writeDataFile, writeImage,
} from '../js/storage/folder.js';

const at = (day, hour = 10, minute = 0, second = 0) => new Date(2026, 9, day, hour, minute, second);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function defineFolderTests(label, makeFolder) {
  describe(`Data folder (${label}): data file`, () => {
    test('a folder without data reads as null', async () => {
      const dir = await makeFolder();
      assert.equal(await readDataFile(dir), null);
      assert.equal(await dataFileStamp(dir), null);
    });

    test('what is written is read back, text and stamp', async () => {
      const dir = await makeFolder();
      const stamp = await writeDataFile(dir, '{"a":"è 日本"}\n');
      const data = await readDataFile(dir);
      assert.equal(data.text, '{"a":"è 日本"}\n');
      assert.ok(sameStamp(data.stamp, stamp));
      assert.ok(sameStamp(await dataFileStamp(dir), stamp));
      assert.equal(stamp.size, new Blob(['{"a":"è 日本"}\n']).size);
    });

    test('writing replaces the whole file', async () => {
      const dir = await makeFolder();
      await writeDataFile(dir, 'a long first version');
      await writeDataFile(dir, 'short');
      assert.equal((await readDataFile(dir)).text, 'short');
    });

    test('a change made by something else shows in the stamp', async () => {
      const dir = await makeFolder();
      const stamp = await writeDataFile(dir, 'mine');
      await pause(15);
      await writeText(dir, DATA_FILE, 'theirs, longer');
      assert.equal(sameStamp(await dataFileStamp(dir), stamp), false);
    });

    test('inspecting a folder tells empty, with data, and the app folder apart', async () => {
      const dir = await makeFolder();
      assert.deepEqual(await inspectFolder(dir), { hasData: false, isEmpty: true, looksLikeApp: false });
      await writeDataFile(dir, '{}');
      assert.deepEqual(await inspectFolder(dir), { hasData: true, isEmpty: false, looksLikeApp: false });
      await writeText(dir, 'serve.py', '');
      await dir.getDirectoryHandle('app', { create: true });
      assert.equal((await inspectFolder(dir)).looksLikeApp, true);
    });
  });

  describe(`Data folder (${label}): backups`, () => {
    test('backup names carry the local date and time', () => {
      const name = backupName(at(1, 18, 47, 5));
      assert.equal(name, 'data-2026-10-01_18-47-05.json');
      assert.deepEqual(backupTime(name), at(1, 18, 47, 5));
      assert.equal(backupTime('data.json'), null);
      assert.equal(backupTime('data-2026-10-01.json'), null);
    });

    test('the first backup is made at once, the next one only 24 hours later', async () => {
      const dir = await makeFolder();
      await writeDataFile(dir, 'version 1');
      assert.equal(await backupIfDue(dir, at(1, 10)), 'data-2026-10-01_10-00-00.json');
      await writeDataFile(dir, 'version 2');
      assert.equal(await backupIfDue(dir, at(1, 20)), null);
      assert.equal(await backupIfDue(dir, at(2, 9, 59)), null);
      assert.equal(await backupIfDue(dir, at(2, 10)), 'data-2026-10-02_10-00-00.json');
      const backups = await dir.getDirectoryHandle(BACKUPS_DIR);
      assert.equal(await readText(backups, 'data-2026-10-01_10-00-00.json'), 'version 1');
      assert.equal(await readText(backups, 'data-2026-10-02_10-00-00.json'), 'version 2');
    });

    test('the content handed over is what gets backed up', async () => {
      const dir = await makeFolder();
      await writeDataFile(dir, 'on disk');
      const name = await backupIfDue(dir, at(1), 'as loaded');
      assert.equal(await readText(await dir.getDirectoryHandle(BACKUPS_DIR), name), 'as loaded');
    });

    test('no data file, no backup', async () => {
      const dir = await makeFolder();
      assert.equal(await backupIfDue(dir, at(1)), null);
      assert.deepEqual(await listBackups(dir), []);
    });

    test('only the newest seven are kept, and other files are left alone', async () => {
      const dir = await makeFolder();
      const backups = await dir.getDirectoryHandle(BACKUPS_DIR, { create: true });
      await writeText(backups, 'my own copy.json', 'keep me');
      for (let day = 1; day <= 10; day++) {
        await writeDataFile(dir, `day ${day}`);
        await backupIfDue(dir, at(day));
      }
      const names = await listNames(backups);
      assert.deepEqual(names, [
        'data-2026-10-04_10-00-00.json', 'data-2026-10-05_10-00-00.json', 'data-2026-10-06_10-00-00.json',
        'data-2026-10-07_10-00-00.json', 'data-2026-10-08_10-00-00.json', 'data-2026-10-09_10-00-00.json',
        'data-2026-10-10_10-00-00.json', 'my own copy.json',
      ]);
      assert.equal(await readText(backups, 'data-2026-10-04_10-00-00.json'), 'day 4');
      assert.deepEqual((await listBackups(dir)).map((b) => b.time.getDate()), [4, 5, 6, 7, 8, 9, 10]);
    });

    test('a backup dated in the future does not stop new backups', async () => {
      const dir = await makeFolder();
      await writeDataFile(dir, 'data');
      const backups = await dir.getDirectoryHandle(BACKUPS_DIR, { create: true });
      await writeText(backups, backupName(new Date(2031, 0, 1)), 'from a wrong clock');
      assert.equal(await backupIfDue(dir, at(1)), 'data-2026-10-01_10-00-00.json');
      assert.equal(await backupIfDue(dir, at(1, 11)), null);
    });
  });

  describe(`Data folder (${label}): pictures`, () => {
    test('a picture is stored under a new name and read back', async () => {
      const dir = await makeFolder();
      const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
      const name = await saveImage(dir, new Blob([bytes], { type: 'image/png' }), at(1, 18, 47, 5));
      assert.match(name, /^img-20261001-184705-[0-9a-z]{4}\.png$/);
      const file = await readImage(dir, name);
      assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [...bytes]);
      assert.deepEqual(await listNames(await dir.getDirectoryHandle(IMAGES_DIR)), [name]);
    });

    test('two pictures saved in the same second get different names', async () => {
      const dir = await makeFolder();
      const blob = new Blob(['x'], { type: 'image/jpeg' });
      const a = await saveImage(dir, blob, at(1));
      const b = await saveImage(dir, blob, at(1));
      assert.notEqual(a, b);
      assert.ok(a.endsWith('.jpg'));
    });

    test('only pictures are accepted', async () => {
      const dir = await makeFolder();
      await assert.rejects(saveImage(dir, new Blob(['x'], { type: 'application/pdf' })), /Only pictures/);
    });

    test('a missing picture, or a name that is not a plain file name, reads as null', async () => {
      const dir = await makeFolder();
      assert.equal(await readImage(dir, 'nothing.png'), null);
      await writeImage(dir, 'a.png', new Blob(['x'], { type: 'image/png' }));
      assert.equal(await readImage(dir, 'missing.png'), null);
      assert.equal(await readImage(dir, '../data.json'), null);
      assert.ok(await readImage(dir, 'a.png'));
    });
  });

  describe(`Data folder (${label}): inside the app folder?`, () => {
    const server = (answer) => async (url) => {
      server.lastUrl = url;
      return { ok: answer !== null, json: async () => ({ inside: answer }) };
    };

    test('asks the local server about a marker file and removes the marker', async () => {
      const dir = await makeFolder();
      assert.equal(await isInsideApp(dir, server(true)), true);
      assert.match(server.lastUrl, /^\/__inside\?probe=flashcards-probe-[0-9a-z]{16}\.txt$/);
      assert.deepEqual(await listNames(dir), []);
      assert.equal(await isInsideApp(dir, server(false)), false);
      assert.deepEqual(await listNames(dir), []);
    });

    test('cannot tell when the server does not answer', async () => {
      const dir = await makeFolder();
      assert.equal(await isInsideApp(dir, server(null)), null);
      assert.equal(await isInsideApp(dir, async () => { throw new Error('offline'); }), null);
      assert.deepEqual(await listNames(dir), []);
    });
  });
}
