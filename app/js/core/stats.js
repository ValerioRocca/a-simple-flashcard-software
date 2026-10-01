import { STATE } from './collection.js';
import { MAX_ANSWER_MS } from './scheduler.js';
import { dayIndex, dayStart } from './time.js';

/** What was studied since the start of the current study day, in all decks or in one. */
export function todaySummary(col, now = new Date(), { deckId = null } = {}) {
  const since = dayStart(now).toISOString();
  const cards = new Set();
  let reviews = 0;
  let correct = 0;
  let ms = 0;
  for (let i = col.reviews.length - 1; i >= 0; i--) {
    const review = col.reviews[i];
    if (review.at < since) break;
    if (deckId && col.cards.get(review.cardId)?.deckId !== deckId) continue;
    reviews++;
    cards.add(review.cardId);
    if (review.rating > 1) correct++;
    ms += Math.min(review.ms || 0, MAX_ANSWER_MS);
  }
  return {
    reviews,
    cards: cards.size,
    correct,
    ms,
    correctShare: reviews ? correct / reviews : null,
  };
}

/**
 * How many cards come due on each of the next `days` study days, today first.
 * Overdue cards count for today. New and suspended cards are left out: new
 * cards have no due date until they are first studied.
 */
export function forecast(col, now = new Date(), { days = 30, deckId = null } = {}) {
  const today = dayIndex(now);
  const counts = new Array(days).fill(0);
  let overdue = 0;
  for (const card of col.cards.values()) {
    if (card.suspended || card.state === STATE.New) continue;
    if (deckId && card.deckId !== deckId) continue;
    const offset = dayIndex(card.due) - today;
    if (offset < 0) overdue++;
    if (offset < days) counts[Math.max(0, offset)]++;
  }
  return { today, counts, overdue };
}
