import { describe, test, assert } from './harness.js';
import {
  STATE, addDeck, addNote, cardsOfNote, createCollection, parseCollection, serializeCollection, setDeckLimits,
} from '../js/core/collection.js';
import {
  deckToJson, deckToMarkdown, entryToFields, imagesReferencedBy, importDecks, notesOfDeck,
} from '../js/core/deck-io.js';
import { parseQA } from '../js/core/qa-format.js';

const NOW = new Date(2026, 9, 1, 10, 0);

function sample() {
  const col = createCollection(NOW);
  const stats = addDeck(col, 'Statistics', NOW);
  const other = addDeck(col, 'Other', NOW);
  const notes = [
    addNote(col, stats.id, { front: 'Mean?', back: 'Sum over $n$', subtopic: 'Basics' }, NOW),
    addNote(col, stats.id, { front: 'ANOVA', back: 'Tests equal means', reversed: true, note: 'F test' }, NOW),
    addNote(col, stats.id, { front: 'Plot?', back: '![](images/img-1.png)', subtopic: 'Basics' }, NOW),
    addNote(col, other.id, { front: 'elsewhere', back: 'yes' }, NOW),
  ];
  const meanCard = cardsOfNote(col, notes[0].id)[0];
  col.cards.set(meanCard.id, { ...meanCard, state: STATE.Review, stability: 12.5, scheduledDays: 12, reps: 4 });
  col.reviews.push(
    { cardId: meanCard.id, at: '2026-09-20T08:00:00.000Z', rating: 3, state: 0, ms: 3000 },
    { cardId: cardsOfNote(col, notes[3].id)[0].id, at: '2026-09-21T08:00:00.000Z', rating: 3, state: 0, ms: 3000 },
    { cardId: meanCard.id, at: '2026-09-22T08:00:00.000Z', rating: 4, state: 2, ms: 2000 },
  );
  setDeckLimits(col, stats.id, { newPerDay: 5, reviewsPerDay: null });
  return { col, stats, other, notes, meanCard };
}

describe('Deck export: Markdown', () => {
  test('writes the deck name, subtopics, notes and the reversed mark', () => {
    const { col, stats } = sample();
    assert.equal(deckToMarkdown(col, stats.id), [
      '# Statistics',
      '',
      '**Q:** ANOVA',
      '**A:** Tests equal means',
      '**Note:** F test',
      '**Reversed:** yes',
      '',
      '## Basics',
      '',
      '**Q:** Mean?',
      '**A:** Sum over $n$',
      '',
      '**Q:** Plot?',
      '**A:** ![](images/img-1.png)',
      '',
    ].join('\n'));
  });

  test('an exported deck can be read back as the same cards', () => {
    const { col, stats } = sample();
    const { cards, problemCount, title } = parseQA(deckToMarkdown(col, stats.id));
    assert.equal(problemCount, 0);
    assert.equal(title, 'Statistics');
    const target = createCollection(NOW);
    const deck = addDeck(target, title, NOW);
    for (const card of cards) addNote(target, deck.id, entryToFields(card), NOW);
    const strip = ({ type, front, back, note, subtopic }) => ({ type, front, back, note, subtopic });
    const byFront = (a, b) => a.front.localeCompare(b.front);
    assert.deepEqual(
      [...target.notes.values()].map(strip).sort(byFront),
      notesOfDeck(col, stats.id).map(strip).sort(byFront),
    );
    assert.equal(target.cards.size, 4);
  });
});

describe('Deck export and import: JSON', () => {
  test('the export holds exactly the deck: its notes, cards and review history', () => {
    const { col, stats, meanCard } = sample();
    const exported = parseCollection(deckToJson(col, stats.id, { now: NOW }));
    assert.deepEqual([...exported.decks.values()].map((d) => d.name), ['Statistics']);
    assert.equal(exported.notes.size, 3);
    assert.equal(exported.cards.size, 4);
    assert.deepEqual(exported.reviews.map((r) => r.cardId), [meanCard.id, meanCard.id]);
  });

  test('importing gives new ids and keeps content, schedule, limits and history', () => {
    const { col, stats, meanCard } = sample();
    const exported = parseCollection(deckToJson(col, stats.id, { now: NOW }));
    const target = createCollection(NOW);
    const result = importDecks(target, exported);
    assert.deepEqual(result, { deckNames: ['Statistics'], decks: 1, notes: 3, cards: 4, reviews: 2 });

    const deck = [...target.decks.values()][0];
    assert.notEqual(deck.id, stats.id);
    assert.equal(deck.newPerDay, 5);
    const imported = [...target.cards.values()].find((c) => c.state === STATE.Review);
    assert.notEqual(imported.id, meanCard.id);
    assert.equal(imported.stability, 12.5);
    assert.equal(imported.deckId, deck.id);
    assert.equal(target.notes.get(imported.noteId).front, 'Mean?');
    assert.deepEqual(target.reviews.map((r) => [r.cardId, r.rating]), [[imported.id, 3], [imported.id, 4]]);
    // The reversed note still has its two cards.
    const anova = [...target.notes.values()].find((n) => n.front === 'ANOVA');
    assert.deepEqual(cardsOfNote(target, anova.id).map((c) => c.ord), [0, 1]);
  });

  test('importing into the same collection adds a copy and renames it', () => {
    const { col, stats } = sample();
    const before = { notes: col.notes.size, cards: col.cards.size, reviews: col.reviews.length };
    const text = deckToJson(col, stats.id, { now: NOW });
    importDecks(col, parseCollection(text));
    importDecks(col, parseCollection(text));
    assert.deepEqual([...col.decks.values()].map((d) => d.name), ['Statistics', 'Other', 'Statistics (2)', 'Statistics (3)']);
    assert.equal(col.notes.size, before.notes + 6);
    assert.equal(col.cards.size, before.cards + 8);
    assert.equal(col.reviews.length, before.reviews + 4);
    const times = col.reviews.map((r) => r.at);
    assert.deepEqual(times, [...times].sort(), 'the history stays in time order');
  });

  test('the collection is still a valid data file after an import', () => {
    const { col, stats } = sample();
    importDecks(col, parseCollection(deckToJson(col, stats.id, { now: NOW })));
    const back = parseCollection(serializeCollection(col, { savedAt: NOW }));
    assert.equal(back.cards.size, col.cards.size);
    assert.equal(back.reviews.length, col.reviews.length);
    const copy = parseCollection(deckToJson(col, [...col.decks.keys()][2], { now: NOW }));
    assert.equal(copy.cards.size, 4);
  });
});

describe('Deck export and import: pictures', () => {
  test('finds the pictures a deck refers to', () => {
    const { col, stats } = sample();
    const html = addNote(col, stats.id, { front: 'html', back: '<img src="images/photo_2.jpg" width="200">' }, NOW);
    assert.ok(html);
    assert.deepEqual([...imagesReferencedBy(notesOfDeck(col, stats.id))].sort(), ['img-1.png', 'photo_2.jpg']);
  });

  test('pictures travel inside the export and are offered back on import', () => {
    const { col, stats } = sample();
    const text = deckToJson(col, stats.id, { now: NOW, images: { 'img-1.png': 'data:image/png;base64,AAAA' } });
    const exported = parseCollection(text);
    assert.deepEqual(exported.images, { 'img-1.png': 'data:image/png;base64,AAAA' });
  });

  test('a picture renamed on import is renamed in the cards too', () => {
    const { col, stats } = sample();
    const exported = parseCollection(deckToJson(col, stats.id, { now: NOW }));
    const target = createCollection(NOW);
    importDecks(target, exported, { renameImages: new Map([['img-1.png', 'img-1-2.png']]) });
    const plot = [...target.notes.values()].find((n) => n.front === 'Plot?');
    assert.equal(plot.back, '![](images/img-1-2.png)');
  });
});
