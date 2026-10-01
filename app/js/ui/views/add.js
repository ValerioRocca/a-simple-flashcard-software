// Quick form for adding one card at a time, as in Anki.

import { addNote } from '../../core/collection.js';
import { store } from '../../store.js';
import { deckSelect } from '../deck-select.js';
import { h, setChildren, toast } from '../dom.js';
import { acceptImages } from '../images.js';
import { renderMarkdown } from '../render.js';

const PREVIEW_DELAY_MS = 150;

export function mount(host) {
  const decks = deckSelect();
  const front = h('textarea', { class: 'input add-text', rows: 5, placeholder: 'Question' });
  const back = h('textarea', { class: 'input add-text', rows: 5, placeholder: 'Answer' });
  const reversed = h('input', { type: 'checkbox' });
  const error = h('p', { class: 'field-error', hidden: true });
  const previewFront = h('div', { class: 'card-text' });
  const previewBack = h('div', { class: 'card-text' });
  acceptImages(front);
  acceptImages(back);

  let timer = null;
  const preview = () => {
    renderMarkdown(previewFront, front.value);
    renderMarkdown(previewBack, back.value);
  };
  const schedulePreview = () => {
    clearTimeout(timer);
    timer = setTimeout(preview, PREVIEW_DELAY_MS);
  };
  front.addEventListener('input', schedulePreview);
  back.addEventListener('input', schedulePreview);

  const add = () => {
    error.hidden = true;
    try {
      if (!decks.value) throw new Error('Choose or create a deck first.');
      store.change((col) => addNote(col, decks.value, {
        front: front.value,
        back: back.value,
        reversed: reversed.checked,
      }));
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
      return;
    }
    const name = store.col.decks.get(decks.value).name;
    toast(reversed.checked ? `2 cards added to “${name}”.` : `Card added to “${name}”.`);
    front.value = '';
    back.value = '';
    preview();
    front.focus();
  };

  const form = h('form', {
    class: 'add-form',
    onsubmit: (event) => {
      event.preventDefault();
      add();
    },
    onkeydown: (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        add();
      }
    },
  },
  h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Deck'), decks.el),
  h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Front'), front),
  h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Back'), back),
  h('label', { class: 'check' }, reversed, 'Also add the reversed card (back → front)'),
  error,
  h('div', { class: 'form-actions' },
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Add card', h('kbd', null, 'Ctrl+Enter')),
    h('span', { class: 'muted' }, 'Markdown, $formulas$ and pasted pictures work in both fields.')),
  );

  setChildren(host,
    h('div', { class: 'page-head' },
      h('h1', null, 'Add card'),
      h('div', { class: 'page-actions' }, h('a', { class: 'btn', href: '#/editor' }, 'Write many at once'))),
    h('div', { class: 'add-layout' },
      form,
      h('section', { class: 'add-preview', 'aria-label': 'Preview' },
        h('div', { class: 'pv-label' }, 'Front'),
        previewFront,
        h('hr', { class: 'card-divider' }),
        h('div', { class: 'pv-label' }, 'Back'),
        previewBack)),
  );
  front.focus();

  return () => clearTimeout(timer);
}
