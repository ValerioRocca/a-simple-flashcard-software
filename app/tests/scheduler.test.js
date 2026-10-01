import { describe, test, assert } from './harness.js';
import {
  STATE, addDeck, addNote, cardsOfNote, createCollection, setDeckLimits, setSuspended, updateSettings,
} from '../js/core/collection.js';
import {
  RATING, answerCard, createScheduler, deckCounts, studyQueue, suspendCard, undo,
} from '../js/core/scheduler.js';
import { formatDays } from '../js/core/time.js';

const at = (day, hour = 10, minute = 0) => new Date(2026, 9, day, hour, minute);
const NOW = at(1);
const minutesBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 60_000);

function deckWith(count, { now = NOW, reversed = false } = {}) {
  const col = createCollection(now);
  const deck = addDeck(col, 'Deck', now);
  const cards = [];
  for (let i = 0; i < count; i++) {
    const note = addNote(col, deck.id, { front: `q${i}`, back: `a${i}`, reversed }, now);
    cards.push(...cardsOfNote(col, note.id));
  }
  return { col, deck, cards };
}

/** Grade the card, as the study screen does. */
function grade(col, scheduler, cardId, rating, now) {
  const option = scheduler.options(col.cards.get(cardId), now)[rating];
  return answerCard(col, cardId, rating, option, now, 5000);
}

/** Put a card straight into the review state, due on the given date. */
function makeReview(col, cardId, due, lastReview = at(1, 9)) {
  col.cards.set(cardId, {
    ...col.cards.get(cardId),
    state: STATE.Review,
    due: due.toISOString(),
    lastReview: lastReview.toISOString(),
    stability: 10,
    difficulty: 5,
    scheduledDays: 10,
    reps: 3,
  });
}

describe('Scheduler: grading a card', () => {
  const settings = createCollection(NOW).settings;
  const scheduler = createScheduler(settings, { fuzz: false });

  test('a new card: Again 1 min, Hard 6 min, Good 10 min, Easy graduates', () => {
    const { col, cards } = deckWith(1);
    const options = scheduler.options(col.cards.get(cards[0].id), NOW);
    assert.equal(options[RATING.Again].label, '1m');
    assert.equal(options[RATING.Hard].label, '6m');
    assert.equal(options[RATING.Good].label, '10m');
    assert.equal(options[RATING.Again].card.state, STATE.Learning);
    assert.equal(options[RATING.Good].card.state, STATE.Learning);
    assert.equal(minutesBetween(NOW, options[RATING.Good].card.due), 10);
    const easy = options[RATING.Easy].card;
    assert.equal(easy.state, STATE.Review);
    assert.ok(easy.scheduledDays >= 1);
    assert.equal(options[RATING.Easy].label, formatDays(easy.scheduledDays));
  });

  test('previewing the options changes nothing', () => {
    const { col, cards } = deckWith(1);
    const before = col.cards.get(cards[0].id);
    scheduler.options(before, NOW);
    assert.equal(col.cards.get(cards[0].id), before);
    assert.equal(col.reviews.length, 0);
  });

  test('Good twice takes a new card through the learning steps into review', () => {
    const { col, cards } = deckWith(1);
    const id = cards[0].id;
    grade(col, scheduler, id, RATING.Good, NOW);
    assert.equal(col.cards.get(id).state, STATE.Learning);
    grade(col, scheduler, id, RATING.Good, at(1, 10, 10));
    const card = col.cards.get(id);
    assert.equal(card.state, STATE.Review);
    assert.ok(card.scheduledDays >= 1);
    assert.equal(card.reps, 2);
    assert.equal(card.lastReview, at(1, 10, 10).toISOString());
    assert.deepEqual(col.reviews.map((r) => [r.rating, r.state, r.ms]), [[3, STATE.New, 5000], [3, STATE.Learning, 5000]]);
  });

  test('Again on a learning card sends it back to the first step', () => {
    const { col, cards } = deckWith(1);
    const id = cards[0].id;
    grade(col, scheduler, id, RATING.Good, NOW);
    grade(col, scheduler, id, RATING.Again, at(1, 10, 10));
    const card = col.cards.get(id);
    assert.equal(card.state, STATE.Learning);
    assert.equal(minutesBetween(at(1, 10, 10), card.due), 1);
  });

  test('forgetting a review card: relearning in 10 min and one more lapse', () => {
    const { col, cards } = deckWith(1);
    const id = cards[0].id;
    makeReview(col, id, at(11));
    grade(col, scheduler, id, RATING.Again, at(11));
    const card = col.cards.get(id);
    assert.equal(card.state, STATE.Relearning);
    assert.equal(card.lapses, 1);
    assert.equal(minutesBetween(at(11), card.due), 10);
    grade(col, scheduler, id, RATING.Good, at(11, 10, 10));
    assert.equal(col.cards.get(id).state, STATE.Review);
  });

  test('on a review card the intervals grow from Hard to Good to Easy', () => {
    const { col, cards } = deckWith(1);
    makeReview(col, cards[0].id, at(11));
    const options = scheduler.options(col.cards.get(cards[0].id), at(11));
    const days = [RATING.Hard, RATING.Good, RATING.Easy].map((r) => options[r].card.scheduledDays);
    assert.ok(days[0] <= days[1] && days[1] < days[2], `intervals ${days}`);
    assert.ok(days[1] > 10, 'a successful review lengthens the interval');
  });

  test('a higher target retention gives shorter intervals', () => {
    const { col, cards } = deckWith(1);
    makeReview(col, cards[0].id, at(11));
    const card = col.cards.get(cards[0].id);
    const relaxed = createScheduler({ ...settings, desiredRetention: 0.8 }, { fuzz: false });
    const strict = createScheduler({ ...settings, desiredRetention: 0.95 }, { fuzz: false });
    const long = relaxed.options(card, at(11))[RATING.Good].card.scheduledDays;
    const short = strict.options(card, at(11))[RATING.Good].card.scheduledDays;
    assert.ok(short < long, `${short} should be shorter than ${long}`);
  });

  test('the learning steps come from the settings', () => {
    const { col, cards } = deckWith(1);
    const custom = createScheduler({ ...settings, learningSteps: ['5m', '1h'] }, { fuzz: false });
    const options = custom.options(col.cards.get(cards[0].id), NOW);
    assert.equal(options[RATING.Again].label, '5m');
    assert.equal(options[RATING.Good].label, '1h');
  });

  test('with random spread on, the label on the button is the interval applied', () => {
    const fuzzy = createScheduler(settings);
    const { col, cards } = deckWith(1);
    makeReview(col, cards[0].id, at(11));
    for (const rating of [RATING.Hard, RATING.Good, RATING.Easy]) {
      const option = fuzzy.options(col.cards.get(cards[0].id), at(11))[rating];
      assert.equal(option.label, formatDays(option.card.scheduledDays));
    }
  });
});

describe('Scheduler: undo and suspend', () => {
  const scheduler = createScheduler(createCollection(NOW).settings, { fuzz: false });

  test('undo restores the card and removes the answer from the history', () => {
    const { col, cards } = deckWith(2);
    const first = col.cards.get(cards[0].id);
    const a1 = grade(col, scheduler, cards[0].id, RATING.Good, NOW);
    const a2 = grade(col, scheduler, cards[1].id, RATING.Again, at(1, 10, 1));
    assert.equal(col.reviews.length, 2);
    assert.equal(undo(col, a2), true);
    assert.equal(col.reviews.length, 1);
    assert.equal(col.cards.get(cards[1].id).state, STATE.New);
    assert.equal(undo(col, a1), true);
    assert.equal(col.reviews.length, 0);
    assert.equal(col.cards.get(cards[0].id), first);
  });

  test('suspending takes the card out of study; undo brings it back', () => {
    const { col, deck, cards } = deckWith(2);
    const action = suspendCard(col, cards[0].id);
    assert.equal(studyQueue(col, deck.id, NOW).next.card.id, cards[1].id);
    assert.equal(deckCounts(col, NOW).get(deck.id).suspended, 1);
    undo(col, action);
    assert.equal(studyQueue(col, deck.id, NOW).next.card.id, cards[0].id);
  });
});

describe('Scheduler: what is due', () => {
  const scheduler = createScheduler(createCollection(NOW).settings, { fuzz: false });

  test('new cards are limited per day, and studied ones use up the limit', () => {
    const { col, deck, cards } = deckWith(30);
    assert.equal(deckCounts(col, NOW).get(deck.id).new, 20);
    assert.equal(deckCounts(col, NOW).get(deck.id).newTotal, 30);
    grade(col, scheduler, cards[0].id, RATING.Easy, NOW);
    grade(col, scheduler, cards[1].id, RATING.Easy, NOW);
    assert.equal(deckCounts(col, NOW).get(deck.id).new, 18);
    // The limit starts afresh on the next study day.
    assert.equal(deckCounts(col, at(2)).get(deck.id).new, 20);
  });

  test('a deck can raise or lower its own limits', () => {
    const { col, deck, cards } = deckWith(30);
    setDeckLimits(col, deck.id, { newPerDay: 3, reviewsPerDay: 2 });
    for (const card of cards.slice(0, 10)) makeReview(col, card.id, at(1, 8));
    const counts = deckCounts(col, NOW).get(deck.id);
    assert.equal(counts.new, 3);
    assert.equal(counts.review, 2);
    assert.equal(counts.reviewTotal, 10);
    setDeckLimits(col, deck.id, { newPerDay: 100, reviewsPerDay: null });
    const raised = deckCounts(col, NOW).get(deck.id);
    assert.equal(raised.new, 20);
    assert.equal(raised.review, 10);
  });

  test('the default limits come from the settings', () => {
    const { col, deck } = deckWith(30);
    updateSettings(col, { newPerDay: 4 });
    assert.equal(deckCounts(col, NOW).get(deck.id).new, 4);
  });

  test('a review card is due from 04:00 of its due day, whatever the hour it was studied', () => {
    const { col, deck, cards } = deckWith(1);
    makeReview(col, cards[0].id, at(3, 23, 0));
    assert.equal(deckCounts(col, at(2, 23, 30)).get(deck.id).review, 0);
    assert.equal(deckCounts(col, at(3, 3, 59)).get(deck.id).review, 0);
    assert.equal(deckCounts(col, at(3, 4, 0)).get(deck.id).review, 1);
    assert.equal(deckCounts(col, at(9, 12, 0)).get(deck.id).review, 1, 'overdue cards stay due');
  });

  test('learning cards count for today only', () => {
    const { col, deck, cards } = deckWith(2);
    grade(col, scheduler, cards[0].id, RATING.Good, at(1, 23, 0));
    assert.equal(deckCounts(col, at(1, 23, 0)).get(deck.id).learning, 1);
    col.cards.set(cards[1].id, { ...col.cards.get(cards[1].id), state: STATE.Learning, due: at(2, 9).toISOString() });
    assert.equal(deckCounts(col, at(1, 23, 0)).get(deck.id).learning, 1);
    assert.equal(deckCounts(col, at(2, 9, 0)).get(deck.id).learning, 2);
  });

  test('suspended cards are never due', () => {
    const { col, deck, cards } = deckWith(3);
    makeReview(col, cards[0].id, at(1, 8));
    setSuspended(col, cards[0].id, true);
    setSuspended(col, cards[1].id, true);
    const counts = deckCounts(col, NOW).get(deck.id);
    assert.deepEqual([counts.new, counts.review, counts.suspended, counts.total], [1, 0, 2, 3]);
  });

  test('each deck is counted separately', () => {
    const { col, deck } = deckWith(2);
    const other = addDeck(col, 'Other', NOW);
    addNote(col, other.id, { front: 'x', back: 'y', reversed: true }, NOW);
    const counts = deckCounts(col, NOW);
    assert.equal(counts.get(deck.id).new, 2);
    assert.equal(counts.get(other.id).new, 2);
    assert.equal(counts.get(other.id).total, 2);
  });
});

describe('Scheduler: order of a study session', () => {
  const scheduler = createScheduler(createCollection(NOW).settings, { fuzz: false });

  test('reviews first (most overdue first), then new cards in the order added', () => {
    const { col, deck, cards } = deckWith(4);
    makeReview(col, cards[2].id, at(1, 8));
    makeReview(col, cards[3].id, new Date(2026, 8, 20));
    const order = [];
    let now = NOW;
    for (let i = 0; i < 4; i++) {
      const { next } = studyQueue(col, deck.id, now);
      order.push([next.card.id, next.kind]);
      grade(col, scheduler, next.card.id, RATING.Easy, now);
      now = new Date(now.getTime() + 30_000);
    }
    assert.deepEqual(order, [
      [cards[3].id, 'review'], [cards[2].id, 'review'], [cards[0].id, 'new'], [cards[1].id, 'new'],
    ]);
    assert.equal(studyQueue(col, deck.id, now).next, null);
  });

  test('a learning card whose time has come is shown before anything else', () => {
    const { col, deck, cards } = deckWith(3);
    grade(col, scheduler, cards[0].id, RATING.Again, NOW);
    // Not due for another minute: the next new card comes first.
    assert.equal(studyQueue(col, deck.id, at(1, 10, 0)).next.card.id, cards[1].id);
    const later = studyQueue(col, deck.id, at(1, 10, 2));
    assert.equal(later.next.card.id, cards[0].id);
    assert.equal(later.next.kind, 'learning');
  });

  test('when only learning cards are left, one due within 20 minutes is shown early', () => {
    const { col, deck, cards } = deckWith(1);
    grade(col, scheduler, cards[0].id, RATING.Good, NOW);
    const queue = studyQueue(col, deck.id, at(1, 10, 1));
    assert.equal(queue.next.card.id, cards[0].id);
    assert.equal(queue.counts.learning, 1);
  });

  test('a learning card due later today ends the session and says when to come back', () => {
    const { col, deck, cards } = deckWith(1);
    const custom = createScheduler({ ...col.settings, learningSteps: ['2h'] }, { fuzz: false });
    grade(col, custom, cards[0].id, RATING.Again, NOW);
    const queue = studyQueue(col, deck.id, at(1, 10, 1));
    assert.equal(queue.next, null);
    assert.equal(queue.waitingUntil, at(1, 12, 0).toISOString());
    assert.equal(studyQueue(col, deck.id, at(1, 12, 0)).next.card.id, cards[0].id);
  });

  test('the session ends when the daily limits are reached, even with cards left', () => {
    const { col, deck, cards } = deckWith(5);
    setDeckLimits(col, deck.id, { newPerDay: 2, reviewsPerDay: null });
    grade(col, scheduler, cards[0].id, RATING.Easy, NOW);
    grade(col, scheduler, cards[1].id, RATING.Easy, NOW);
    const queue = studyQueue(col, deck.id, NOW);
    assert.equal(queue.next, null);
    assert.equal(queue.counts.newTotal, 3);
    assert.equal(queue.counts.new, 0);
  });

  test('the counts of the session match the deck list', () => {
    const { col, deck, cards } = deckWith(6);
    makeReview(col, cards[0].id, at(1, 8));
    grade(col, scheduler, cards[1].id, RATING.Again, NOW);
    setSuspended(col, cards[2].id, true);
    const list = deckCounts(col, NOW).get(deck.id);
    const session = studyQueue(col, deck.id, NOW).counts;
    for (const key of ['new', 'learning', 'review', 'total', 'suspended', 'newTotal', 'reviewTotal']) {
      assert.equal(session[key], list[key], key);
    }
    assert.deepEqual([list.new, list.learning, list.review], [3, 1, 1]);
  });
});
