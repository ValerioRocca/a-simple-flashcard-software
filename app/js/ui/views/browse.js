// Browse: every card in a table, with search and filters; edit, suspend, delete.

import { STATE, cardFaces, cardsOfNote, deleteNote, setSuspended } from '../../core/collection.js';
import { toPlainText } from '../../core/markdown.js';
import { dayIndex, formatDate, formatTime } from '../../core/time.js';
import { store } from '../../store.js';
import { confirmDialog, formatNumber, h, plural, setChildren, toast } from '../dom.js';
import { editNote } from '../note-editor.js';

const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 150;

const STATES = [
  { key: 'new', label: 'New' },
  { key: 'learning', label: 'Learning' },
  { key: 'review', label: 'Review' },
  { key: 'suspended', label: 'Suspended' },
];
const STATE_LABEL = Object.fromEntries(STATES.map((s) => [s.key, s.label]));

// The filters are kept while moving between screens.
const filters = { search: '', deckId: '', state: '', page: 0 };

function stateOf(card) {
  if (card.suspended) return 'suspended';
  if (card.state === STATE.New) return 'new';
  if (card.state === STATE.Review) return 'review';
  return 'learning';
}

function dueText(card, now) {
  if (card.state === STATE.New) return '—';
  if (card.state === STATE.Review) {
    const days = dayIndex(card.due) - dayIndex(now);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return formatDate(card.due);
  }
  return Date.parse(card.due) <= now.getTime() ? 'Now' : `Today ${formatTime(card.due)}`;
}

// Text to search in and to show, computed once per note (notes are never changed in place).
const searchCache = new WeakMap();
function searchText(note) {
  let text = searchCache.get(note);
  if (text === undefined) {
    text = `${note.front}\n${note.back}\n${note.note || ''}\n${note.subtopic || ''}`.toLowerCase();
    searchCache.set(note, text);
  }
  return text;
}

const plainCache = new WeakMap();
function plainFaces(note) {
  let faces = plainCache.get(note);
  if (!faces) {
    faces = { front: toPlainText(note.front), back: toPlainText(note.back) };
    plainCache.set(note, faces);
  }
  return faces;
}

export function mount(host) {
  const search = h('input', {
    class: 'input browse-search', type: 'search', placeholder: 'Search in questions and answers', value: filters.search,
    'aria-label': 'Search',
  });
  const deckFilter = h('select', { class: 'input select', 'aria-label': 'Deck' });
  const stateFilter = h('select', { class: 'input select', 'aria-label': 'State' },
    h('option', { value: '' }, 'Any state'),
    STATES.map((s) => h('option', { value: s.key }, s.label)));
  stateFilter.value = filters.state;
  const result = h('div', { class: 'browse-result' });

  const fillDecks = () => {
    const { col } = store;
    if (filters.deckId && !col.decks.has(filters.deckId)) filters.deckId = '';
    setChildren(deckFilter,
      h('option', { value: '' }, 'All decks'),
      ...[...col.decks.values()].map((deck) => h('option', { value: deck.id }, deck.name)));
    deckFilter.value = filters.deckId;
  };

  const matching = () => {
    const { col } = store;
    const query = filters.search.trim().toLowerCase();
    const rows = [];
    for (const card of col.cards.values()) {
      if (filters.deckId && card.deckId !== filters.deckId) continue;
      if (filters.state && stateOf(card) !== filters.state) continue;
      if (query && !searchText(col.notes.get(card.noteId)).includes(query)) continue;
      rows.push(card);
    }
    return rows;
  };

  const remove = async (card) => {
    const twins = cardsOfNote(store.col, card.noteId).length;
    const confirmed = await confirmDialog({
      title: 'Delete this card?',
      message: twins > 1
        ? 'The card and its reversed twin are deleted together, with their review history.'
        : 'The card is deleted with its review history.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    store.change((col) => deleteNote(col, card.noteId));
    toast(twins > 1 ? 'Deleted both cards.' : 'Card deleted.');
  };

  const row = (card, now) => {
    const { col } = store;
    const note = col.notes.get(card.noteId);
    const plain = plainFaces(note);
    const faces = cardFaces({ front: plain.front, back: plain.back }, card);
    const state = stateOf(card);
    return h('tr', null,
      h('td', { class: 'cell-text' },
        h('div', { class: 'clip', title: faces.front }, faces.front),
        card.ord === 1 ? h('span', { class: 'tag' }, 'reversed') : null),
      h('td', { class: 'cell-text' }, h('div', { class: 'clip', title: faces.back }, faces.back)),
      h('td', null, col.decks.get(card.deckId).name),
      h('td', null, h('span', { class: `state state-${state}` }, STATE_LABEL[state])),
      h('td', { class: 'nowrap' }, card.suspended ? '—' : dueText(card, now)),
      h('td', null, h('div', { class: 'row-actions' },
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => editNote(card.noteId) }, 'Edit'),
        h('button', {
          class: 'btn btn-small',
          type: 'button',
          title: card.suspended ? 'Put the card back into study' : 'Take the card out of study until re-enabled',
          onclick: () => store.change((c) => setSuspended(c, card.id, !card.suspended)),
        }, card.suspended ? 'Resume' : 'Suspend'),
        h('button', { class: 'btn btn-small btn-danger-quiet', type: 'button', onclick: () => remove(card) }, 'Delete'))),
    );
  };

  const render = () => {
    const rows = matching();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    filters.page = Math.min(filters.page, pages - 1);
    const start = filters.page * PAGE_SIZE;
    const visible = rows.slice(start, start + PAGE_SIZE);
    const now = new Date();
    const total = store.col.cards.size;

    if (total === 0) {
      setChildren(result, h('div', { class: 'empty' },
        h('h2', null, 'No cards yet'),
        h('p', null, h('a', { href: '#/add' }, 'Add a card'), ' or ', h('a', { href: '#/editor' }, 'write several at once'), '.')));
      return;
    }

    const goTo = (page) => () => {
      filters.page = page;
      render();
      result.scrollIntoView({ block: 'start' });
    };

    setChildren(result,
      h('p', { class: 'muted browse-count' },
        rows.length === total ? plural(total, 'card') : `${formatNumber(rows.length)} of ${plural(total, 'card')}`,
        rows.length > PAGE_SIZE ? ` · showing ${formatNumber(start + 1)}–${formatNumber(start + visible.length)}` : ''),
      rows.length
        ? h('div', { class: 'table-wrap' },
          h('table', { class: 'table browse-table' },
            h('thead', null, h('tr', null,
              h('th', null, 'Question'), h('th', null, 'Answer'), h('th', null, 'Deck'),
              h('th', null, 'State'), h('th', null, 'Due'), h('th', null, h('span', { class: 'sr-only' }, 'Actions')))),
            h('tbody', null, visible.map((card) => row(card, now)))))
        : h('p', { class: 'empty' }, 'No card matches these filters.'),
      pages > 1
        ? h('div', { class: 'pager' },
          h('button', { class: 'btn', type: 'button', disabled: filters.page === 0, onclick: goTo(filters.page - 1) }, '← Previous'),
          h('span', { class: 'muted' }, `Page ${filters.page + 1} of ${formatNumber(pages)}`),
          h('button', { class: 'btn', type: 'button', disabled: filters.page >= pages - 1, onclick: goTo(filters.page + 1) }, 'Next →'))
        : null,
    );
  };

  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      filters.search = search.value;
      filters.page = 0;
      render();
    }, SEARCH_DELAY_MS);
  });
  deckFilter.addEventListener('change', () => {
    filters.deckId = deckFilter.value;
    filters.page = 0;
    render();
  });
  stateFilter.addEventListener('change', () => {
    filters.state = stateFilter.value;
    filters.page = 0;
    render();
  });

  setChildren(host,
    h('div', { class: 'page-head' }, h('h1', null, 'Browse')),
    h('div', { class: 'filters' }, search, deckFilter, stateFilter),
    result,
  );
  fillDecks();
  render();

  const off = store.on('change', () => {
    fillDecks();
    render();
  });
  return () => {
    off();
    clearTimeout(timer);
  };
}
