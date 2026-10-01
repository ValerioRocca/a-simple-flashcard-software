// Reading and writing files the user chooses (drafts, exports, imports).

const TYPES = {
  markdown: { description: 'Markdown document', accept: { 'text/markdown': ['.md', '.markdown', '.txt'] } },
  json: { description: 'JSON file', accept: { 'application/json': ['.json'] } },
};

const isAbort = (error) => error?.name === 'AbortError';

/** A deck name as a file name: no characters Windows refuses. */
export function fileNameFor(name, extension) {
  const clean = String(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return `${clean || 'flashcards'}.${extension}`;
}

export async function writeToHandle(handle, text) {
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      // nothing left to clean up
    }
    throw error;
  }
}

/** Ask where to save, then write. Returns the file handle, or null when the user cancels. */
export async function saveTextAs(suggestedName, text, type) {
  let handle;
  try {
    handle = await window.showSaveFilePicker({ suggestedName, types: [TYPES[type]] });
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }
  await writeToHandle(handle, text);
  return handle;
}

/** Ask for a file and read it. Returns `{ handle, name, text }`, or null when the user cancels. */
export async function openTextFile(type) {
  let handle;
  try {
    [handle] = await window.showOpenFilePicker({ types: [TYPES[type]], multiple: false });
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }
  const file = await handle.getFile();
  return { handle, name: file.name, text: await file.text() };
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Decode `data:image/png;base64,…`. Returns null for anything else. */
export function dataUrlToBlob(dataUrl) {
  const match = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]*)$/i.exec(String(dataUrl));
  if (!match) return null;
  try {
    const binary = atob(match[2].replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: match[1].toLowerCase() });
  } catch {
    return null;
  }
}
