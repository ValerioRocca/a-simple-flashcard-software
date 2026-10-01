import { store } from '../store.js';
import { createDeck } from './deck-actions.js';
import { h, setChildren } from './dom.js';

const NEW_DECK = '__new__';

// The deck chosen last, so that adding cards keeps going to the same deck.
let lastDeckId = null;

export function rememberDeck(deckId) {
  lastDeckId = deckId;
}

/**
 * A drop-down of the decks, ending with "New deck…".
 * `suggestName()` gives the name proposed when a new deck is created from here.
 * Returns `{ el, value }` where `value` is the chosen deck id (or '' when there are no decks).
 */
export function deckSelect({ preferred = null, onChange = () => {}, suggestName = () => '' } = {}) {
  const select = h('select', { class: 'input select', 'aria-label': 'Deck' });
  let current = '';

  const fill = (wanted) => {
    const decks = [...store.col.decks.values()];
    setChildren(select,
      ...decks.map((deck) => h('option', { value: deck.id }, deck.name)),
      h('option', { value: NEW_DECK }, decks.length ? 'New deck…' : 'Create a deck…'),
    );
    const pick = [wanted, lastDeckId, decks[0]?.id].find((id) => id && store.col.decks.has(id));
    if (!decks.length) select.insertBefore(h('option', { value: '', disabled: true }, 'No decks yet'), select.firstChild);
    select.value = pick ?? '';
    current = select.value;
    if (current) lastDeckId = current;
  };

  select.addEventListener('change', async () => {
    if (select.value !== NEW_DECK) {
      current = select.value;
      lastDeckId = current;
      onChange(current);
      return;
    }
    const deck = await createDeck(suggestName());
    fill(deck ? deck.id : current);
    onChange(current);
  });

  fill(preferred);
  return {
    el: select,
    get value() {
      return current;
    },
    refresh: () => fill(current),
  };
}
