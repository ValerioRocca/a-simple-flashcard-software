// Choosing and opening the data folder.

import { DataError } from '../core/collection.js';
import { BusyError, NoDataError, store } from '../store.js';
import { hasPermission, inspectFolder, isInsideApp, requestPermission } from '../storage/folder.js';
import { forgetFolder, recallFolder, rememberFolder } from '../storage/remember.js';
import { alertDialog, confirmDialog, h } from './dom.js';
import { resetImages } from './images.js';

// One window at a time may have a collection open: the browser hands out a
// named lock that a second tab or window cannot get.
function lockCollection(id) {
  if (!navigator.locks) return Promise.resolve(() => {});
  return new Promise((resolve) => {
    navigator.locks.request(`flashcards:${id}`, { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(null);
        return undefined;
      }
      // The lock is held until this promise resolves, i.e. until `release` is called.
      return new Promise((release) => resolve(release));
    });
  });
}

async function warnIfInsideApp(dir, info) {
  const inside = info.looksLikeApp || (await isInsideApp(dir)) === true;
  if (!inside) return true;
  return confirmDialog({
    title: 'This folder is inside the app',
    message: [
      `“${dir.name}” lies inside the app's own folder, which is a Git repository. Cards kept there could be pushed to GitHub with the app.`,
      'Choose a folder somewhere else, for example in Documents or OneDrive.',
    ],
    confirmLabel: 'Use it anyway',
    cancelLabel: 'Choose another folder',
    danger: true,
  });
}

async function explainFailure(error, dir) {
  if (error instanceof BusyError) {
    await alertDialog({
      title: 'Already open',
      message: [
        `“${dir.name}” is already open in another tab or window of this browser.`,
        'Use that one, or close it and try again. Working in two windows at once could overwrite your changes.',
      ],
    });
  } else if (error instanceof DataError) {
    await alertDialog({
      title: 'The data file cannot be read',
      message: [
        `data.json in “${dir.name}” was not opened: ${error.message}`,
        'Nothing was changed. To go back to an earlier state, copy a file from the backups folder over data.json.',
      ],
    });
  } else if (error?.name === 'NotFoundError') {
    await alertDialog({ title: 'Folder not found', message: `“${dir.name}” no longer exists or was moved.` });
  } else if (error?.name === 'NotAllowedError') {
    await alertDialog({ title: 'No access', message: `The browser was not given access to “${dir.name}”.` });
  } else {
    await alertDialog({ title: 'The folder could not be opened', message: error?.message || String(error) });
  }
}

/**
 * Close the open data folder. When the latest changes could not be saved (a
 * failed save, or a conflict left for later), asks before dropping them.
 * Resolves to false when the user keeps the folder open.
 */
export async function closeFolder() {
  if (!store.isOpen) return true;
  await store.flush();
  if (store.hasUnsavedChanges) {
    const drop = await confirmDialog({
      title: 'Some changes are not saved',
      message: [
        'The latest changes in this window have not been written to data.json.',
        'Closing the folder now loses them. To keep them, cancel and settle the red notice at the top first.',
      ],
      confirmLabel: 'Close and lose them',
      danger: true,
    });
    if (!drop) return false;
  }
  await store.close();
  resetImages();
  return true;
}

/**
 * Open `dir` as the data folder. `intent` is 'open' or 'create'; `picked` is
 * true when the user has just chosen the folder. Resolves to true on success.
 */
export async function openFolder(dir, { intent = 'open', picked = false } = {}) {
  try {
    const info = await inspectFolder(dir);
    if (picked && !(await warnIfInsideApp(dir, info))) return false;

    let create = false;
    if (!info.hasData) {
      if (!picked) throw new NoDataError();
      if (intent === 'open') {
        const startNew = await confirmDialog({
          title: 'No flashcard data here',
          message: `“${dir.name}” has no data file. Start a new, empty collection in this folder?`,
          confirmLabel: 'Start new collection',
        });
        if (!startNew) return false;
      } else if (!info.isEmpty) {
        const proceed = await confirmDialog({
          title: 'This folder is not empty',
          message: `The app will add data.json, an images folder and a backups folder to “${dir.name}”. Nothing already there is changed.`,
          confirmLabel: 'Use this folder',
        });
        if (!proceed) return false;
      }
      create = true;
    } else if (picked && intent === 'create') {
      const openIt = await confirmDialog({
        title: 'This folder already has flashcards',
        message: `“${dir.name}” already contains a data file. Open it instead?`,
        confirmLabel: 'Open it',
      });
      if (!openIt) return false;
    }

    if (!(await closeFolder())) return false;
    await store.open(dir, { create, lock: lockCollection });
    await rememberFolder(dir);
    return true;
  } catch (error) {
    if (error instanceof NoDataError && !picked) await forgetFolder();
    await explainFailure(error, dir);
    return false;
  }
}

/** Let the user choose a folder, then open it. */
export async function pickFolder(intent) {
  let dir;
  try {
    dir = await window.showDirectoryPicker({ id: 'flashcards-data', mode: 'readwrite', startIn: 'documents' });
  } catch (error) {
    if (error?.name === 'AbortError') return false;
    await alertDialog({ title: 'The folder could not be chosen', message: error?.message || String(error) });
    return false;
  }
  return openFolder(dir, { intent, picked: true });
}

/**
 * The folder used last: `{ dir, ready }`, where `ready` is true when the
 * browser still grants access without asking. Null when none is remembered.
 */
export async function lastFolder() {
  const dir = await recallFolder();
  if (!dir) return null;
  try {
    return { dir, ready: await hasPermission(dir) };
  } catch {
    return null;
  }
}

/** Reopen the remembered folder. Must be called from a click when `ready` was false. */
export async function reopenFolder(dir) {
  try {
    if (!(await requestPermission(dir))) {
      await alertDialog({ title: 'No access', message: `The browser was not given access to “${dir.name}”.` });
      return false;
    }
  } catch (error) {
    await explainFailure(error, dir);
    return false;
  }
  return openFolder(dir, { intent: 'open', picked: false });
}

export function startScreen({ last, onOpened }) {
  const busy = (button, action) => async () => {
    button.disabled = true;
    try {
      if (await action()) onOpened();
    } finally {
      button.disabled = false;
    }
  };

  const openButton = h('button', { class: 'btn btn-lg', type: 'button' }, 'Open a data folder');
  openButton.addEventListener('click', busy(openButton, () => pickFolder('open')));
  const createButton = h('button', { class: 'btn btn-lg', type: 'button' }, 'Create a new data folder');
  createButton.addEventListener('click', busy(createButton, () => pickFolder('create')));

  let continueButton = null;
  if (last) {
    continueButton = h('button', { class: 'btn btn-primary btn-lg', type: 'button', autofocus: true },
      'Continue with “', h('strong', null, last.dir.name), '”');
    continueButton.addEventListener('click', busy(continueButton, () => reopenFolder(last.dir)));
  } else {
    openButton.classList.add('btn-primary');
  }

  return h('div', { class: 'start' },
    h('img', { class: 'start-logo', src: 'icons/icon.svg', alt: '', width: 72, height: 72 }),
    h('h1', null, 'Flashcards'),
    h('p', { class: 'start-lead' },
      'Your cards live in a folder on this computer. Nothing is stored in the browser or sent anywhere.'),
    h('div', { class: 'start-actions' }, continueButton, openButton, createButton),
    h('p', { class: 'start-note' },
      'The folder holds your cards (data.json), their pictures and a daily backup. ',
      'Pick one outside the app’s own folder; a folder inside OneDrive also gives you a copy off this PC.'),
  );
}

export function unsupportedScreen() {
  return h('div', { class: 'start' },
    h('img', { class: 'start-logo', src: 'icons/icon.svg', alt: '', width: 72, height: 72 }),
    h('h1', null, 'Flashcards'),
    h('p', { class: 'start-lead' }, 'This browser cannot open a folder on your computer, which the app needs to store your cards.'),
    h('p', { class: 'start-note' }, 'Open the app in Microsoft Edge or Google Chrome on a desktop computer.'),
  );
}
