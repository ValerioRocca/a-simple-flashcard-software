// Scheduling: which card comes next, and when a graded card comes back.
// The memory model is FSRS (vendored ts-fsrs); this module adds the daily
// routine around it: study days, daily limits and the order of the queue.

import { fsrs } from '../../vendor/ts-fsrs/ts-fsrs.mjs';
import { STATE, deckLimits } from './collection.js';
import { MINUTE, dayIndex, dayStart, nextDayStart, formatDays, formatMinutes, iso, toDate } from './time.js';

export const RATING = Object.freeze({ Again: 1, Hard: 2, Good: 3, Easy: 4 });
export const RATINGS = Object.freeze([1, 2, 3, 4]);

// When only learning cards are left, one that is due within this window is
// shown straight away instead of making the user wait (Anki's "learn ahead").
export const LEARN_AHEAD_MS = 20 * MINUTE;

// Time spent on one card counts for at most this long in the statistics.
export const MAX_ANSWER_MS = 60_000;

function toFsrsCard(card) {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.lastReview ? new Date(card.lastReview) : undefined,
  };
}

function fromFsrsCard(card, next) {
  return {
    ...card,
    state: next.state,
    due: next.due.toISOString(),
    stability: next.stability,
    difficulty: next.difficulty,
    elapsedDays: next.elapsed_days,
    scheduledDays: next.scheduled_days,
    learningSteps: next.learning_steps,
    reps: next.reps,
    lapses: next.lapses,
    lastReview: next.last_review ? next.last_review.toISOString() : null,
  };
}

function intervalLabel(next, now) {
  if (next.scheduledDays >= 1) return formatDays(next.scheduledDays);
  return formatMinutes((Date.parse(next.due) - toDate(now).getTime()) / MINUTE);
}

export function createScheduler(settings, { fuzz = true } = {}) {
  const engine = fsrs({
    request_retention: settings.desiredRetention,
    maximum_interval: 36500,
    enable_fuzz: fuzz,
    enable_short_term: true,
    learning_steps: settings.learningSteps,
    relearning_steps: settings.relearningSteps,
  });

  return {
    /**
     * The four possible outcomes of grading `card` at `now`, keyed by rating:
     * `{ card: the card as it would become, label: 'when it comes back' }`.
     * Grading applies one of these as computed, so the label shown on a button
     * is exactly the interval the card gets.
     */
    options(card, now = new Date()) {
      const preview = engine.repeat(toFsrsCard(card), toDate(now));
      const out = {};
      for (const rating of RATINGS) {
        const next = fromFsrsCard(card, preview[rating].card);
        out[rating] = { card: next, label: intervalLabel(next, now) };
      }
      return out;
    },
  };
}

/** Record an answer. Returns what `undo` needs to take it back. */
export function answerCard(col, cardId, rating, option, now = new Date(), ms = 0) {
  const before = col.cards.get(cardId);
  if (!before) throw new Error('Card not found.');
  const entry = {
    cardId,
    at: iso(now),
    rating,
    state: before.state,
    ms: Math.max(0, Math.round(ms)),
  };
  col.cards.set(cardId, option.card);
  col.reviews.push(entry);
  return { type: 'answer', cardId, before, entry };
}

export function suspendCard(col, cardId) {
  const before = col.cards.get(cardId);
  if (!before) throw new Error('Card not found.');
  col.cards.set(cardId, { ...before, suspended: true });
  return { type: 'suspend', cardId, before };
}

/** Take back an action returned by `answerCard` or `suspendCard`. False if the card is gone. */
export function undo(col, action) {
  if (!col.cards.has(action.cardId)) return false;
  col.cards.set(action.cardId, action.before);
  if (action.type === 'answer') {
    const index = col.reviews.lastIndexOf(action.entry);
    if (index !== -1) col.reviews.splice(index, 1);
  }
  return true;
}

// Reviews are kept in time order, so today's are at the end.
function forEachReviewToday(col, now, fn) {
  const since = dayStart(now).toISOString();
  for (let i = col.reviews.length - 1; i >= 0; i--) {
    const review = col.reviews[i];
    if (review.at < since) break;
    fn(review);
  }
}

function emptyTally() {
  return {
    total: 0, suspended: 0,
    newTotal: 0, reviewTotal: 0, learning: 0,
    newDone: 0, reviewsDone: 0,
  };
}

function isLearning(card) {
  return card.state === STATE.Learning || card.state === STATE.Relearning;
}

function finishCounts(col, deck, tally) {
  const limits = deckLimits(col, deck);
  return {
    ...tally,
    limits,
    new: Math.min(tally.newTotal, Math.max(0, limits.newPerDay - tally.newDone)),
    review: Math.min(tally.reviewTotal, Math.max(0, limits.reviewsPerDay - tally.reviewsDone)),
  };
}

/**
 * Counts for every deck: `new` and `review` are what is left to study today
 * within the daily limits, `learning` the cards in learning due today.
 * `newTotal` and `reviewTotal` ignore the limits.
 */
export function deckCounts(col, now = new Date()) {
  const today = dayIndex(now);
  const endOfDay = nextDayStart(now).toISOString();
  const tallies = new Map();
  for (const id of col.decks.keys()) tallies.set(id, emptyTally());

  for (const card of col.cards.values()) {
    const tally = tallies.get(card.deckId);
    tally.total++;
    if (card.suspended) tally.suspended++;
    else if (card.state === STATE.New) tally.newTotal++;
    else if (isLearning(card)) {
      if (card.due < endOfDay) tally.learning++;
    } else if (dayIndex(card.due) <= today) tally.reviewTotal++;
  }

  forEachReviewToday(col, now, (review) => {
    const card = col.cards.get(review.cardId);
    if (!card) return;
    const tally = tallies.get(card.deckId);
    if (review.state === STATE.New) tally.newDone++;
    else if (review.state === STATE.Review) tally.reviewsDone++;
  });

  const counts = new Map();
  for (const [id, tally] of tallies) counts.set(id, finishCounts(col, col.decks.get(id), tally));
  return counts;
}

/**
 * Everything a study session needs to know about one deck right now: the
 * counts, and the card to show next.
 *
 * Order: learning cards whose time has come, then reviews (most overdue
 * first), then new cards (in the order they were added), and finally learning
 * cards that are almost due. `next` is null when nothing is left for now; then
 * `waitingUntil` says when the next learning card of today becomes due, if any.
 */
export function studyQueue(col, deckId, now = new Date()) {
  const deck = col.decks.get(deckId);
  if (!deck) throw new Error('Deck not found.');
  const nowIso = iso(now);
  const soonIso = iso(toDate(now).getTime() + LEARN_AHEAD_MS);
  const endOfDay = nextDayStart(now).toISOString();
  const today = dayIndex(now);
  const tally = emptyTally();

  let learningDue = null;
  let learningSoon = null;
  let learningLater = null;
  let review = null;
  let fresh = null;

  for (const card of col.cards.values()) {
    if (card.deckId !== deckId) continue;
    tally.total++;
    if (card.suspended) {
      tally.suspended++;
    } else if (card.state === STATE.New) {
      tally.newTotal++;
      if (!fresh) fresh = card;
    } else if (isLearning(card)) {
      if (card.due >= endOfDay) continue;
      tally.learning++;
      if (card.due <= nowIso) {
        if (!learningDue || card.due < learningDue.due) learningDue = card;
      } else if (card.due <= soonIso) {
        if (!learningSoon || card.due < learningSoon.due) learningSoon = card;
      } else if (!learningLater || card.due < learningLater.due) {
        learningLater = card;
      }
    } else if (dayIndex(card.due) <= today) {
      tally.reviewTotal++;
      if (!review || card.due < review.due) review = card;
    }
  }

  forEachReviewToday(col, now, (entry) => {
    const card = col.cards.get(entry.cardId);
    if (!card || card.deckId !== deckId) return;
    if (entry.state === STATE.New) tally.newDone++;
    else if (entry.state === STATE.Review) tally.reviewsDone++;
  });

  const counts = finishCounts(col, deck, tally);
  let next = null;
  if (learningDue) next = { card: learningDue, kind: 'learning' };
  else if (counts.review > 0) next = { card: review, kind: 'review' };
  else if (counts.new > 0) next = { card: fresh, kind: 'new' };
  else if (learningSoon) next = { card: learningSoon, kind: 'learning' };

  return {
    counts,
    next,
    waitingUntil: next ? null : (learningLater?.due ?? null),
  };
}
