import { describe, test, assert } from './harness.js';
import {
  DEFAULT_SETTINGS, STATE, addDeck, addNote, cardFaces, cardsOfNote, createCollection, deckLimits,
  deleteDeck, deleteNote, freeDeckName, normalizeSettings, parseCollection, parseSteps, renameDeck,
  serializeCollection, setDeckLimits, setSuspended, updateNote, updateSettings,
} from '../js/core/collection.js';

const NOW = new Date(2026, 9, 1, 10, 0);

function sample() {
  const col = createCollection(NOW);
  const stats = addDeck(col, 'Statistics', NOW);
  const dutch = addDeck(col, 'Dutch', NOW);
  const mean = addNote(col, stats.id, { front: 'Mean?', back: 'Sum over n', subtopic: 'Basics' }, NOW);
  const anova = addNote(col, stats.id, { front: 'ANOVA', back: 'Tests equal means', reversed: true, note: 'F test' }, NOW);
  const huis = addNote(col, dutch.id, { front: 'huis', back: 'house' }, NOW);
  return { col, stats, dutch, mean, anova, huis };
}

describe('Decks', () => {
  test('names are trimmed and must be unique, whatever the case', () => {
    const col = createCollection(NOW);
    const deck = addDeck(col, '  My   deck ', NOW);
    assert.equal(deck.name, 'My deck');
    assert.throws(() => addDeck(col, 'my DECK'), /already exists/);
    assert.throws(() => addDeck(col, '   '), /name/);
  });

  test('renaming keeps the deck and checks the new name', () => {
    const { col, stats, dutch } = sample();
    renameDeck(col, stats.id, 'Stats');
    assert.equal(col.decks.get(stats.id).name, 'Stats');
    renameDeck(col, stats.id, 'stats');
    assert.throws(() => renameDeck(col, dutch.id, 'STATS'), /already exists/);
  });

  test('freeDeckName adds a number when the name is taken', () => {
    const { col } = sample();
    assert.equal(freeDeckName(col, 'History'), 'History');
    assert.equal(freeDeckName(col, 'Dutch'), 'Dutch (2)');
    addDeck(col, 'Dutch (2)');
    assert.equal(freeDeckName(col, 'dutch'), 'dutch (3)');
  });

  test('daily limits fall back to the defaults until set for the deck', () => {
    const { col, stats } = sample();
    assert.deepEqual(deckLimits(col, col.decks.get(stats.id)), { newPerDay: 20, reviewsPerDay: 200 });
    setDeckLimits(col, stats.id, { newPerDay: 5, reviewsPerDay: null });
    assert.deepEqual(deckLimits(col, col.decks.get(stats.id)), { newPerDay: 5, reviewsPerDay: 200 });
    updateSettings(col, { reviewsPerDay: 50 });
    assert.deepEqual(deckLimits(col, col.decks.get(stats.id)), { newPerDay: 5, reviewsPerDay: 50 });
    assert.throws(() => setDeckLimits(col, stats.id, { newPerDay: -1, reviewsPerDay: null }), /whole number/);
    assert.throws(() => setDeckLimits(col, stats.id, { newPerDay: 1.5, reviewsPerDay: null }), /whole number/);
  });

  test('deleting a deck removes its cards, notes and reviews, and nothing else', () => {
    const { col, stats, dutch, huis, mean } = sample();
    const meanCard = cardsOfNote(col, mean.id)[0];
    const huisCard = cardsOfNote(col, huis.id)[0];
    col.reviews.push(
      { cardId: meanCard.id, at: NOW.toISOString(), rating: 3, state: 0, ms: 1000 },
      { cardId: huisCard.id, at: NOW.toISOString(), rating: 3, state: 0, ms: 1000 },
    );
    deleteDeck(col, stats.id);
    assert.deepEqual([...col.decks.keys()], [dutch.id]);
    assert.deepEqual([...col.notes.keys()], [huis.id]);
    assert.deepEqual([...col.cards.values()].map((c) => c.id), [huisCard.id]);
    assert.deepEqual(col.reviews.map((r) => r.cardId), [huisCard.id]);
  });
});

describe('Notes and cards', () => {
  test('a basic note has one new card, a reversed note two', () => {
    const { col, mean, anova, stats } = sample();
    const one = cardsOfNote(col, mean.id);
    assert.equal(one.length, 1);
    assert.equal(one[0].state, STATE.New);
    assert.equal(one[0].deckId, stats.id);
    assert.equal(col.notes.get(mean.id).type, 'basic');
    const two = cardsOfNote(col, anova.id);
    assert.deepEqual(two.map((c) => c.ord), [0, 1]);
    assert.equal(col.notes.get(anova.id).type, 'reversed');
  });

  test('the reversed card swaps the two sides', () => {
    const { col, anova } = sample();
    const [forward, backward] = cardsOfNote(col, anova.id);
    const note = col.notes.get(anova.id);
    assert.deepEqual(cardFaces(note, forward), { front: 'ANOVA', back: 'Tests equal means' });
    assert.deepEqual(cardFaces(note, backward), { front: 'Tests equal means', back: 'ANOVA' });
  });

  test('a note needs both a question and an answer', () => {
    const { col, stats } = sample();
    assert.throws(() => addNote(col, stats.id, { front: ' ', back: 'x' }), /question is empty/);
    assert.throws(() => addNote(col, stats.id, { front: 'x', back: '' }), /answer is empty/);
    assert.throws(() => addNote(col, 'd_missing', { front: 'x', back: 'y' }), /Deck not found/);
  });

  test('editing changes the text and keeps the card and its schedule', () => {
    const { col, mean } = sample();
    const before = cardsOfNote(col, mean.id)[0];
    updateNote(col, mean.id, { front: 'Arithmetic mean?', back: 'Sum over n', subtopic: 'Basics' }, new Date(2026, 9, 2));
    assert.equal(col.notes.get(mean.id).front, 'Arithmetic mean?');
    assert.equal(cardsOfNote(col, mean.id)[0], before);
  });

  test('turning reversed on adds the second card; off removes it with its history', () => {
    const { col, mean } = sample();
    updateNote(col, mean.id, { front: 'Mean?', back: 'Sum over n', reversed: true }, NOW);
    const cards = cardsOfNote(col, mean.id);
    assert.deepEqual(cards.map((c) => c.ord), [0, 1]);
    assert.equal(cards[1].deckId, cards[0].deckId);
    col.reviews.push(
      { cardId: cards[0].id, at: NOW.toISOString(), rating: 3, state: 0, ms: 1 },
      { cardId: cards[1].id, at: NOW.toISOString(), rating: 3, state: 0, ms: 1 },
    );
    updateNote(col, mean.id, { front: 'Mean?', back: 'Sum over n', reversed: false }, NOW);
    assert.deepEqual(cardsOfNote(col, mean.id).map((c) => c.id), [cards[0].id]);
    assert.deepEqual(col.reviews.map((r) => r.cardId), [cards[0].id]);
  });

  test('deleting a note removes all its cards and their reviews', () => {
    const { col, anova } = sample();
    const cards = cardsOfNote(col, anova.id);
    col.reviews.push({ cardId: cards[1].id, at: NOW.toISOString(), rating: 1, state: 0, ms: 1 });
    deleteNote(col, anova.id);
    assert.equal(col.notes.has(anova.id), false);
    assert.equal(cardsOfNote(col, anova.id).length, 0);
    assert.equal(col.reviews.length, 0);
  });

  test('suspending replaces the card record instead of changing it', () => {
    const { col, mean } = sample();
    const before = cardsOfNote(col, mean.id)[0];
    setSuspended(col, before.id, true);
    const after = col.cards.get(before.id);
    assert.equal(after.suspended, true);
    assert.equal(before.suspended, false);
  });
});

describe('Settings', () => {
  test('out-of-range values are brought back into range', () => {
    const s = normalizeSettings({ newPerDay: -3, reviewsPerDay: 1e9, desiredRetention: 0.999, learningSteps: ['x'] });
    assert.equal(s.newPerDay, 0);
    assert.equal(s.reviewsPerDay, 9999);
    assert.equal(s.desiredRetention, 0.97);
    assert.deepEqual(s.learningSteps, ['1m', '10m']);
    assert.deepEqual(normalizeSettings(undefined), { ...DEFAULT_SETTINGS, learningSteps: ['1m', '10m'], relearningSteps: ['10m'] });
  });

  test('learning steps are read from text', () => {
    assert.deepEqual(parseSteps('1m 10m'), ['1m', '10m']);
    assert.deepEqual(parseSteps(' 15m, 1h ,2d '), ['15m', '1h', '2d']);
    assert.deepEqual(parseSteps(''), []);
    assert.equal(parseSteps('10'), null);
    assert.equal(parseSteps('0m'), null);
    assert.equal(parseSteps('1.5h'), null);
  });
});

describe('Data file: writing and reading', () => {
  test('what is written reads back identical', () => {
    const { col, mean } = sample();
    setDeckLimits(col, [...col.decks.keys()][0], { newPerDay: 7, reviewsPerDay: 70 });
    col.reviews.push({ cardId: cardsOfNote(col, mean.id)[0].id, at: NOW.toISOString(), rating: 3, state: 0, ms: 4200 });
    const text = serializeCollection(col, { savedAt: NOW });
    const back = parseCollection(text);
    assert.equal(back.id, col.id);
    assert.deepEqual(back.settings, col.settings);
    assert.deepEqual(back.decks, col.decks);
    assert.deepEqual(back.notes, col.notes);
    assert.deepEqual(back.cards, col.cards);
    assert.deepEqual(back.reviews, col.reviews);
    assert.equal(serializeCollection(back, { savedAt: NOW }), text);
  });

  test('the file has one record per line', () => {
    const { col } = sample();
    const lines = serializeCollection(col, { savedAt: NOW }).split('\n');
    const cardLines = lines.filter((l) => l.startsWith('{"id":"c_'));
    assert.equal(cardLines.length, col.cards.size);
    assert.ok(lines.includes('"format": "simple-flashcards",'));
    assert.ok(lines.includes('"reviews": []'));
  });

  test('an empty collection is valid', () => {
    const col = createCollection(NOW);
    const back = parseCollection(serializeCollection(col, { savedAt: NOW }));
    assert.equal(back.decks.size, 0);
    assert.equal(back.reviews.length, 0);
  });

  test('refuses what is not a data file', () => {
    assert.throws(() => parseCollection('{not json'), /not valid JSON/);
    assert.throws(() => parseCollection('{"some":"thing"}'), /not a flashcards data file/);
    assert.throws(() => parseCollection('[]'), /not a flashcards data file/);
  });

  test('refuses a file written by a newer version', () => {
    const { col } = sample();
    const text = serializeCollection(col, { savedAt: NOW }).replace('"version": 1', '"version": 99');
    assert.throws(() => parseCollection(text), /newer version/);
  });

  test('refuses records that do not hold together', () => {
    const { col } = sample();
    const raw = JSON.parse(serializeCollection(col, { savedAt: NOW }));
    const broken = (change) => {
      const copy = structuredClone(raw);
      change(copy);
      return JSON.stringify(copy);
    };
    assert.throws(() => parseCollection(broken((r) => { r.cards[0].noteId = 'n_missing'; })), /note that does not exist/);
    assert.throws(() => parseCollection(broken((r) => { r.cards[0].deckId = 'd_missing'; })), /deck that does not exist/);
    assert.throws(() => parseCollection(broken((r) => { r.cards[1].id = r.cards[0].id; })), /twice/);
    assert.throws(() => parseCollection(broken((r) => { r.cards[0].state = 9; })), /state is not valid/);
    assert.throws(() => parseCollection(broken((r) => { r.cards[0].due = 'soon'; })), /not a date/);
    assert.throws(() => parseCollection(broken((r) => { delete r.notes; })), /“notes” is missing/);
    assert.throws(() => parseCollection(broken((r) => { r.reviews = [{ cardId: 'c', at: NOW.toISOString(), rating: 7, state: 0 }]; })), /rating is not valid/);
  });

  test('keeps fields it does not know, so a newer file is not damaged', () => {
    const { col } = sample();
    const raw = JSON.parse(serializeCollection(col, { savedAt: NOW }));
    raw.futureThing = { a: 1 };
    raw.notes[0].tags = ['x'];
    const back = parseCollection(JSON.stringify(raw));
    const again = JSON.parse(serializeCollection(back, { savedAt: NOW }));
    assert.deepEqual(again.futureThing, { a: 1 });
    assert.deepEqual(again.notes[0].tags, ['x']);
  });

  test('dates in other notations are normalised and reviews put in time order', () => {
    const { col, mean } = sample();
    const cardId = cardsOfNote(col, mean.id)[0].id;
    const raw = JSON.parse(serializeCollection(col, { savedAt: NOW }));
    raw.cards[0].due = '2026-10-03T08:00:00+02:00';
    raw.reviews = [
      { cardId, at: '2026-10-02T10:00:00.000Z', rating: 3, state: 1, ms: 1 },
      { cardId, at: '2026-10-01T10:00:00Z', rating: 3, state: 0, ms: 1 },
    ];
    const back = parseCollection(JSON.stringify(raw));
    assert.equal([...back.cards.values()][0].due, '2026-10-03T06:00:00.000Z');
    assert.deepEqual(back.reviews.map((r) => r.at), ['2026-10-01T10:00:00.000Z', '2026-10-02T10:00:00.000Z']);
  });
});
