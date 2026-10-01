// Editing one existing card, in the same split editor used for writing cards.

import { cardsOfNote, updateNote } from '../core/collection.js';
import { entryToFields, noteToEntry } from '../core/deck-io.js';
import { serializeQA } from '../core/qa-format.js';
import { store } from '../store.js';
import { createCardEditor } from './card-editor.js';
import { confirmDialog, h, showDialog } from './dom.js';

/** Open the editor for a note. Resolves to true when the note was changed. */
export async function editNote(noteId) {
  const note = store.col.notes.get(noteId);
  if (!note) return false;

  const error = h('p', { class: 'field-error', hidden: true });
  const editor = createCardEditor({ text: serializeQA([noteToEntry(note)]), single: true });

  const save = async (close) => {
    const { cards, problemCount } = editor.parsed;
    if (problemCount > 0 || cards.length !== 1) {
      error.textContent = problemCount > 0
        ? 'Fix the problem shown in the preview before saving.'
        : 'This editor must hold exactly one card: one **Q:** and one **A:**.';
      error.hidden = false;
      return;
    }
    const fields = entryToFields(cards[0]);
    const second = cardsOfNote(store.col, noteId).find((card) => card.ord === 1);
    if (second && !fields.reversed) {
      const reviewed = second.reps > 0;
      const proceed = await confirmDialog({
        title: 'Remove the reversed card?',
        message: reviewed
          ? 'Without “**Reversed:** yes” the answer-to-question card is deleted, together with its review history.'
          : 'Without “**Reversed:** yes” the answer-to-question card is deleted.',
        confirmLabel: 'Remove it',
        danger: true,
      });
      if (!proceed) return;
    }
    try {
      store.change((col) => updateNote(col, noteId, fields));
      close(true);
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
    }
  };

  const result = await showDialog({
    title: 'Edit card',
    wide: true,
    content: [editor.el, error],
    buttons: (close) => [
      h('button', { class: 'btn', type: 'button', onclick: () => close(false) }, 'Cancel'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => save(close) }, 'Save changes'),
    ],
    onOpen: () => editor.focus(),
  });
  return result === true;
}
