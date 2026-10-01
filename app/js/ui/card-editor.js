// The split card editor: a Markdown Q&A document on the left, a live preview
// of the cards it produces on the right. Used full-page for writing many cards
// and, holding a single card, for editing an existing one.

import { parseQA } from '../core/qa-format.js';
import { h, plural, setChildren } from './dom.js';
import { acceptImages } from './images.js';
import { renderMarkdown } from './render.js';

const PREVIEW_DELAY_MS = 150;

function cardPreview(item) {
  const face = (label, text) => h('div', { class: 'pv-side' },
    h('div', { class: 'pv-label' }, label),
    renderMarkdown(h('div', { class: 'card-text' }), text));
  return h('article', { class: `pv-card${item.problems.length ? ' pv-invalid' : ''}` },
    h('header', { class: 'pv-head' },
      h('span', { class: 'pv-index' }),
      item.subtopic ? h('span', { class: 'tag' }, item.subtopic) : null,
      item.reversed ? h('span', { class: 'tag tag-accent', title: 'A second card asks the answer and expects the question' }, '+ reversed') : null),
    item.problems.map((problem) => h('p', { class: 'pv-problem' }, problem)),
    item.question ? face('Question', item.question) : null,
    item.answer ? face('Answer', item.answer) : null,
    item.note
      ? h('div', { class: 'pv-side pv-note' },
        h('div', { class: 'pv-label' }, 'Note — stored, not shown during review yet'),
        renderMarkdown(h('div', { class: 'card-text' }), item.note))
      : null,
  );
}

function problemPreview(item) {
  return h('article', { class: 'pv-card pv-invalid' },
    h('header', { class: 'pv-head' }, h('span', { class: 'pv-index' })),
    h('p', { class: 'pv-problem' }, item.message),
    h('pre', { class: 'pv-stray' }, item.text),
  );
}

/**
 * Create an editor. `onChange(parsed)` is called after every edit with the
 * result of parsing the text (see parseQA).
 * Returns `{ el, text, parsed, setText, focus, jumpToLine }`.
 */
export function createCardEditor({ text = '', placeholder = '', onChange = () => {}, single = false } = {}) {
  const textarea = h('textarea', {
    class: 'ed-source',
    spellcheck: true,
    placeholder,
    'aria-label': single ? 'Card text' : 'Cards document',
  });
  textarea.value = text;
  acceptImages(textarea);

  const summary = h('div', { class: 'ed-summary' });
  const preview = h('div', { class: 'ed-preview-list' });
  const el = h('div', { class: 'ed' },
    h('section', { class: 'ed-pane' },
      h('div', { class: 'ed-pane-head' }, single ? 'Card text' : 'Document'),
      textarea),
    h('section', { class: 'ed-pane' },
      h('div', { class: 'ed-pane-head' }, 'Preview', summary),
      preview),
  );

  let parsed = parseQA(text);
  // Rendered previews by content, so typing in one card does not redraw the others.
  let rendered = new Map();
  let timer = null;

  // Go to a line (counted from 1): select it, or with `select: false` just put
  // the cursor at its end, ready to type.
  const jumpToLine = (line, { select = true } = {}) => {
    const value = textarea.value;
    let start = 0;
    for (let i = 1; i < line; i++) {
      const next = value.indexOf('\n', start);
      if (next === -1) break;
      start = next + 1;
    }
    const newline = value.indexOf('\n', start);
    const end = newline === -1 ? value.length : newline;
    textarea.focus();
    textarea.setSelectionRange(select ? start : end, end);
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 22;
    textarea.scrollTop = Math.max(0, (line - 3) * lineHeight);
  };

  const draw = () => {
    const next = new Map();
    let cardNumber = 0;
    const nodes = parsed.items.map((item) => {
      const key = JSON.stringify(item, (name, value) => (name === 'line' ? undefined : value));
      const node = rendered.get(key)?.pop() ?? (item.kind === 'card' ? cardPreview(item) : problemPreview(item));
      if (!next.has(key)) next.set(key, []);
      next.get(key).push(node);
      const valid = item.kind === 'card' && item.problems.length === 0;
      if (valid) cardNumber++;
      node.querySelector('.pv-index').textContent = valid ? `Card ${cardNumber}` : `Line ${item.line}`;
      node.onclick = (event) => {
        if (!event.target.closest('a')) jumpToLine(item.line);
      };
      node.title = `Line ${item.line} — click to go there`;
      return node;
    });
    rendered = next;
    setChildren(preview, ...nodes);
    if (!nodes.length) {
      preview.append(h('p', { class: 'ed-empty' }, single
        ? 'The card appears here.'
        : 'The cards appear here as you write. Start a card with **Q:** and give its answer after **A:**.'));
    }
    setChildren(summary,
      h('span', null, plural(parsed.cards.length, 'card')),
      parsed.problemCount
        ? h('span', { class: 'ed-problems' }, plural(parsed.problemCount, 'problem'))
        : null,
    );
  };

  const update = () => {
    timer = null;
    parsed = parseQA(textarea.value);
    draw();
    onChange(parsed);
  };

  textarea.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(update, PREVIEW_DELAY_MS);
  });

  draw();

  return {
    el,
    get text() {
      return textarea.value;
    },
    /** The parse of the text as it is now (not waiting for the preview). */
    get parsed() {
      if (timer !== null) {
        clearTimeout(timer);
        update();
      }
      return parsed;
    },
    setText(value) {
      textarea.value = value;
      clearTimeout(timer);
      update();
    },
    focus: () => textarea.focus(),
    jumpToLine,
  };
}
