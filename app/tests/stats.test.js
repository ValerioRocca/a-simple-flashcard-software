import { describe, test, assert } from './harness.js';
import { STATE, addDeck, addNote, cardsOfNote, createCollection, setSuspended } from '../js/core/collection.js';
import { forecast, todaySummary } from '../js/core/stats.js';

const at = (day, hour = 10, minute = 0) => new Date(2026, 9, day, hour, minute);

function collection() {
  const col = createCollection(at(1));
  const deck = addDeck(col, 'Deck', at(1));
  const cards = [];
  for (let i = 0; i < 6; i++) {
    const note = addNote(col, deck.id, { front: `q${i}`, back: `a${i}` }, at(1));
    cards.push(cardsOfNote(col, note.id)[0]);
  }
  return { col, deck, cards };
}

const review = (cardId, when, rating, ms) => ({ cardId, at: when.toISOString(), rating, state: STATE.Review, ms });

const setDue = (col, card, due, state = STATE.Review) => {
  col.cards.set(card.id, { ...col.cards.get(card.id), state, due: due.toISOString() });
};

describe('Statistics: today', () => {
  test('counts reviews, distinct cards, time and correct answers since 04:00', () => {
    const { col, cards } = collection();
    col.reviews.push(
      review(cards[0].id, at(5, 3, 30), 3, 9000),   // before 04:00: yesterday's study day
      review(cards[0].id, at(5, 8, 0), 1, 4000),
      review(cards[0].id, at(5, 8, 5), 3, 6000),
      review(cards[1].id, at(5, 9, 0), 4, 10_000),
      review(cards[2].id, at(5, 9, 1), 2, 20_000),
    );
    const summary = todaySummary(col, at(5, 12));
    assert.equal(summary.reviews, 4);
    assert.equal(summary.cards, 3);
    assert.equal(summary.correct, 3);
    assert.equal(summary.correctShare, 0.75);
    assert.equal(summary.ms, 40_000);
  });

  test('a card left open for long counts for one minute at most', () => {
    const { col, cards } = collection();
    col.reviews.push(review(cards[0].id, at(5, 8), 3, 3_600_000));
    assert.equal(todaySummary(col, at(5, 12)).ms, 60_000);
  });

  test('can be limited to one deck', () => {
    const { col, deck, cards } = collection();
    const other = addDeck(col, 'Other', at(1));
    const note = addNote(col, other.id, { front: 'x', back: 'y' }, at(1));
    col.reviews.push(
      review(cards[0].id, at(5, 8), 3, 1000),
      review(cardsOfNote(col, note.id)[0].id, at(5, 9), 1, 2000),
    );
    assert.equal(todaySummary(col, at(5, 12)).reviews, 2);
    assert.deepEqual(
      [todaySummary(col, at(5, 12), { deckId: deck.id }).reviews, todaySummary(col, at(5, 12), { deckId: deck.id }).correct],
      [1, 1],
    );
    assert.equal(todaySummary(col, at(5, 12), { deckId: other.id }).correctShare, 0);
  });

  test('a day without reviews has no share of correct answers', () => {
    const { col } = collection();
    const summary = todaySummary(col, at(5, 12));
    assert.equal(summary.reviews, 0);
    assert.equal(summary.correctShare, null);
  });
});

describe('Statistics: forecast', () => {
  test('counts cards by the day they come due; overdue ones count for today', () => {
    const { col, cards } = collection();
    setDue(col, cards[0], at(5, 9));            // today
    setDue(col, cards[1], at(3, 9));            // overdue
    setDue(col, cards[2], at(6, 23));           // tomorrow
    setDue(col, cards[3], at(7, 2));            // 02:00 on the 7th still belongs to the 6th
    setDue(col, cards[4], at(5, 10, 30), STATE.Learning);
    // cards[5] stays new
    const { counts, overdue } = forecast(col, at(5, 10), { days: 30 });
    assert.equal(counts.length, 30);
    assert.equal(counts[0], 3);
    assert.equal(counts[1], 2);
    assert.equal(counts.reduce((a, b) => a + b, 0), 5);
    assert.equal(overdue, 1);
  });

  test('leaves out suspended cards and cards beyond the horizon', () => {
    const { col, cards } = collection();
    setDue(col, cards[0], at(5, 9));
    setSuspended(col, cards[0].id, true);
    setDue(col, cards[1], new Date(2027, 5, 1));
    const { counts } = forecast(col, at(5, 10), { days: 30 });
    assert.equal(counts.reduce((a, b) => a + b, 0), 0);
  });

  test('can be limited to one deck', () => {
    const { col, deck, cards } = collection();
    const other = addDeck(col, 'Other', at(1));
    const note = addNote(col, other.id, { front: 'x', back: 'y' }, at(1));
    setDue(col, cardsOfNote(col, note.id)[0], at(5, 9));
    setDue(col, cards[0], at(5, 9));
    assert.equal(forecast(col, at(5, 10)).counts[0], 2);
    assert.equal(forecast(col, at(5, 10), { deckId: deck.id }).counts[0], 1);
    assert.equal(forecast(col, at(5, 10), { deckId: other.id }).counts[0], 1);
  });
});
