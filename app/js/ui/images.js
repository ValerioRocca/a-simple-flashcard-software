// Pictures on cards. They are files in the data folder's images/ directory;
// a card refers to one as ![](images/name.png).

import { store } from '../store.js';
import { isImageType, readImage, saveImage } from '../storage/folder.js';
import { reportError } from './dom.js';

const urls = new Map();

async function load(name) {
  try {
    const file = await readImage(store.dir, name);
    return file ? URL.createObjectURL(file) : null;
  } catch {
    return null;
  }
}

/** A URL the page can show the picture from, or null when the file is missing. */
export function imageUrl(name) {
  if (!urls.has(name)) urls.set(name, load(name));
  return urls.get(name);
}

/** Forget every picture URL (when the folder is closed or pictures were added behind our back). */
export function resetImages() {
  for (const pending of urls.values()) {
    pending.then((url) => url && URL.revokeObjectURL(url));
  }
  urls.clear();
}

function insertAtCursor(textarea, text) {
  const { selectionStart, selectionEnd } = textarea;
  textarea.setRangeText(text, selectionStart, selectionEnd, 'end');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

async function addImages(textarea, files) {
  try {
    for (const file of files) {
      const name = await saveImage(store.dir, file);
      insertAtCursor(textarea, `![](images/${name})`);
    }
  } catch (error) {
    reportError(error, 'The picture could not be added');
  }
}

const picturesIn = (list) => [...(list ?? [])].filter((file) => isImageType(file.type));

/** Let pictures be pasted or dropped into a text box. */
export function acceptImages(textarea) {
  textarea.addEventListener('paste', (event) => {
    // Office programs put a picture of the copied text next to the text itself: keep the text.
    if (event.clipboardData?.getData('text/plain')) return;
    const files = picturesIn(event.clipboardData?.files);
    if (!files.length) return;
    event.preventDefault();
    addImages(textarea, files);
  });
  textarea.addEventListener('dragover', (event) => {
    if ([...(event.dataTransfer?.types ?? [])].includes('Files')) event.preventDefault();
  });
  textarea.addEventListener('drop', (event) => {
    const files = picturesIn(event.dataTransfer?.files);
    if (!files.length) return;
    event.preventDefault();
    addImages(textarea, files);
  });
}
