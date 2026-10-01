// A study session for one deck: show a card, reveal the answer, grade it.

import { cardFaces } from '../../core/collection.js';
import { RATING, answerCard, studyQueue, suspendCard, undo } from '../../core/scheduler.js';
import { formatTime } from '../../core/time.js';
import { store } from '../../store.js';
import { limitsDialog } from '../deck-actions.js';
import { formatNumber, h, plural, reportError, setChildren, toast } from '../dom.js';
import { navigate } from '../nav.js';
import { editNote } from '../note-editor.js';
import { renderMarkdown } from '../render.js';

const GRADES = [
  { rating: RATING.Again, label: 'Again', kind: 'again' },
  { rating: RATING.Hard, label: 'Hard', kind: 'hard' },
  { rating: RATING.Good, label: 'Good', kind: 'good' },
  { rating: RATING.Easy, label: 'Easy', kind: 'easy' },
];

export function mount(host, { args }) {
  const deckId = args[0];
  if (!store.col.decks.has(deckId)) {
    navigate('#/decks');
    return null;
  }

  // The card on screen: { cardId, kind, revealed, options, shownAt }.
  let current = null;
  const history = [];
  let answered = 0;
  let wakeTimer = null;
  let mounted = true;

  const head = h('div', { class: 'study-head' });
  const stage = h('div', { class: 'study-stage' });
  const controls = h('div', { class: 'study-controls' });
  const tools = h('div', { class: 'study-tools' });
  setChildren(host, head, stage, controls, tools);

  const show = (cardId, kind) => {
    current = { cardId, kind, revealed: false, options: null, shownAt: performance.now() };
    render();
  };

  const advance = () => {
    clearTimeout(wakeTimer);
    const queue = studyQueue(store.col, deckId);
    if (queue.next) {
      show(queue.next.card.id, queue.next.kind);
      return;
    }
    current = null;
    if (queue.waitingUntil) {
      const wait = Math.max(1000, Date.parse(queue.waitingUntil) - Date.now());
      wakeTimer = setTimeout(() => mounted && !current && advance(), Math.min(wait, 2 ** 31 - 1));
    }
    render();
  };

  const reveal = () => {
    if (!current || current.revealed) return;
    const card = store.col.cards.get(current.cardId);
    current.options = store.scheduler.options(card);
    current.revealed = true;
    render();
  };

  const grade = (rating) => {
    if (!current?.revealed) return;
    const { cardId, options, shownAt } = current;
    try {
      const ms = performance.now() - shownAt;
      history.push(store.change((col) => answerCard(col, cardId, rating, options[rating], new Date(), ms)));
      answered++;
    } catch (error) {
      reportError(error);
    }
    advance();
  };

  const undoLast = () => {
    const action = history.pop();
    if (!action) return;
    const restored = store.change((col) => undo(col, action));
    if (!restored) {
      toast('That card no longer exists.');
      advance();
      return;
    }
    if (action.type === 'answer') answered--;
    clearTimeout(wakeTimer);
    const kind = { 0: 'new', 2: 'review' }[action.before.state] ?? 'learning';
    show(action.cardId, kind);
  };

  const suspend = () => {
    if (!current) return;
    history.push(store.change((col) => suspendCard(col, current.cardId)));
    toast('Card suspended. Undo brings it back; later, re-enable it from Browse.');
    advance();
  };

  const edit = async () => {
    if (!current) return;
    const { cardId } = current;
    const noteId = store.col.cards.get(cardId).noteId;
    await editNote(noteId);
    if (!mounted) return;
    if (!store.col.cards.has(cardId)) {
      advance();
      return;
    }
    // The schedule did not change; only what the card says.
    if (current?.cardId === cardId) render();
  };

  // -------------------------------------------------------------- drawing

  const countChip = (value, label, kind, active) => h('span', {
    class: `count count-${kind}${active ? ' count-active' : ''}${value ? '' : ' count-zero'}`,
  }, h('span', { class: 'count-value' }, formatNumber(value)), h('span', { class: 'count-label' }, label));

  const renderHead = (counts) => {
    const deck = store.col.decks.get(deckId);
    setChildren(head,
      h('div', { class: 'study-title' },
        h('a', { class: 'back-link', href: '#/decks' }, '← Decks'),
        h('h1', null, deck.name)),
      h('div', { class: 'deck-counts', title: 'Left to study today' },
        countChip(counts.new, 'New', 'new', current?.kind === 'new'),
        countChip(counts.learning, 'Learning', 'learn', current?.kind === 'learning'),
        countChip(counts.review, 'Due', 'due', current?.kind === 'review')),
    );
  };

  const renderCard = () => {
    const card = store.col.cards.get(current.cardId);
    const note = store.col.notes.get(card.noteId);
    const faces = cardFaces(note, card);
    const article = h('article', { class: 'study-card' },
      renderMarkdown(h('div', { class: 'card-text card-front' }), faces.front));
    if (current.revealed) {
      article.append(
        h('hr', { class: 'card-divider' }),
        renderMarkdown(h('div', { class: 'card-text card-back' }), faces.back),
      );
    }
    setChildren(stage, article);

    if (!current.revealed) {
      setChildren(controls,
        h('button', { class: 'btn btn-primary btn-lg reveal', type: 'button', onclick: reveal },
          'Show answer', h('kbd', null, 'Space')));
    } else {
      setChildren(controls, h('div', { class: 'grades' }, GRADES.map(({ rating, label, kind }) => h('button', {
        class: `grade grade-${kind}`,
        type: 'button',
        onclick: () => grade(rating),
      },
      h('span', { class: 'grade-interval' }, current.options[rating].label),
      h('span', { class: 'grade-label' }, label),
      h('kbd', null, String(rating))))));
    }
  };

  const renderDone = (queue) => {
    const { counts } = queue;
    const lines = [];
    if (answered > 0) lines.push(h('p', null, `${plural(answered, 'review')} done in this session.`));
    if (queue.waitingUntil) {
      lines.push(h('p', null,
        `${plural(counts.learning, 'card')} still in learning: the next one is ready at ${formatTime(queue.waitingUntil)}. `,
        'It will appear here by itself.'));
    }
    const moreNew = counts.newTotal - counts.new;
    const moreReviews = counts.reviewTotal - counts.review;
    if (moreNew > 0 || moreReviews > 0) {
      const parts = [];
      if (moreNew > 0) parts.push(`${formatNumber(moreNew)} more new ${moreNew === 1 ? 'card' : 'cards'}`);
      if (moreReviews > 0) parts.push(`${formatNumber(moreReviews)} more ${moreReviews === 1 ? 'review' : 'reviews'}`);
      lines.push(h('p', null,
        `Today’s limit is reached (${counts.limits.newPerDay} new, ${counts.limits.reviewsPerDay} reviews). `,
        `${parts.join(' and ')} ${moreNew + moreReviews === 1 ? 'is' : 'are'} waiting. `,
        h('button', {
          class: 'btn-link',
          type: 'button',
          onclick: async () => {
            await limitsDialog(deckId);
            if (mounted) advance();
          },
        }, 'Change the limits')));
    }
    if (counts.total === 0) {
      lines.push(h('p', null, 'This deck has no cards yet. ', h('a', { href: '#/add' }, 'Add a card'), ' or ',
        h('a', { href: '#/editor' }, 'write several at once'), '.'));
    }
    setChildren(stage, h('div', { class: 'study-done' },
      h('h2', null, counts.total === 0 ? 'Nothing to study' : 'Done for now'),
      lines,
      h('a', { class: 'btn btn-primary', href: '#/decks' }, 'Back to decks')));
    controls.replaceChildren();
  };

  function render() {
    const queue = studyQueue(store.col, deckId);
    renderHead(queue.counts);
    if (current) renderCard();
    else renderDone(queue);
    setChildren(tools,
      h('button', { class: 'btn btn-quiet', type: 'button', disabled: history.length === 0, onclick: undoLast }, 'Undo'),
      h('button', { class: 'btn btn-quiet', type: 'button', disabled: !current, onclick: edit }, 'Edit'),
      h('button', { class: 'btn btn-quiet', type: 'button', disabled: !current, onclick: suspend }, 'Suspend'),
    );
  }

  const onKey = (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!current || document.querySelector('dialog[open]')) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (!current.revealed && (event.key === ' ' || event.key === 'Enter')) {
      event.preventDefault();
      reveal();
    } else if (current.revealed && ['1', '2', '3', '4'].includes(event.key)) {
      event.preventDefault();
      grade(Number(event.key));
    }
  };
  document.addEventListener('keydown', onKey);

  advance();

  return () => {
    mounted = false;
    clearTimeout(wakeTimer);
    document.removeEventListener('keydown', onKey);
  };
}
