// The open collection and its link to the data file.
//
// The collection lives in memory while the app is open. Every change is
// written to data.json straight away (there is no Save button), and nothing is
// kept in the browser's own storage.
//
// Before each write the file on disk is compared with what this window last
// read or wrote. If something else changed it (another window, another program,
// a sync from another PC) the write is held back and a `conflict` is raised
// instead of silently overwriting it.

import { createCollection, parseCollection, serializeCollection } from './core/collection.js';
import { createScheduler } from './core/scheduler.js';
import {
  backupIfDue as backupFolderIfDue, dataFileStamp, listBackups, readDataFile, sameStamp, writeDataFile,
} from './storage/folder.js';

// A write can fail for a moment while another program holds the file (an
// antivirus scan, a sync client uploading it). Such failures are retried
// before the user is told; a refusal or a missing folder is reported at once.
const RETRY_DELAYS_MS = [150, 400, 1000];
const PERMANENT_ERRORS = new Set(['NotAllowedError', 'SecurityError', 'NotFoundError', 'QuotaExceededError']);

async function withRetries(action, delays) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (attempt >= delays.length || PERMANENT_ERRORS.has(error?.name)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

/** The folder has no data file (and the caller did not ask to create one). */
export class NoDataError extends Error {
  constructor() {
    super('This folder has no flashcard data.');
    this.name = 'NoDataError';
  }
}

/** The same data is already open in another tab or window. */
export class BusyError extends Error {
  constructor() {
    super('This data folder is already open in another tab or window.');
    this.name = 'BusyError';
  }
}

export class Store {
  constructor() {
    this.listeners = new Map();
    this.retryDelays = RETRY_DELAYS_MS;
    this.reset();
  }

  reset() {
    this.dir = null;
    this.col = null;
    this.stamp = null;
    this.lastText = null;
    this.dirty = false;
    this.flushing = null;
    this.conflict = null;
    this.error = null;
    this.status = 'closed';
    this.releaseLock = null;
    this.lastBackup = null;
    this.backupCount = 0;
    this.backupError = null;
    this.cachedScheduler = null;
    this.writes = 0;
  }

  // -------------------------------------------------------------- events

  /** Listen for `change`, `status`, `conflict`, `open` or `close`. Returns a function that stops listening. */
  on(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    return () => this.listeners.get(type)?.delete(listener);
  }

  emit(type, detail) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(detail);
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', status);
  }

  get isOpen() {
    return this.col !== null;
  }

  // -------------------------------------------------------------- opening and closing

  /**
   * Open the data folder behind `dir`.
   * `create`: start a new collection when the folder has no data file.
   * `lock(id)`: optional; resolves to a release function, or to null when the
   * collection is already open elsewhere.
   */
  async open(dir, { create = false, lock = null, now = new Date() } = {}) {
    const data = await readDataFile(dir);
    let col;
    if (data) {
      col = parseCollection(data.text);
      col.images = null;
    } else {
      if (!create) throw new NoDataError();
      col = createCollection(now);
    }

    let release = null;
    if (lock) {
      release = await lock(col.id);
      if (!release) throw new BusyError();
    }

    let text = data?.text;
    let stamp = data?.stamp;
    if (!data) {
      try {
        text = serializeCollection(col, { savedAt: now });
        stamp = await writeDataFile(dir, text);
      } catch (error) {
        release?.();
        throw error;
      }
    }

    this.reset();
    this.dir = dir;
    this.col = col;
    this.stamp = stamp;
    this.lastText = text;
    this.releaseLock = release;
    this.status = 'saved';

    // A failed backup must not keep the user from their cards.
    try {
      await this.backupIfDue(now, text);
    } catch (error) {
      this.backupError = error;
    }
    this.emit('open');
    this.emit('status', this.status);
  }

  async close() {
    if (!this.isOpen) return;
    await this.flush();
    this.releaseLock?.();
    this.reset();
    this.emit('close');
    this.emit('status', this.status);
  }

  // -------------------------------------------------------------- changing and saving

  /**
   * Apply a change to the collection and save it.
   * `mutate(col)` is one of the functions from core/; its result is returned.
   */
  change(mutate) {
    if (!this.isOpen) throw new Error('No data folder is open.');
    const result = mutate(this.col);
    this.touch();
    return result;
  }

  touch() {
    this.dirty = true;
    if (!this.conflict) this.setStatus('pending');
    this.emit('change');
    queueMicrotask(() => {
      this.flush();
    });
  }

  /** Write pending changes. Resolves when the file is up to date, or when saving had to stop. */
  flush() {
    if (!this.flushing) {
      this.flushing = this.flushLoop().finally(() => {
        this.flushing = null;
        // A change that arrived just as the loop ended.
        if (this.isOpen && this.dirty && !this.conflict && !this.error) this.flush();
      });
    }
    return this.flushing;
  }

  async flushLoop() {
    while (this.isOpen && this.dirty && !this.conflict) {
      this.setStatus('saving');
      try {
        const changed = await withRetries(() => this.changedOnDisk(), this.retryDelays);
        if (changed) {
          this.raiseConflict(changed);
          return;
        }
        this.dirty = false;
        const text = serializeCollection(this.col);
        this.stamp = await withRetries(() => writeDataFile(this.dir, text), this.retryDelays);
        this.lastText = text;
        this.writes++;
        this.error = null;
      } catch (error) {
        this.dirty = true;
        this.error = error;
        this.setStatus('error');
        return;
      }
    }
    if (this.isOpen && !this.dirty && !this.conflict) this.setStatus('saved');
  }

  /** True while there are changes not yet on disk. */
  get hasUnsavedChanges() {
    return this.dirty || this.flushing !== null;
  }

  // -------------------------------------------------------------- changes made elsewhere

  // Returns null when the file is as this window left it, otherwise
  // `{ missing }`. The stamp (modification time and size) is cheap to read;
  // only when it differs is the content compared, so that a program which
  // merely touches the file does not raise a false alarm.
  async changedOnDisk() {
    const current = await dataFileStamp(this.dir);
    if (sameStamp(current, this.stamp)) return null;
    if (!current) return { missing: true };
    const data = await readDataFile(this.dir);
    if (data && data.text === this.lastText) {
      this.stamp = data.stamp;
      return null;
    }
    return { missing: !data };
  }

  raiseConflict(conflict) {
    this.conflict = conflict;
    this.setStatus('conflict');
    this.emit('conflict', conflict);
  }

  /** Look for a change made elsewhere without waiting for the next save. */
  async checkDisk() {
    if (!this.isOpen || this.conflict || this.flushing) return;
    const writes = this.writes;
    try {
      const changed = await this.changedOnDisk();
      if (!changed || !this.isOpen || this.conflict) return;
      // A save of our own ran meanwhile: what was seen on disk may be that
      // save, and it made the same check itself before writing.
      if (this.flushing || this.writes !== writes) return;
      this.raiseConflict(changed);
    } catch {
      // The next save will report it.
    }
  }

  /**
   * Settle a conflict.
   * `reload`: take the version on disk, dropping this window's unsaved changes.
   * `overwrite`: keep this window's version and write it over the file.
   */
  async resolveConflict(choice) {
    if (!this.conflict) return;
    if (choice === 'reload') {
      const data = await readDataFile(this.dir);
      if (!data) throw new NoDataError();
      const col = parseCollection(data.text);
      col.images = null;
      this.col = col;
      this.stamp = data.stamp;
      this.lastText = data.text;
      this.cachedScheduler = null;
    } else {
      const text = serializeCollection(this.col);
      this.stamp = await writeDataFile(this.dir, text);
      this.lastText = text;
      this.writes++;
    }
    this.dirty = false;
    this.conflict = null;
    this.error = null;
    this.setStatus('saved');
    this.emit('change');
  }

  // -------------------------------------------------------------- backups

  /** Make the daily backup if it is due. Returns the name of the backup made, or null. */
  async backupIfDue(now = new Date(), text = null) {
    const name = await backupFolderIfDue(this.dir, now, text);
    const backups = await listBackups(this.dir);
    this.lastBackup = backups.at(-1) ?? null;
    this.backupCount = backups.length;
    this.backupError = null;
    return name;
  }

  // -------------------------------------------------------------- scheduler

  /** The scheduler for the current settings. */
  get scheduler() {
    const settings = this.col.settings;
    if (!this.cachedScheduler || this.cachedScheduler.settings !== settings) {
      this.cachedScheduler = { settings, scheduler: createScheduler(settings) };
    }
    return this.cachedScheduler.scheduler;
  }
}

export const store = new Store();
