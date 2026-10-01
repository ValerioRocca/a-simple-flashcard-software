// Tests that need a real browser: file handles, the remembered folder, and
// turning card text into safe HTML with formulas and pictures.

import { describe, test, assert } from './harness.js';
import { defineFolderTests } from './folder.suite.js';
import { defineStoreTests } from './store.suite.js';
import { forgetFolder, recallFolder, rememberFolder } from '../js/storage/remember.js';
import { writeImage } from '../js/storage/folder.js';
import { store } from '../js/store.js';
import { resetImages } from '../js/ui/images.js';
import { renderMarkdown } from '../js/ui/render.js';

// Real file handles, in the browser's private file system (never the user's folder).
const TEST_ROOT = '__flashcards-tests';
let folderNumber = 0;

async function freshFolder() {
  const root = await navigator.storage.getDirectory();
  const tests = await root.getDirectoryHandle(TEST_ROOT, { create: true });
  return tests.getDirectoryHandle(`run-${Date.now()}-${folderNumber++}`, { create: true });
}

async function removeTestFolders() {
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(TEST_ROOT, { recursive: true });
  } catch {
    // nothing to remove
  }
}

await removeTestFolders();

defineFolderTests('real file handles', freshFolder);
defineStoreTests('real file handles', freshFolder);

describe('Remembered folder', () => {
  test('only a handle to the folder is kept, and it still opens the folder', async () => {
    const dir = await freshFolder();
    await (await dir.getFileHandle('marker.txt', { create: true })).getFile();
    // Under a key of its own, so the folder the app really remembers is left alone.
    const key = 'test-folder';
    await rememberFolder(dir, key);
    const back = await recallFolder(key);
    assert.equal(back.kind, 'directory');
    assert.equal(back.name, dir.name);
    assert.ok(await back.isSameEntry(dir));
    assert.ok(await back.getFileHandle('marker.txt'));
    await forgetFolder(key);
    assert.equal(await recallFolder(key), null);
  });
});

const render = (text) => renderMarkdown(document.createElement('div'), text);
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('Card text on the page', () => {
  test('Markdown becomes HTML', () => {
    const el = render('**bold** and *italic*\n\n- one\n- two');
    assert.equal(el.querySelector('strong').textContent, 'bold');
    assert.equal(el.querySelector('em').textContent, 'italic');
    assert.equal(el.querySelectorAll('li').length, 2);
  });

  test('formulas are typeset, inline and display', () => {
    const el = render('inline $x_i^2$ and\n[$] \\frac{a}{b} [/$]');
    const formulas = [...el.querySelectorAll('.math-tex')];
    assert.equal(formulas.length, 2);
    assert.ok(formulas.every((f) => f.querySelector('.katex')), 'both rendered by KaTeX');
    assert.equal(formulas[0].querySelector('.katex-display'), null);
    assert.ok(formulas[1].querySelector('.katex-display'));
    assert.match(formulas[0].textContent, /x/);
  });

  test('a formula that is not valid LaTeX shows as an error, not a crash', () => {
    const el = render('broken $\\frac{a$ here');
    assert.ok(el.querySelector('.math-tex'));
    assert.match(el.textContent, /here/);
  });

  test('scripts, event handlers and script links are removed', () => {
    const el = render('ok <script>window.hacked = 1</script><img src="images/x.png" onerror="window.hacked = 2">'
      + '<a href="javascript:window.hacked=3">link</a><b onclick="window.hacked = 4">bold</b><iframe src="/"></iframe>');
    assert.equal(el.querySelector('script'), null);
    assert.equal(el.querySelector('iframe'), null);
    assert.equal(el.querySelector('[onerror]'), null);
    assert.equal(el.querySelector('[onclick]'), null);
    assert.equal(el.querySelector('a').getAttribute('href'), null);
    assert.equal(el.querySelector('b').textContent, 'bold');
    assert.equal(window.hacked, undefined);
  });

  test('pictures from the internet are never loaded', () => {
    const el = render('![remote](https://example.org/a.png) <img src="http://example.org/b.png"> <img srcset="https://example.org/c.png 2x">');
    const images = [...el.querySelectorAll('img')];
    assert.equal(images.length, 3);
    assert.ok(images.every((img) => !img.hasAttribute('src') && !img.hasAttribute('srcset')));
    assert.match(images[0].alt, /picture not shown/);
  });

  test('links open in a new tab without access to this page', () => {
    const link = render('[site](https://example.org)').querySelector('a');
    assert.equal(link.getAttribute('target'), '_blank');
    assert.match(link.getAttribute('rel'), /noopener/);
  });

  test('a picture from the data folder is shown, a missing one is named', async () => {
    const dir = await freshFolder();
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    await writeImage(dir, 'dot.png', new Blob([png], { type: 'image/png' }));
    const previous = store.dir;
    store.dir = dir;
    resetImages();
    try {
      const el = render('![a dot](images/dot.png) and ![](images/missing.png)');
      const [found, missing] = el.querySelectorAll('img');
      assert.equal(found.getAttribute('data-img'), 'dot.png');
      await settle();
      assert.match(found.src, /^blob:/);
      assert.match(missing.alt, /picture not found: images\/missing\.png/);
      assert.equal(missing.hasAttribute('src'), false);
    } finally {
      store.dir = previous;
      resetImages();
    }
  });
});

describe('Cleaning up', () => {
  test('the test folders are removed', async () => {
    await removeTestFolders();
    const root = await navigator.storage.getDirectory();
    await assert.rejects(root.getDirectoryHandle(TEST_ROOT), /./);
  });
});
