// Getting decks out of and into a collection: as a Markdown Q&A document
// (content only) or as JSON in the data-file format (with review history).

import { newId } from './ids.js';
import { freeDeckName, serializeCollection } from './collection.js';
import { serializeQA } from './qa-format.js';

/** The notes that have at least one card in the deck, in the order they were added. */
export function notesOfDeck(col, deckId) {
  const ids = new Set();
  for (const card of col.cards.values()) if (card.deckId === deckId) ids.add(card.noteId);
  const notes = [];
  for (const note of col.notes.values()) if (ids.has(note.id)) notes.push(note);
  return notes;
}

export function noteToEntry(note) {
  return {
    question: note.front,
    answer: note.back,
    note: note.note || '',
    subtopic: note.subtopic || '',
    reversed: note.type === 'reversed',
  };
}

export function entryToFields(entry) {
  return {
    front: entry.question,
    back: entry.answer,
    note: entry.note || '',
    subtopic: entry.subtopic || '',
    reversed: Boolean(entry.reversed),
  };
}

export function deckToMarkdown(col, deckId) {
  const deck = col.decks.get(deckId);
  if (!deck) throw new Error('Deck not found.');
  return serializeQA(notesOfDeck(col, deckId).map(noteToEntry), { title: deck.name });
}

// `![alt](images/name.png)` in Markdown or `<img src="images/name.png">` in HTML.
const RE_IMAGE_REF = /images\/([A-Za-z0-9][A-Za-z0-9._-]*)/g;

export function imagesReferencedBy(notes) {
  const names = new Set();
  for (const note of notes) {
    for (const text of [note.front, note.back, note.note]) {
      if (!text || !text.includes('images/')) continue;
      for (const match of text.matchAll(RE_IMAGE_REF)) names.add(match[1]);
    }
  }
  return names;
}

/** A collection holding only the given decks, with their notes, cards and reviews. */
export function subsetOfDecks(col, deckIds) {
  const wanted = new Set(deckIds);
  const decks = new Map();
  for (const id of wanted) {
    const deck = col.decks.get(id);
    if (!deck) throw new Error('Deck not found.');
    decks.set(id, deck);
  }
  const cards = new Map();
  const noteIds = new Set();
  for (const card of col.cards.values()) {
    if (wanted.has(card.deckId)) {
      cards.set(card.id, card);
      noteIds.add(card.noteId);
    }
  }
  const notes = new Map();
  for (const note of col.notes.values()) if (noteIds.has(note.id)) notes.set(note.id, note);
  return {
    id: col.id,
    createdAt: col.createdAt,
    settings: col.settings,
    decks,
    notes,
    cards,
    reviews: col.reviews.filter((r) => cards.has(r.cardId)),
    extra: {},
  };
}

/** JSON text of one deck, in the data-file format. `images` maps file name → data URL. */
export function deckToJson(col, deckId, { images = null, now = new Date() } = {}) {
  return serializeCollection(subsetOfDecks(col, [deckId]), { savedAt: now, images });
}

/**
 * Add every deck of `source` (a parsed collection) to `col`.
 * Imported records get new ids, so importing the same file twice gives two
 * independent copies and never overwrites anything. A deck whose name is
 * taken is renamed `Name (2)`. `renameImages` (old name → new name) rewrites
 * image references in the imported notes.
 */
export function importDecks(col, source, { renameImages = null } = {}) {
  const deckIds = new Map();
  const noteIds = new Map();
  const cardIds = new Map();
  const names = [];

  for (const deck of source.decks.values()) {
    const id = newId('d');
    const name = freeDeckName(col, deck.name);
    deckIds.set(deck.id, id);
    col.decks.set(id, { ...deck, id, name });
    names.push(name);
  }

  const rename = renameImages && renameImages.size
    ? (text) => (text && text.includes('images/')
      ? text.replace(RE_IMAGE_REF, (whole, name) => (renameImages.has(name) ? `images/${renameImages.get(name)}` : whole))
      : text)
    : (text) => text;

  // A note is imported only if one of its cards is.
  const usedNotes = new Set();
  for (const card of source.cards.values()) usedNotes.add(card.noteId);
  for (const note of source.notes.values()) {
    if (!usedNotes.has(note.id)) continue;
    const id = newId('n');
    noteIds.set(note.id, id);
    col.notes.set(id, { ...note, id, front: rename(note.front), back: rename(note.back), note: rename(note.note) });
  }

  for (const card of source.cards.values()) {
    const id = newId('c');
    cardIds.set(card.id, id);
    col.cards.set(id, { ...card, id, noteId: noteIds.get(card.noteId), deckId: deckIds.get(card.deckId) });
  }

  let reviews = 0;
  for (const review of source.reviews) {
    const cardId = cardIds.get(review.cardId);
    if (!cardId) continue;
    col.reviews.push({ ...review, cardId });
    reviews++;
  }
  if (reviews) col.reviews.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  return { deckNames: names, decks: deckIds.size, notes: noteIds.size, cards: cardIds.size, reviews };
}
