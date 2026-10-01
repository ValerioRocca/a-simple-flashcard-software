// Runs the tests that need no browser:  node app/tests/run-node.mjs
// The full set, including rendering and real file handles, runs in the
// browser at http://localhost:8372/tests/

import { runAll } from './harness.js';
import './suites.js';

const { results, passed, failed } = await runAll((result) => {
  if (!result.ok) console.log(`FAIL  ${result.suite} › ${result.name}\n${result.error}\n`);
});
console.log(`${passed} passed, ${failed} failed, ${results.length} total`);
process.exit(failed ? 1 : 0);
