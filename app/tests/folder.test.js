import { createMemoryFolder } from './memfs.js';
import { defineFolderTests } from './folder.suite.js';
import { defineStoreTests } from './store.suite.js';

defineFolderTests('in memory', async () => createMemoryFolder());
defineStoreTests('in memory', async () => createMemoryFolder());
