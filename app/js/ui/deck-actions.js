// Things done to a whole deck: create, rename, limits, delete, export, import.

import {
  LIMITS, addDeck, deleteDeck, parseCollection, renameDeck, setDeckLimits,
} from '../core/collection.js';
import { deckToJson, deckToMarkdown, imagesReferencedBy, importDecks, notesOfDeck } from '../core/deck-io.js';
import { deckCounts } from '../core/scheduler.js';
import { isImageName, isImageType, readImage, writeImage } from '../storage/folder.js';
import { randomId } from '../core/ids.js';
import { store } from '../store.js';
import {
  alertDialog, confirmDialog, h, plural, promptDialog, reportError, showDialog, toast,
} from './dom.js';
import { blobToDataUrl, dataUrlToBlob, fileNameFor, openTextFile, saveTextAs } from './files.js';
import { resetImages } from './images.js';

/** Ask for a name and create the deck. Returns the deck, or null when cancelled. */
export async function createDeck(suggested = '') {
  let deck = null;
  const name = await promptDialog({
    title: 'New deck',
    label: 'Name',
    value: suggested,
    confirmLabel: 'Create deck',
    check: (text) => {
      deck = store.change((col) => addDeck(col, text));
    },
  });
  return name === null ? null : deck;
}

export async function renameDeckDialog(deckId) {
  const deck = store.col.decks.get(deckId);
  await promptDialog({
    title: 'Rename deck',
    label: 'Name',
    value: deck.name,
    confirmLabel: 'Rename',
    check: (text) => {
      if (text !== deck.name) store.change((col) => renameDeck(col, deckId, text));
    },
  });
}

function limitField(label, value, fallback) {
  const input = h('input', {
    class: 'input input-number',
    type: 'number',
    min: 0,
    max: LIMITS.perDayMax,
    step: 1,
    inputMode: 'numeric',
    placeholder: `${fallback} (default)`,
    value: value ?? '',
  });
  const field = h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input);
  const read = () => {
    const text = input.value.trim();
    if (text === '') return null;
    const number = Number(text);
    if (!Number.isInteger(number)) throw new Error(`${label}: enter a whole number, or leave the field empty.`);
    return number;
  };
  return { field, input, read };
}

/** Raise or lower the number of new cards and of reviews per day for one deck. */
export async function limitsDialog(deckId) {
  const { col } = store;
  const deck = col.decks.get(deckId);
  const counts = deckCounts(col).get(deckId);
  const fresh = limitField('New cards per day', deck.newPerDay, col.settings.newPerDay);
  const reviews = limitField('Reviews per day', deck.reviewsPerDay, col.settings.reviewsPerDay);
  const error = h('p', { class: 'field-error', hidden: true });

  await showDialog({
    title: `Daily limits for “${deck.name}”`,
    content: [
      h('p', { class: 'muted' },
        `Studied today: ${plural(counts.newDone, 'new card')}, ${plural(counts.reviewsDone, 'review')}. `,
        `Still waiting: ${plural(counts.newTotal, 'new card')}, ${plural(counts.reviewTotal, 'review')}.`),
      h('div', { class: 'field-row' }, fresh.field, reviews.field),
      h('p', { class: 'muted' }, 'A change applies at once, also to today. Leave a field empty to use the default from Settings.'),
      error,
    ],
    buttons: (close) => [
      h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'),
      h('button', {
        class: 'btn btn-primary',
        type: 'button',
        onclick: () => {
          try {
            const limits = { newPerDay: fresh.read(), reviewsPerDay: reviews.read() };
            store.change((c) => setDeckLimits(c, deckId, limits));
            close();
          } catch (problem) {
            error.textContent = problem.message;
            error.hidden = false;
          }
        },
      }, 'Save'),
    ],
    onOpen: () => fresh.input.focus(),
  });
}

export async function deleteDeckDialog(deckId) {
  const { col } = store;
  const deck = col.decks.get(deckId);
  const { total } = deckCounts(col).get(deckId);
  const confirmed = await confirmDialog({
    title: `Delete “${deck.name}”?`,
    message: total
      ? `This deletes the deck with its ${plural(total, 'card')} and their review history. It cannot be undone from the app.`
      : 'The deck is empty.',
    confirmLabel: 'Delete deck',
    danger: true,
  });
  if (!confirmed) return false;
  store.change((c) => deleteDeck(c, deckId));
  toast(`Deleted “${deck.name}”.`);
  return true;
}

export async function exportMarkdown(deckId) {
  try {
    const deck = store.col.decks.get(deckId);
    const handle = await saveTextAs(fileNameFor(deck.name, 'md'), deckToMarkdown(store.col, deckId), 'markdown');
    if (handle) toast(`Exported to ${handle.name}.`);
  } catch (error) {
    reportError(error, 'The deck could not be exported');
  }
}

export async function exportJson(deckId) {
  try {
    const { col, dir } = store;
    const deck = col.decks.get(deckId);
    const images = {};
    for (const name of imagesReferencedBy(notesOfDeck(col, deckId))) {
      const file = await readImage(dir, name);
      if (file) images[name] = await blobToDataUrl(file);
    }
    const handle = await saveTextAs(fileNameFor(deck.name, 'json'), deckToJson(col, deckId, { images }), 'json');
    if (handle) toast(`Exported to ${handle.name}.`);
  } catch (error) {
    reportError(error, 'The deck could not be exported');
  }
}

async function sameBytes(a, b) {
  if (a.size !== b.size) return false;
  const [x, y] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  const u = new Uint8Array(x);
  const v = new Uint8Array(y);
  return u.every((byte, i) => byte === v[i]);
}

// Write the pictures that came inside an export file. A picture whose name is
// already taken by a different picture is stored under a new name.
async function storeImportedImages(images) {
  const renamed = new Map();
  for (const [name, dataUrl] of Object.entries(images ?? {})) {
    const blob = dataUrlToBlob(dataUrl);
    if (!blob || !isImageType(blob.type) || !isImageName(name)) continue;
    const existing = await readImage(store.dir, name);
    if (existing && (await sameBytes(existing, blob))) continue;
    let target = name;
    if (existing) {
      const dot = name.lastIndexOf('.');
      target = dot > 0 ? `${name.slice(0, dot)}-${randomId(4)}${name.slice(dot)}` : `${name}-${randomId(4)}`;
      renamed.set(name, target);
    }
    await writeImage(store.dir, target, blob);
  }
  return renamed;
}

/** Import the deck(s) of a JSON file exported by this app (or a whole data.json). */
export async function importJson() {
  let file;
  try {
    file = await openTextFile('json');
  } catch (error) {
    reportError(error, 'The file could not be read');
    return;
  }
  if (!file) return;

  let source;
  try {
    source = parseCollection(file.text);
  } catch (error) {
    await alertDialog({ title: 'This file cannot be imported', message: `${file.name}: ${error.message}` });
    return;
  }
  if (source.decks.size === 0) {
    await alertDialog({ title: 'Nothing to import', message: `${file.name} contains no decks.` });
    return;
  }

  try {
    const renameImages = await storeImportedImages(source.images);
    const result = store.change((col) => importDecks(col, source, { renameImages }));
    resetImages();
    const names = result.deckNames.map((name) => `“${name}”`).join(', ');
    toast(`Imported ${names}: ${plural(result.cards, 'card')}, ${plural(result.reviews, 'review')} of history.`, { duration: 6000 });
  } catch (error) {
    reportError(error, 'The import failed');
  }
}
