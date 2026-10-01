// The app shell: start screen, navigation, save status, and the watch on the data file.

import { requestPermission } from './storage/folder.js';
import { store } from './store.js';
import { alertDialog, h, reportError, setChildren, showDialog } from './ui/dom.js';
import { resetImages } from './ui/images.js';
import './ui/install.js';
import {
  lastFolder, openFolder, startScreen, unsupportedScreen,
} from './ui/open-folder.js';
import * as addView from './ui/views/add.js';
import * as browseView from './ui/views/browse.js';
import * as decksView from './ui/views/decks.js';
import * as editorView from './ui/views/editor.js';
import * as settingsView from './ui/views/settings.js';
import * as statsView from './ui/views/stats.js';
import * as studyView from './ui/views/study.js';

const VIEWS = {
  decks: decksView,
  study: studyView,
  add: addView,
  editor: editorView,
  browse: browseView,
  stats: statsView,
  settings: settingsView,
};

const NAV = [
  ['decks', 'Decks'],
  ['add', 'Add card'],
  ['editor', 'Card editor'],
  ['browse', 'Browse'],
  ['stats', 'Statistics'],
  ['settings', 'Settings'],
];

const BACKUP_CHECK_MS = 30 * 60_000;

const app = document.getElementById('app');
let viewHost = null;
let navLinks = [];
let statusButton = null;
let unmountView = null;

// ---------------------------------------------------------------- routing

function currentRoute() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [name = '', ...args] = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: Object.hasOwn(VIEWS, name) ? name : 'decks', args, query: new URLSearchParams(query) };
}

function showRoute() {
  if (!store.isOpen || !viewHost) return;
  unmountView?.();
  unmountView = null;
  const route = currentRoute();
  // Studying is part of "Decks" in the navigation.
  const section = route.name === 'study' ? 'decks' : route.name;
  for (const link of navLinks) link.classList.toggle('active', link.dataset.route === section);
  viewHost.className = `view view-${route.name}`;
  viewHost.replaceChildren();
  try {
    unmountView = VIEWS[route.name].mount(viewHost, route) ?? null;
  } catch (error) {
    reportError(error);
  }
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- save status

const STATUS = {
  saved: { text: 'Saved', title: 'Every change is written to data.json as you make it.' },
  pending: { text: 'Saving…', title: 'Writing to data.json.' },
  saving: { text: 'Saving…', title: 'Writing to data.json.' },
  error: { text: 'Not saved', title: 'The last change could not be written. Click to see why and try again.' },
  conflict: { text: 'File changed elsewhere', title: 'data.json was changed outside this window, so saving is on hold. Click to decide what to do.' },
};

function showStatus() {
  if (!statusButton) return;
  const status = STATUS[store.status];
  statusButton.hidden = !status;
  if (!status) return;
  statusButton.textContent = status.text;
  statusButton.title = status.title;
  statusButton.dataset.status = store.status;
}

let saveErrorOpen = false;

// A failed save must not go unnoticed: until it works again, the latest
// changes exist only in this window.
async function reportSaveError() {
  if (saveErrorOpen || store.status !== 'error') return;
  saveErrorOpen = true;
  let retry = false;
  try {
    retry = await showDialog({
      title: 'Your changes are not being saved',
      content: [
        h('p', null, `Writing to data.json failed: ${store.error?.message || 'unknown error'}`),
        h('p', null, 'The usual reasons: the browser no longer has access to the folder, the folder was moved or renamed, or the disk is full or read-only.'),
        h('p', null, 'Until saving works again, your latest changes exist only in this window.'),
      ],
      buttons: (close) => [
        h('button', { class: 'btn', type: 'button', onclick: () => close(false) }, 'Later'),
        h('button', { class: 'btn btn-primary', type: 'button', autofocus: true, onclick: () => close(true) }, 'Try again'),
      ],
    });
    if (retry) {
      try {
        // Asks the user to allow access again if the browser withdrew it.
        await requestPermission(store.dir);
      } catch {
        // The save below reports what is wrong.
      }
      await store.flush();
    }
  } finally {
    saveErrorOpen = false;
  }
  if (retry && store.status === 'error') reportSaveError();
}

let conflictOpen = false;

async function settleConflict() {
  if (conflictOpen || !store.conflict) return;
  conflictOpen = true;
  try {
    const missing = store.conflict.missing;
    const choice = await showDialog({
      title: missing ? 'The data file is gone' : 'The data file was changed outside this window',
      dismissible: false,
      content: missing
        ? [
          h('p', null, 'data.json is no longer in the data folder. Nothing has been written.'),
          h('p', null, 'This window still holds your cards as they were when it last saved.'),
        ]
        : [
          h('p', null, 'data.json was changed by something else after this window read it: another window, another program, or a sync from another PC. To protect your cards, nothing has been written over it.'),
          h('p', null, store.dirty
            ? 'This window has changes that are not saved yet. Choose which version to keep; the other one is lost.'
            : 'This window has no unsaved changes, so loading the version on disk loses nothing.'),
        ],
      buttons: (close) => [
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => close('later') }, 'Decide later'),
        missing ? null : h('button', { class: 'btn btn-primary', type: 'button', autofocus: true, onclick: () => close('reload') }, 'Load the version on disk'),
        h('button', { class: missing ? 'btn btn-primary' : 'btn', type: 'button', onclick: () => close('overwrite') },
          missing ? 'Write the file again' : 'Keep this window’s version'),
      ],
    });
    // "Later" leaves the red status in the top bar, which reopens this dialog.
    // Nothing is saved meanwhile, but decks can still be exported.
    if (choice === 'later') return;
    await store.resolveConflict(choice);
    if (choice === 'reload') {
      resetImages();
      showRoute();
    }
  } catch (error) {
    await alertDialog({
      title: 'That did not work',
      message: [
        error?.message || String(error),
        'If the data folder was moved or renamed, put it back, then click “File changed elsewhere” at the top to try again.',
      ],
    });
  } finally {
    conflictOpen = false;
  }
}

// ---------------------------------------------------------------- shell

function showShell() {
  navLinks = NAV.map(([route, label]) => h('a', { class: 'nav-link', href: `#/${route}`, dataset: { route } }, label));
  statusButton = h('button', {
    class: 'save-status',
    type: 'button',
    onclick: () => {
      if (store.status === 'error') reportSaveError();
      else if (store.status === 'conflict') settleConflict();
    },
  });
  viewHost = h('main', { id: 'view' });
  setChildren(app,
    h('header', { class: 'topbar' },
      h('a', { class: 'brand', href: '#/decks' }, h('img', { src: 'icons/icon.svg', alt: '', width: 26, height: 26 }), 'Flashcards'),
      h('nav', { class: 'nav', 'aria-label': 'Sections' }, navLinks),
      statusButton),
    viewHost,
  );
  showStatus();
  showRoute();
}

// A newly opened folder always starts on the deck list.
function showHome() {
  if (location.hash !== '#/decks') history.replaceState(null, '', '#/decks');
  showShell();
}

async function showStart() {
  unmountView?.();
  unmountView = null;
  viewHost = null;
  statusButton = null;
  const last = await lastFolder();
  setChildren(app, startScreen({ last, onOpened: showHome }));
}

function refresh() {
  if (store.isOpen) showHome();
  else showStart();
}

// ---------------------------------------------------------------- start

async function start() {
  if (!('showDirectoryPicker' in window)) {
    setChildren(app, unsupportedScreen());
    return;
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  store.on('status', (status) => {
    showStatus();
    if (status === 'error') reportSaveError();
  });
  store.on('conflict', settleConflict);
  window.addEventListener('hashchange', showRoute);
  window.addEventListener('app:folder-changed', refresh);

  // Notice changes made elsewhere as soon as the user comes back to this window.
  window.addEventListener('focus', () => store.checkDisk());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') store.checkDisk();
  });

  window.addEventListener('beforeunload', (event) => {
    if (store.hasUnsavedChanges || editorView.hasUnsavedDraft()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  // An app left open still gets its daily backup.
  setInterval(() => {
    if (store.isOpen && !store.conflict) {
      store.backupIfDue().catch((error) => {
        store.backupError = error;
      });
    }
  }, BACKUP_CHECK_MS);

  // Reopen the folder used last if the browser still allows it without asking.
  const last = await lastFolder();
  if (last?.ready && (await openFolder(last.dir, { intent: 'open', picked: false }))) {
    showShell();
  } else {
    await showStart();
  }
}

window.addEventListener('error', (event) => reportError(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => reportError(event.reason));

start().catch((error) => {
  setChildren(app, h('p', { class: 'boot-message' }, `The app could not start: ${error?.message || error}`));
});
