// Home: the list of decks with what is due today.

import { deckCounts } from '../../core/scheduler.js';
import { todaySummary } from '../../core/stats.js';
import { formatDuration } from '../../core/time.js';
import { store } from '../../store.js';
import {
  createDeck, deleteDeckDialog, exportJson, exportMarkdown, importJson, limitsDialog, renameDeckDialog,
} from '../deck-actions.js';
import { rememberDeck } from '../deck-select.js';
import { formatNumber, h, menuButton, plural, setChildren } from '../dom.js';
import { navigate } from '../nav.js';

function todayLine(col) {
  const today = todaySummary(col);
  if (!today.reviews) return h('p', { class: 'today' }, 'Nothing studied yet today.');
  return h('p', { class: 'today' },
    h('strong', null, 'Today: '),
    `${plural(today.reviews, 'review')} of ${plural(today.cards, 'card')} in ${formatDuration(today.ms)}, `,
    `${Math.round(today.correctShare * 100)}% correct.`);
}

function count(value, label, kind) {
  return h('div', { class: `count count-${kind}${value ? '' : ' count-zero'}` },
    h('span', { class: 'count-value' }, formatNumber(value)),
    h('span', { class: 'count-label' }, label));
}

function deckRow(deck, counts) {
  const waiting = counts.new + counts.learning + counts.review;
  const meta = [plural(counts.total, 'card')];
  if (counts.suspended) meta.push(`${formatNumber(counts.suspended)} suspended`);
  const overLimit = (counts.newTotal - counts.new) + (counts.reviewTotal - counts.review);
  if (overLimit > 0) meta.push(`${formatNumber(overLimit)} more beyond today’s limit`);

  return h('li', { class: 'deck' },
    h('div', { class: 'deck-main' },
      h('a', { class: 'deck-name', href: `#/study/${deck.id}` }, deck.name),
      h('div', { class: 'deck-meta' }, meta.join(' · '))),
    h('div', { class: 'deck-counts' },
      count(counts.new, 'New', 'new'),
      count(counts.learning, 'Learning', 'learn'),
      count(counts.review, 'Due', 'due')),
    h('div', { class: 'deck-actions' },
      h('a', { class: `btn${waiting ? ' btn-primary' : ''}`, href: `#/study/${deck.id}` }, 'Study'),
      h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => {
          rememberDeck(deck.id);
          navigate('#/add');
        },
      }, 'Add cards'),
      menuButton('⋯', [
        { label: 'Rename', action: () => renameDeckDialog(deck.id) },
        { label: 'Daily limits', action: () => limitsDialog(deck.id) },
        '-',
        { label: 'Export as Markdown', action: () => exportMarkdown(deck.id) },
        { label: 'Export as JSON', action: () => exportJson(deck.id) },
        '-',
        { label: 'Delete', danger: true, action: () => deleteDeckDialog(deck.id) },
      ], { ariaLabel: `More actions for ${deck.name}` })),
  );
}

export function mount(host) {
  const render = () => {
    const { col } = store;
    const counts = deckCounts(col);
    const decks = [...col.decks.values()];
    setChildren(host,
      h('div', { class: 'page-head' },
        h('h1', null, 'Decks'),
        h('div', { class: 'page-actions' },
          h('button', { class: 'btn', type: 'button', onclick: importJson }, 'Import deck…'),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => createDeck() }, 'New deck'))),
      todayLine(col),
      decks.length
        ? h('ul', { class: 'deck-list' }, decks.map((deck) => deckRow(deck, counts.get(deck.id))))
        : h('div', { class: 'empty' },
          h('h2', null, 'No decks yet'),
          h('p', null, 'A deck is a set of cards on one subject. Create one, then add cards to it one at a time or write many at once in the card editor.'),
          h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => createDeck() }, 'Create your first deck')),
    );
  };

  render();
  const off = store.on('change', render);
  // Counts move by themselves: learning cards come due, and the day rolls over at 04:00.
  const timer = setInterval(() => {
    if (!host.querySelector('.menu:not([hidden])')) render();
  }, 60_000);
  return () => {
    off();
    clearInterval(timer);
  };
}
