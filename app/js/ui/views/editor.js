// The card editor: write or paste a Q&A document, check it against the live
// preview, then add all its cards to a deck in one step. Drafts can be opened
// from and saved to .md files, to be filled in elsewhere and finished later.

import { addNote } from '../../core/collection.js';
import { entryToFields } from '../../core/deck-io.js';
import { TEMPLATE } from '../../core/qa-format.js';
import { store } from '../../store.js';
import { createCardEditor } from '../card-editor.js';
import { deckSelect } from '../deck-select.js';
import { confirmDialog, h, plural, reportError, setChildren, toast } from '../dom.js';
import { openTextFile, saveTextAs, writeToHandle } from '../files.js';

const PLACEHOLDER = `**Q:** A question
**A:** Its answer

**Q:** Another question
**A:** Another answer`;

// The draft outlives the screen: going to another section and back keeps it.
// It is lost when the app is closed, unless saved to a file.
const draft = { text: '', savedText: '', handle: null, name: '' };

/** True while the editor holds text that is neither saved to a file nor added to a deck. */
export function hasUnsavedDraft() {
  return draft.text !== draft.savedText;
}

function resetDraft() {
  draft.text = '';
  draft.savedText = '';
  draft.handle = null;
  draft.name = '';
}

async function okToReplace() {
  if (!hasUnsavedDraft() || !draft.text.trim()) return true;
  return confirmDialog({
    title: 'Discard this draft?',
    message: 'The text in the editor has not been saved to a file or added to a deck.',
    confirmLabel: 'Discard',
    danger: true,
  });
}

export function mount(host) {
  const fileInfo = h('span', { class: 'ed-file' });
  const addButton = h('button', { class: 'btn btn-primary', type: 'button' });
  const hint = h('span', { class: 'muted' });

  const editor = createCardEditor({
    text: draft.text,
    placeholder: PLACEHOLDER,
    onChange: () => updateBar(),
  });
  // A new deck created from here is named after the document's # title.
  const decks = deckSelect({ onChange: () => updateBar(), suggestName: () => editor.parsed.title });

  const updateFile = () => {
    const label = draft.name || (draft.text.trim() ? 'Draft' : 'New draft');
    setChildren(fileInfo, label, hasUnsavedDraft() && draft.text.trim()
      ? h('span', { class: 'ed-edited' }, draft.name ? ' · changes not saved' : ' · not saved to a file')
      : null);
  };

  function updateBar() {
    const { cards, problemCount } = editor.parsed;
    addButton.textContent = `Add ${plural(cards.length, 'card')}`;
    addButton.disabled = cards.length === 0 || problemCount > 0 || !decks.value;
    if (problemCount > 0) hint.textContent = `Fix or remove the ${plural(problemCount, 'problem')} marked in the preview first.`;
    else if (cards.length && !decks.value) hint.textContent = 'Choose or create a deck.';
    else hint.textContent = '';
    updateFile();
  }

  const setText = (text) => {
    draft.text = text;
    editor.setText(text);
    updateBar();
  };

  editor.el.addEventListener('input', () => {
    draft.text = editor.text;
    updateFile();
  });

  const newDraft = async () => {
    if (!(await okToReplace())) return;
    resetDraft();
    setText('');
    editor.focus();
  };

  const useTemplate = async () => {
    if (!(await okToReplace())) return;
    resetDraft();
    // Not worth a warning until something is typed into it.
    draft.savedText = TEMPLATE;
    setText(TEMPLATE);
    // Ready to type the first question.
    editor.jumpToLine(TEMPLATE.split('\n').findIndex((line) => line.startsWith('**Q:**')) + 1, { select: false });
  };

  const openFile = async () => {
    if (!(await okToReplace())) return;
    try {
      const file = await openTextFile('markdown');
      if (!file) return;
      draft.handle = file.handle;
      draft.name = file.name;
      draft.savedText = file.text.replace(/\r\n?/g, '\n');
      setText(draft.savedText);
    } catch (error) {
      reportError(error, 'The file could not be opened');
    }
  };

  const saveAs = async () => {
    try {
      const handle = await saveTextAs(draft.name || 'cards.md', editor.text, 'markdown');
      if (!handle) return;
      draft.handle = handle;
      draft.name = handle.name;
      draft.savedText = editor.text;
      updateFile();
      toast(`Saved as ${handle.name}.`);
    } catch (error) {
      reportError(error, 'The draft could not be saved');
    }
  };

  const save = async () => {
    if (!draft.handle) {
      await saveAs();
      return;
    }
    try {
      // A file that was opened is read-only until the user allows writing to it.
      if ((await draft.handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
      await writeToHandle(draft.handle, editor.text);
      draft.savedText = editor.text;
      updateFile();
      toast(`Saved ${draft.name}.`);
    } catch (error) {
      reportError(error, 'The draft could not be saved');
    }
  };

  addButton.addEventListener('click', () => {
    const { cards, problemCount } = editor.parsed;
    if (!cards.length || problemCount > 0 || !decks.value) return;
    const deckId = decks.value;
    try {
      store.change((col) => {
        for (const card of cards) addNote(col, deckId, entryToFields(card));
      });
    } catch (error) {
      reportError(error, 'The cards could not be added');
      return;
    }
    const twins = cards.filter((card) => card.reversed).length;
    const name = store.col.decks.get(deckId).name;
    toast(`Added ${plural(cards.length, 'card')}${twins ? ` (plus ${twins} reversed)` : ''} to “${name}”.`, { duration: 5000 });
    resetDraft();
    setText('');
  });

  const onKey = (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      save();
    }
  };
  document.addEventListener('keydown', onKey);

  setChildren(host,
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Card editor'), fileInfo),
      h('div', { class: 'page-actions' },
        h('button', { class: 'btn', type: 'button', onclick: newDraft }, 'New'),
        h('button', { class: 'btn', type: 'button', onclick: useTemplate, title: 'Start from an empty document with the markers in place' }, 'Template'),
        h('button', { class: 'btn', type: 'button', onclick: openFile }, 'Open file…'),
        h('button', { class: 'btn', type: 'button', onclick: save }, 'Save', h('kbd', null, 'Ctrl+S')),
        h('button', { class: 'btn', type: 'button', onclick: saveAs }, 'Save as…'))),
    editor.el,
    h('div', { class: 'ed-bar' },
      h('label', { class: 'ed-bar-deck' }, h('span', { class: 'field-label' }, 'Add to deck'), decks.el),
      addButton,
      hint),
  );
  updateBar();

  return () => {
    draft.text = editor.text;
    document.removeEventListener('keydown', onKey);
  };
}
