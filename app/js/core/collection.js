// The collection is everything stored in the data file: settings, decks,
// notes, cards and the review history.
//
// A note is the content the user wrote (front, back). A card is one direction
// of a note that gets scheduled: a basic note has one card, a reversed note two.
// This is the same split Anki uses.
//
// Records are never modified in place: a change puts a new object in the map.
// Serialisation relies on that to reuse the text of unchanged records.

import { newId } from './ids.js';
import { iso } from './time.js';

export const FORMAT = 'simple-flashcards';
export const VERSION = 1;

export const STATE = Object.freeze({ New: 0, Learning: 1, Review: 2, Relearning: 3 });

export const DEFAULT_SETTINGS = Object.freeze({
  newPerDay: 20,
  reviewsPerDay: 200,
  desiredRetention: 0.9,
  learningSteps: Object.freeze(['1m', '10m']),
  relearningSteps: Object.freeze(['10m']),
});

export const LIMITS = Object.freeze({
  perDayMax: 9999,
  retentionMin: 0.7,
  retentionMax: 0.97,
});

export class DataError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DataError';
  }
}

const RE_STEP = /^[1-9]\d*[mhd]$/;
const RE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function fail(message) {
  throw new DataError(message);
}

export function isValidSteps(steps) {
  return Array.isArray(steps) && steps.every((s) => typeof s === 'string' && RE_STEP.test(s));
}

/** Parse `"1m 10m"` into `['1m', '10m']`; returns null when a step is not valid. */
export function parseSteps(text) {
  const steps = String(text).trim().split(/[\s,]+/).filter(Boolean);
  return isValidSteps(steps) ? steps : null;
}

function clampInt(value, min, max, fallback) {
  return isInt(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function normalizeSettings(input) {
  const s = { ...DEFAULT_SETTINGS, ...(isObject(input) ? input : {}) };
  s.newPerDay = clampInt(s.newPerDay, 0, LIMITS.perDayMax, DEFAULT_SETTINGS.newPerDay);
  s.reviewsPerDay = clampInt(s.reviewsPerDay, 0, LIMITS.perDayMax, DEFAULT_SETTINGS.reviewsPerDay);
  s.desiredRetention = isNum(s.desiredRetention)
    ? Math.min(LIMITS.retentionMax, Math.max(LIMITS.retentionMin, s.desiredRetention))
    : DEFAULT_SETTINGS.desiredRetention;
  s.learningSteps = isValidSteps(s.learningSteps) ? [...s.learningSteps] : [...DEFAULT_SETTINGS.learningSteps];
  s.relearningSteps = isValidSteps(s.relearningSteps) ? [...s.relearningSteps] : [...DEFAULT_SETTINGS.relearningSteps];
  return s;
}

export function createCollection(now = new Date()) {
  return {
    id: newId('col'),
    createdAt: iso(now),
    settings: normalizeSettings(),
    decks: new Map(),
    notes: new Map(),
    cards: new Map(),
    reviews: [],
    extra: {},
  };
}

// ---------------------------------------------------------------- decks

function cleanName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim();
}

function assertNameFree(col, name, exceptId = null) {
  if (!name) throw new Error('Give the deck a name.');
  const wanted = name.toLowerCase();
  for (const deck of col.decks.values()) {
    if (deck.id !== exceptId && deck.name.toLowerCase() === wanted) {
      throw new Error(`A deck named “${deck.name}” already exists.`);
    }
  }
}

/** A name not used by any deck yet: `Name`, `Name (2)`, `Name (3)`… */
export function freeDeckName(col, name) {
  const base = cleanName(name) || 'Deck';
  const taken = new Set([...col.decks.values()].map((d) => d.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export function addDeck(col, name, now = new Date()) {
  const clean = cleanName(name);
  assertNameFree(col, clean);
  const deck = { id: newId('d'), name: clean, createdAt: iso(now), newPerDay: null, reviewsPerDay: null };
  col.decks.set(deck.id, deck);
  return deck;
}

export function renameDeck(col, deckId, name) {
  const deck = col.decks.get(deckId);
  if (!deck) throw new Error('Deck not found.');
  const clean = cleanName(name);
  assertNameFree(col, clean, deckId);
  col.decks.set(deckId, { ...deck, name: clean });
}

function limitValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!isInt(value) || value < 0 || value > LIMITS.perDayMax) {
    throw new Error(`A daily limit must be a whole number between 0 and ${LIMITS.perDayMax}.`);
  }
  return value;
}

/** Per-deck daily limits; `null` means "use the default from the settings". */
export function setDeckLimits(col, deckId, { newPerDay, reviewsPerDay }) {
  const deck = col.decks.get(deckId);
  if (!deck) throw new Error('Deck not found.');
  col.decks.set(deckId, { ...deck, newPerDay: limitValue(newPerDay), reviewsPerDay: limitValue(reviewsPerDay) });
}

export function deckLimits(col, deck) {
  return {
    newPerDay: deck.newPerDay ?? col.settings.newPerDay,
    reviewsPerDay: deck.reviewsPerDay ?? col.settings.reviewsPerDay,
  };
}

/** Delete a deck with its cards, their review history, and notes left without cards. */
export function deleteDeck(col, deckId) {
  if (!col.decks.has(deckId)) return;
  const removed = new Set();
  const touchedNotes = new Set();
  for (const card of col.cards.values()) {
    if (card.deckId === deckId) {
      removed.add(card.id);
      touchedNotes.add(card.noteId);
    }
  }
  for (const id of removed) col.cards.delete(id);
  for (const card of col.cards.values()) touchedNotes.delete(card.noteId);
  for (const id of touchedNotes) col.notes.delete(id);
  if (removed.size) col.reviews = col.reviews.filter((r) => !removed.has(r.cardId));
  col.decks.delete(deckId);
}

// ---------------------------------------------------------------- notes and cards

function makeCard(noteId, deckId, ord, now) {
  return {
    id: newId('c'),
    noteId,
    deckId,
    ord,
    state: STATE.New,
    due: iso(now),
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    lastReview: null,
    suspended: false,
  };
}

function cleanFields(fields) {
  const front = String(fields.front ?? '').trim();
  const back = String(fields.back ?? '').trim();
  if (!front) throw new Error('The question is empty.');
  if (!back) throw new Error('The answer is empty.');
  return {
    front,
    back,
    note: String(fields.note ?? '').trim(),
    subtopic: cleanName(fields.subtopic),
  };
}

/** Add a note to a deck: one card, or two when `reversed`. Returns the note. */
export function addNote(col, deckId, fields, now = new Date()) {
  if (!col.decks.has(deckId)) throw new Error('Deck not found.');
  const note = {
    id: newId('n'),
    type: fields.reversed ? 'reversed' : 'basic',
    ...cleanFields(fields),
    createdAt: iso(now),
    updatedAt: iso(now),
  };
  col.notes.set(note.id, note);
  const count = fields.reversed ? 2 : 1;
  for (let ord = 0; ord < count; ord++) {
    const card = makeCard(note.id, deckId, ord, now);
    col.cards.set(card.id, card);
  }
  return note;
}

export function cardsOfNote(col, noteId) {
  const cards = [];
  for (const card of col.cards.values()) if (card.noteId === noteId) cards.push(card);
  return cards.sort((a, b) => a.ord - b.ord);
}

/**
 * Change a note's content. Turning `reversed` on adds the second card as new;
 * turning it off deletes that card and its history.
 */
export function updateNote(col, noteId, fields, now = new Date()) {
  const note = col.notes.get(noteId);
  if (!note) throw new Error('Card not found.');
  const reversed = Boolean(fields.reversed);
  col.notes.set(noteId, {
    ...note,
    ...cleanFields(fields),
    type: reversed ? 'reversed' : 'basic',
    updatedAt: iso(now),
  });
  const cards = cardsOfNote(col, noteId);
  const second = cards.find((c) => c.ord === 1);
  if (reversed && !second && cards.length) {
    const card = makeCard(noteId, cards[0].deckId, 1, now);
    col.cards.set(card.id, card);
  } else if (!reversed && second) {
    col.cards.delete(second.id);
    col.reviews = col.reviews.filter((r) => r.cardId !== second.id);
  }
}

export function deleteNote(col, noteId) {
  const removed = new Set(cardsOfNote(col, noteId).map((c) => c.id));
  for (const id of removed) col.cards.delete(id);
  if (removed.size) col.reviews = col.reviews.filter((r) => !removed.has(r.cardId));
  col.notes.delete(noteId);
}

/** What a card shows: the reversed card (ord 1) swaps the note's two sides. */
export function cardFaces(note, card) {
  return card.ord === 1
    ? { front: note.back, back: note.front }
    : { front: note.front, back: note.back };
}

export function setSuspended(col, cardId, suspended) {
  const card = col.cards.get(cardId);
  if (!card) throw new Error('Card not found.');
  col.cards.set(cardId, { ...card, suspended: Boolean(suspended) });
}

export function updateSettings(col, patch) {
  col.settings = normalizeSettings({ ...col.settings, ...patch });
}

// ---------------------------------------------------------------- reading and writing

const lineCache = new WeakMap();

function recordLine(record) {
  let line = lineCache.get(record);
  if (line === undefined) {
    line = JSON.stringify(record);
    lineCache.set(record, line);
  }
  return line;
}

function arrayBlock(key, records) {
  const lines = [];
  for (const record of records) lines.push(recordLine(record));
  return lines.length ? `"${key}": [\n${lines.join(',\n')}\n]` : `"${key}": []`;
}

/**
 * The collection as JSON text, one record per line so that the file stays
 * readable and compares well between versions.
 * `images` (file name → data URL) is only used by deck export files.
 */
export function serializeCollection(col, { savedAt = new Date(), images = null } = {}) {
  const parts = [
    `"format": ${JSON.stringify(FORMAT)}`,
    `"version": ${VERSION}`,
    `"id": ${JSON.stringify(col.id)}`,
    `"createdAt": ${JSON.stringify(col.createdAt)}`,
    `"savedAt": ${JSON.stringify(iso(savedAt))}`,
    `"settings": ${JSON.stringify(col.settings)}`,
  ];
  for (const [key, value] of Object.entries(col.extra ?? {})) {
    parts.push(`${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  }
  parts.push(
    arrayBlock('decks', col.decks.values()),
    arrayBlock('notes', col.notes.values()),
    arrayBlock('cards', col.cards.values()),
    arrayBlock('reviews', col.reviews),
  );
  if (images && Object.keys(images).length) parts.push(`"images": ${JSON.stringify(images)}`);
  return `{\n${parts.join(',\n')}\n}\n`;
}

function canonDate(value, where) {
  if (typeof value !== 'string') fail(`${where} is not a date.`);
  if (RE_ISO.test(value)) return value;
  const time = Date.parse(value);
  if (Number.isNaN(time)) fail(`${where} is not a date.`);
  return new Date(time).toISOString();
}

// Returns the record itself when its dates are already canonical, so that
// unknown fields written by a newer version survive a load and save.
function withDates(record, keys, where) {
  let out = record;
  for (const key of keys) {
    if (record[key] === null || record[key] === undefined) continue;
    const fixed = canonDate(record[key], `${where}.${key}`);
    if (fixed !== record[key]) {
      if (out === record) out = { ...record };
      out[key] = fixed;
    }
  }
  return out;
}

function readRecords(raw, key, check) {
  const list = raw[key];
  if (!Array.isArray(list)) fail(`“${key}” is missing.`);
  return list.map((record, index) => {
    const where = `${key}[${index}]`;
    if (!isObject(record)) fail(`${where} is not a record.`);
    return check(record, where);
  });
}

function toMap(records, key) {
  const map = new Map();
  for (const record of records) {
    if (typeof record.id !== 'string' || !record.id) fail(`A record in “${key}” has no id.`);
    if (map.has(record.id)) fail(`“${key}” contains the id ${record.id} twice.`);
    map.set(record.id, record);
  }
  return map;
}

const KNOWN_KEYS = new Set([
  'format', 'version', 'id', 'createdAt', 'savedAt', 'settings', 'decks', 'notes', 'cards', 'reviews', 'images',
]);

/** Build a collection from parsed JSON, refusing anything that does not hold together. */
export function collectionFromObject(raw) {
  if (!isObject(raw) || raw.format !== FORMAT) fail('This is not a flashcards data file.');
  if (!isInt(raw.version) || raw.version < 1) fail('The data file has no valid version number.');
  if (raw.version > VERSION) {
    fail('The data file was written by a newer version of the app. Update the app (git pull) and try again.');
  }

  const decks = toMap(readRecords(raw, 'decks', (deck, where) => {
    if (typeof deck.name !== 'string' || !deck.name.trim()) fail(`${where} has no name.`);
    for (const key of ['newPerDay', 'reviewsPerDay']) {
      if (deck[key] !== null && deck[key] !== undefined && !(isInt(deck[key]) && deck[key] >= 0)) {
        fail(`${where}.${key} is not a valid limit.`);
      }
    }
    return withDates(deck, ['createdAt'], where);
  }), 'decks');

  const notes = toMap(readRecords(raw, 'notes', (note, where) => {
    if (typeof note.front !== 'string' || typeof note.back !== 'string') fail(`${where} has no front or back.`);
    return withDates(note, ['createdAt', 'updatedAt'], where);
  }), 'notes');

  const cards = toMap(readRecords(raw, 'cards', (card, where) => {
    if (!notes.has(card.noteId)) fail(`${where} belongs to a note that does not exist.`);
    if (!decks.has(card.deckId)) fail(`${where} belongs to a deck that does not exist.`);
    if (![0, 1, 2, 3].includes(card.state)) fail(`${where}.state is not valid.`);
    if (card.ord !== 0 && card.ord !== 1) fail(`${where}.ord is not valid.`);
    for (const key of ['stability', 'difficulty', 'elapsedDays', 'scheduledDays', 'learningSteps', 'reps', 'lapses']) {
      if (!isNum(card[key])) fail(`${where}.${key} is not a number.`);
    }
    if (typeof card.due !== 'string') fail(`${where}.due is missing.`);
    return withDates(card, ['due', 'lastReview'], where);
  }), 'cards');

  const reviews = readRecords(raw, 'reviews', (review, where) => {
    if (typeof review.cardId !== 'string') fail(`${where} has no card.`);
    if (![1, 2, 3, 4].includes(review.rating)) fail(`${where}.rating is not valid.`);
    if (![0, 1, 2, 3].includes(review.state)) fail(`${where}.state is not valid.`);
    if (typeof review.at !== 'string') fail(`${where}.at is missing.`);
    return withDates(review, ['at'], where);
  });
  // Today's tallies read the history from the end, so it must be in time order.
  if (reviews.some((r, i) => i > 0 && r.at < reviews[i - 1].at)) {
    reviews.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }

  const extra = {};
  for (const [key, value] of Object.entries(raw)) if (!KNOWN_KEYS.has(key)) extra[key] = value;

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId('col'),
    createdAt: raw.createdAt ? canonDate(raw.createdAt, 'createdAt') : iso(new Date()),
    settings: normalizeSettings(raw.settings),
    decks,
    notes,
    cards,
    reviews,
    extra,
    images: isObject(raw.images) ? raw.images : null,
  };
}

export function parseCollection(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new DataError(`The file is not valid JSON (${error.message}).`);
  }
  return collectionFromObject(raw);
}
