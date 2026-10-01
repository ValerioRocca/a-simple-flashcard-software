// Runs every test in the browser and shows the results on the page.

import { runAll, suiteCount } from './harness.js';
import { defineFolderTests } from './folder.suite.js';
import { defineStoreTests } from './store.suite.js';
import './suites.js';
import './browser.test.js';

const summary = document.getElementById('summary');
const results = document.getElementById('results');
const realButton = document.getElementById('real-folder');
const realNote = document.getElementById('real-folder-note');

/** Run the suites registered from `since` on, listing each result under `host`. */
async function runInto(host, since = 0) {
  let list = null;
  let suiteName = null;
  return runAll((result) => {
    if (result.suite !== suiteName) {
      suiteName = result.suite;
      const heading = document.createElement('h2');
      heading.className = 'test-suite';
      heading.textContent = suiteName;
      list = document.createElement('ul');
      list.className = 'test-list';
      host.append(heading, list);
    }
    const item = document.createElement('li');
    item.className = result.ok ? 'test-pass' : 'test-fail';
    item.textContent = result.name;
    if (!result.ok) {
      const detail = document.createElement('pre');
      detail.className = 'test-error';
      detail.textContent = result.error;
      item.append(detail);
    }
    list.append(item);
  }, { since });
}

const { passed, failed, results: all } = await runInto(results);

summary.textContent = failed
  ? `${failed} of ${all.length} tests failed`
  : `All ${passed} tests passed`;
summary.dataset.state = failed ? 'fail' : 'pass';
document.title = failed ? `✗ ${failed} failed — tests` : `✓ ${passed} passed — tests`;

// For automated runs.
window.testResults = { passed, failed, failures: all.filter((r) => !r.ok) };

// ---------------------------------------------------------------- a real folder
//
// The tests above cannot reach the disk. This repeats the storage tests in a
// folder the user picks, inside a scratch subfolder that is deleted afterwards.

if ('showDirectoryPicker' in window) {
  realButton.hidden = false;
  realButton.addEventListener('click', async () => {
    let chosen;
    try {
      chosen = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch {
      return;
    }
    realButton.disabled = true;
    const scratchName = `flashcards-selftest-${Date.now()}`;
    const host = document.createElement('div');
    results.prepend(host);
    try {
      const scratch = await chosen.getDirectoryHandle(scratchName, { create: true });
      let run = 0;
      const freshFolder = () => scratch.getDirectoryHandle(`run-${run++}`, { create: true });
      const since = suiteCount();
      const label = `folder “${chosen.name}” on disk`;
      defineFolderTests(label, freshFolder);
      defineStoreTests(label, freshFolder);
      realNote.textContent = `Testing in “${chosen.name}/${scratchName}”…`;
      const real = await runInto(host, since);
      realNote.textContent = real.failed
        ? `${real.failed} of ${real.results.length} tests failed in the folder “${chosen.name}”.`
        : `All ${real.passed} storage tests passed in the folder “${chosen.name}” on disk.`;
      realNote.dataset.state = real.failed ? 'fail' : 'pass';
      window.realFolderResults = { passed: real.passed, failed: real.failed, failures: real.results.filter((r) => !r.ok) };
    } catch (error) {
      realNote.textContent = `The folder could not be tested: ${error.message}`;
      realNote.dataset.state = 'fail';
      window.realFolderResults = { passed: 0, failed: 1, failures: [{ name: 'setup', error: String(error) }] };
    } finally {
      try {
        await chosen.removeEntry(scratchName, { recursive: true });
      } catch {
        realNote.textContent += ` The scratch folder “${scratchName}” could not be removed; delete it by hand.`;
      }
      realButton.disabled = false;
    }
  });
}
