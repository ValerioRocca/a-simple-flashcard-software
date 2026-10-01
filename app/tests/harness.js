// A minimal test harness that runs unchanged in the browser (tests/index.html)
// and in Node (tests/run-node.mjs), so the app needs no test tooling installed.

const suites = [];
let current = null;

export function describe(name, define) {
  current = { name, tests: [] };
  suites.push(current);
  define();
  current = null;
}

export function test(name, fn) {
  if (!current) throw new Error('test() must be called inside describe()');
  current.tests.push({ name, fn });
}

function show(value) {
  if (value instanceof Map) return `Map(${show([...value])})`;
  if (value instanceof Set) return `Set(${show([...value])})`;
  try {
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
}

function isDeepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (a instanceof Map || b instanceof Map) {
    return a instanceof Map && b instanceof Map && isDeepEqual([...a], [...b]);
  }
  if (a instanceof Set || b instanceof Set) {
    return a instanceof Set && b instanceof Set && isDeepEqual([...a], [...b]);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => Object.hasOwn(b, key) && isDeepEqual(a[key], b[key]));
}

function fail(message, detail) {
  throw new Error(message ? `${message}: ${detail}` : detail);
}

export const assert = {
  ok(value, message) {
    if (!value) fail(message, `expected a truthy value, got ${show(value)}`);
  },
  equal(actual, expected, message) {
    if (!Object.is(actual, expected)) fail(message, `expected ${show(expected)}, got ${show(actual)}`);
  },
  notEqual(actual, unexpected, message) {
    if (Object.is(actual, unexpected)) fail(message, `expected something other than ${show(unexpected)}`);
  },
  deepEqual(actual, expected, message) {
    if (!isDeepEqual(actual, expected)) fail(message, `expected ${show(expected)}, got ${show(actual)}`);
  },
  match(text, pattern, message) {
    if (!pattern.test(text)) fail(message, `expected ${show(text)} to match ${pattern}`);
  },
  throws(fn, pattern, message) {
    let error = null;
    try {
      fn();
    } catch (caught) {
      error = caught;
    }
    if (!error) fail(message, 'expected an error, none was thrown');
    if (pattern && !pattern.test(error.message)) fail(message, `error ${show(error.message)} does not match ${pattern}`);
  },
  async rejects(promise, pattern, message) {
    let error = null;
    try {
      await (typeof promise === 'function' ? promise() : promise);
    } catch (caught) {
      error = caught;
    }
    if (!error) fail(message, 'expected a rejection, the promise resolved');
    if (pattern && !pattern.test(error.message)) fail(message, `error ${show(error.message)} does not match ${pattern}`);
  },
};

/** How many suites are registered so far (see `since` below). */
export const suiteCount = () => suites.length;

/**
 * Run the registered tests; `onResult` is called after each one.
 * `since` skips the first suites, to run only those registered after a given point.
 */
export async function runAll(onResult = () => {}, { since = 0 } = {}) {
  const results = [];
  for (const suite of suites.slice(since)) {
    for (const { name, fn } of suite.tests) {
      const result = { suite: suite.name, name, ok: true, error: null };
      try {
        await fn();
      } catch (error) {
        result.ok = false;
        result.error = error?.stack || String(error);
      }
      results.push(result);
      onResult(result);
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  return { results, failed, passed: results.length - failed };
}
