// An in-memory stand-in for the directory handle the browser returns from the
// folder picker. It implements only what the app uses.

function notFound(name) {
  return new DOMException(`“${name}” was not found.`, 'NotFoundError');
}

class MemFileHandle {
  constructor(name, clock) {
    this.kind = 'file';
    this.name = name;
    this.clock = clock;
    this.blob = new Blob([]);
    this.lastModified = clock.tick();
  }

  async getFile() {
    return new File([this.blob], this.name, { type: this.blob.type, lastModified: this.lastModified });
  }

  async createWritable() {
    const parts = [];
    let type = '';
    let open = true;
    return {
      write: async (data) => {
        if (!open) throw new Error('The stream is closed.');
        if (data instanceof Blob && data.type) type = data.type;
        parts.push(data);
      },
      close: async () => {
        open = false;
        this.blob = new Blob(parts, { type });
        this.lastModified = this.clock.tick();
      },
      abort: async () => {
        open = false;
      },
    };
  }
}

class MemDirHandle {
  constructor(name, clock) {
    this.kind = 'directory';
    this.name = name;
    this.clock = clock;
    this.children = new Map();
  }

  async getFileHandle(name, { create = false } = {}) {
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== 'file') throw new DOMException('Not a file.', 'TypeMismatchError');
      return existing;
    }
    if (!create) throw notFound(name);
    const handle = new MemFileHandle(name, this.clock);
    this.children.set(name, handle);
    return handle;
  }

  async getDirectoryHandle(name, { create = false } = {}) {
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== 'directory') throw new DOMException('Not a directory.', 'TypeMismatchError');
      return existing;
    }
    if (!create) throw notFound(name);
    const handle = new MemDirHandle(name, this.clock);
    this.children.set(name, handle);
    return handle;
  }

  async removeEntry(name) {
    if (!this.children.delete(name)) throw notFound(name);
  }

  async* entries() {
    yield* [...this.children.entries()];
  }

  async queryPermission() {
    return 'granted';
  }

  async requestPermission() {
    return 'granted';
  }
}

/** A fresh, empty folder. Every write gets a later modification time than the one before. */
export function createMemoryFolder(name = 'memory') {
  let time = 1_700_000_000_000;
  const clock = { tick: () => (time += 1000) };
  return new MemDirHandle(name, clock);
}

/** Shortcut for tests: write a text file directly, as another program would. */
export async function writeText(dir, name, text) {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

export async function readText(dir, name) {
  const handle = await dir.getFileHandle(name);
  return (await handle.getFile()).text();
}

export async function listNames(dir) {
  const names = [];
  for await (const [name] of dir.entries()) names.push(name);
  return names.sort();
}
