// Everything the app does on disk, through the File System Access API.
// A data folder holds:
//   data.json   the collection
//   images/     pictures used on cards
//   backups/    dated copies of data.json
// Functions take the folder's directory handle, so the tests can run them
// against an in-memory stand-in.

import { randomId } from '../core/ids.js';
import { DAY, toDate } from '../core/time.js';

export const DATA_FILE = 'data.json';
export const IMAGES_DIR = 'images';
export const BACKUPS_DIR = 'backups';
export const BACKUP_KEEP = 7;
export const BACKUP_EVERY_MS = DAY;

const isNotFound = (error) => error?.name === 'NotFoundError';

async function getFileHandle(dir, name) {
  try {
    return await dir.getFileHandle(name);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function getDirHandle(dir, name) {
  try {
    return await dir.getDirectoryHandle(name);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

const stampOf = (file) => ({ lastModified: file.lastModified, size: file.size });

// The browser writes to a temporary file and swaps it in on close, so a crash
// in the middle leaves the previous file intact.
async function writeFile(dir, name, data) {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      // nothing left to clean up
    }
    throw error;
  }
  return stampOf(await handle.getFile());
}

// ---------------------------------------------------------------- data file

/** `{ text, stamp }`, or null when the folder has no data file. */
export async function readDataFile(dir) {
  const handle = await getFileHandle(dir, DATA_FILE);
  if (!handle) return null;
  const file = await handle.getFile();
  return { text: await file.text(), stamp: stampOf(file) };
}

/** Write the data file; returns its new stamp. */
export function writeDataFile(dir, text) {
  return writeFile(dir, DATA_FILE, text);
}

/** `{ lastModified, size }` of the data file, or null when it is missing. */
export async function dataFileStamp(dir) {
  const handle = await getFileHandle(dir, DATA_FILE);
  return handle ? stampOf(await handle.getFile()) : null;
}

export const sameStamp = (a, b) => Boolean(a && b) && a.lastModified === b.lastModified && a.size === b.size;

/** What a freshly picked folder contains. */
export async function inspectFolder(dir) {
  let hasData = false;
  let isEmpty = true;
  let hasServer = false;
  let hasAppDir = false;
  for await (const [name, handle] of dir.entries()) {
    isEmpty = false;
    if (name === DATA_FILE && handle.kind === 'file') hasData = true;
    if (name === 'serve.py' && handle.kind === 'file') hasServer = true;
    if (name === 'app' && handle.kind === 'directory') hasAppDir = true;
  }
  return { hasData, isEmpty, looksLikeApp: hasServer && hasAppDir };
}

// ---------------------------------------------------------------- backups

const RE_BACKUP = /^data-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.json$/;
const pad = (n) => String(n).padStart(2, '0');

/** `data-2026-10-01_18-47-05.json`, in local time. */
export function backupName(date) {
  const d = toDate(date);
  return `data-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.json`;
}

export function backupTime(name) {
  const m = RE_BACKUP.exec(name);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  return new Date(y, mo - 1, d, h, mi, s);
}

/** Backups in the folder, oldest first. Files with other names are ignored. */
export async function listBackups(dir) {
  const backups = await getDirHandle(dir, BACKUPS_DIR);
  if (!backups) return [];
  const list = [];
  for await (const [name, handle] of backups.entries()) {
    const time = handle.kind === 'file' ? backupTime(name) : null;
    if (time) list.push({ name, time });
  }
  return list.sort((a, b) => a.time - b.time);
}

/**
 * Copy the data file into backups/ when the newest backup is at least 24 hours
 * old (or there is none), then keep only the newest seven.
 * `text` is the data file's content if the caller already has it.
 * Returns the name of the backup made, or null.
 */
export async function backupIfDue(dir, now = new Date(), text = null) {
  const existing = await listBackups(dir);
  const nowMs = toDate(now).getTime();
  // A backup dated in the future (the clock was wrong once) is not waited for.
  const newest = existing.filter((b) => b.time.getTime() <= nowMs).at(-1);
  const due = !newest || nowMs - newest.time.getTime() >= BACKUP_EVERY_MS;
  if (!due) return null;

  let content = text;
  if (content === null) {
    const data = await readDataFile(dir);
    if (!data) return null;
    content = data.text;
  }

  const backups = await dir.getDirectoryHandle(BACKUPS_DIR, { create: true });
  const name = backupName(now);
  if (existing.some((b) => b.name === name)) return null;
  await writeFile(backups, name, content);

  const all = [...existing.map((b) => b.name), name].sort();
  for (const old of all.slice(0, Math.max(0, all.length - BACKUP_KEEP))) {
    await backups.removeEntry(old);
  }
  return name;
}

// ---------------------------------------------------------------- images

const RE_IMAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
};

export const isImageType = (type) => Object.hasOwn(EXTENSIONS, type);
export const isImageName = (name) => RE_IMAGE_NAME.test(name);

/** Store a picture in images/ under a new name; returns the name. */
export async function saveImage(dir, blob, now = new Date()) {
  const extension = EXTENSIONS[blob.type];
  if (!extension) throw new Error('Only pictures can be added (PNG, JPEG, GIF, WebP, SVG).');
  const d = toDate(now);
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const name = `img-${stamp}-${randomId(4)}.${extension}`;
  const images = await dir.getDirectoryHandle(IMAGES_DIR, { create: true });
  await writeFile(images, name, blob);
  return name;
}

/** Store a picture under a given name (used when importing a deck). */
export async function writeImage(dir, name, blob) {
  if (!isImageName(name)) throw new Error(`“${name}” is not a valid image name.`);
  const images = await dir.getDirectoryHandle(IMAGES_DIR, { create: true });
  await writeFile(images, name, blob);
}

/** The picture as a File, or null when it does not exist. */
export async function readImage(dir, name) {
  if (!isImageName(name)) return null;
  const images = await getDirHandle(dir, IMAGES_DIR);
  if (!images) return null;
  const handle = await getFileHandle(images, name);
  return handle ? handle.getFile() : null;
}

// ---------------------------------------------------------------- is the folder inside the app?

/**
 * True when the folder lies inside the app's own folder (the Git clone), where
 * the cards could end up pushed to GitHub. A folder handle does not reveal its
 * path, so a marker file is dropped in it and the local server is asked whether
 * it can see that file. Returns null when the server cannot tell.
 */
export async function isInsideApp(dir, fetchFn = globalThis.fetch) {
  const name = `flashcards-probe-${randomId(16)}.txt`;
  try {
    await writeFile(dir, name, 'probe');
    const response = await fetchFn(`/__inside?probe=${encodeURIComponent(name)}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const answer = await response.json();
    return typeof answer.inside === 'boolean' ? answer.inside : null;
  } catch {
    return null;
  } finally {
    try {
      await dir.removeEntry(name);
    } catch {
      // the marker was never written
    }
  }
}

// ---------------------------------------------------------------- permission

export async function hasPermission(handle) {
  if (!handle.queryPermission) return true;
  return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
}

/** Must be called from a click: the browser may ask the user to confirm. */
export async function requestPermission(handle) {
  if (!handle.requestPermission) return true;
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}
