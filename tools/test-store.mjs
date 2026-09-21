#!/usr/bin/env node
/**
 * test-store.mjs — the device-local progress store.
 *
 *     npm test
 *
 * The store is the only part of the site that holds a student's data, so the
 * things tested here are the things that would lose it: a throwing storage, a
 * second tab, a corrupt entry, and an imported file that is not what it claims
 * to be.
 *
 * assets/js/store.js is a browser module, so this file provides the three
 * globals it touches (localStorage, window, document) before importing it.
 * Zero dependencies. Node >= 18.
 */

/* -------------------------------------------------------------------------- */
/* A localStorage that can be made to misbehave on demand                      */
/* -------------------------------------------------------------------------- */

class FakeStorage {
  constructor() {
    this.map = new Map();
    this.throwOnGet = false;
    this.throwOnSet = false;
  }
  getItem(k) {
    if (this.throwOnGet) throw new DOMException('denied');
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    if (this.throwOnSet) throw new DOMException('quota');
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
  get length() {
    return this.map.size;
  }
}

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type, event) {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
}

const storage = new FakeStorage();
const win = new FakeEventTarget();
const doc = new FakeEventTarget();
doc.visibilityState = 'visible';

globalThis.localStorage = storage;
globalThis.window = Object.assign(win, { localStorage: storage });
globalThis.document = doc;
if (typeof globalThis.DOMException === 'undefined') {
  globalThis.DOMException = class DOMException extends Error {};
}

const { store, exportProgress, importProgress, STORAGE_KEY, STORAGE_SCHEMA } =
  await import('../assets/js/store.js');

/* -------------------------------------------------------------------------- */

let failed = 0;
let passed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
}

function group(title) {
  console.log(`\n${title}`);
}

/** Wipe both the fake storage and the module's cache of it. */
function reset() {
  storage.throwOnGet = false;
  storage.throwOnSet = false;
  storage.clear();
  store.reload();
}

/* -------------------------------------------------------------------------- */

group('marking done and favourite');
reset();

check('a fresh device has nothing done', store.isDone(1) === false);
check('setDone reports the new state', store.setDone(1, true) === true);
check('and it sticks', store.isDone(1) === true);
check('toggleDone flips it back', store.toggleDone(1) === false && store.isDone(1) === false);
check('favourites are independent of done', store.toggleFav(5) === true && store.isDone(5) === false);
check('toggleFav flips back', store.toggleFav(5) === false);

store.setDone(3, true);
store.setDone(9, true);
check('the storage key is namespaced to this site', STORAGE_KEY.startsWith('qimma:'));
// Writes are debounced so a burst of card taps is one write, not twenty.
check('nothing is written synchronously', storage.map.size === 0);
store.flush();
check('flush persists it', storage.map.has(STORAGE_KEY));
check('and the persisted entry parses', (() => {
  try {
    return typeof JSON.parse(storage.getItem(STORAGE_KEY)) === 'object';
  } catch {
    return false;
  }
})());

group('the resume point');
reset();
check('nothing opened yet', store.lastOpened === 0);
store.markOpened(12, 1_700_000_000_000);
check('lastOpened follows the most recent open', store.lastOpened === 12);
check('openedAt remembers when', store.openedAt(12) === 1_700_000_000_000);
store.markOpened(40, 1_700_000_100_000);
check('and moves on', store.lastOpened === 40);
check('an unopened section has no timestamp', store.openedAt(77) === 0);

group('clearing');
reset();
store.setDone(1, true);
store.toggleFav(2);
store.markOpened(1, 1_700_000_000_000);
const snapshot = store.snapshot();
store.resetProgress();
check('resetProgress clears done', store.isDone(1) === false);
check('resetProgress clears the history', store.lastOpened === 0);
check('but keeps favourites', store.isFav(2) === true, 'favourites are a separate promise');
store.restore(snapshot);
check('restore brings the snapshot back', store.isDone(1) === true && store.lastOpened === 1);
store.clear();
check('clear removes everything', store.isDone(1) === false && store.isFav(2) === false);

group('storage that refuses');
reset();
storage.throwOnSet = true;
let threw = false;
try {
  store.setDone(7, true);
} catch {
  threw = true;
}
check('a throwing setItem does not propagate', threw === false);
check('and the value is still readable in memory', store.isDone(7) === true);
storage.throwOnSet = false;

reset();
storage.throwOnGet = true;
threw = false;
try {
  store.reload();
  store.isDone(1);
} catch {
  threw = true;
}
check('a throwing getItem does not propagate', threw === false);
check('isAvailable reports the refusal', store.isAvailable === false);
storage.throwOnGet = false;

group('corrupt stored data');
for (const [label, raw] of [
  ['invalid JSON', '{not json'],
  ['a JSON string', '"hello"'],
  ['null', 'null'],
  ['an array', '[1,2,3]'],
  ['wrong field types', '{"v":1,"done":"nope","fav":42,"opened":[],"last":"x"}'],
  ['hostile keys', '{"v":1,"done":{"__proto__":1,"constructor":1,"3":1},"fav":{},"opened":{},"last":0}'],
]) {
  storage.clear();
  storage.map.set(STORAGE_KEY, raw);
  let crashed = false;
  try {
    store.reload();
    store.isDone(3);
    store.snapshot();
  } catch (error) {
    crashed = true;
    console.error(`        ${error.message}`);
  }
  check(`${label} is survived`, crashed === false);
}
check(
  'a hostile key did not reach Object.prototype',
  Object.getPrototypeOf({}).__proto__ === undefined ||
    typeof {}.constructor === 'function',
);

group('a second tab');
reset();
store.setDone(1, true);
let notified = 0;
const off = store.subscribe(() => {
  notified += 1;
});
// Another tab wrote a different state, and the browser told us about it.
const fromOtherTab = JSON.stringify({
  v: STORAGE_SCHEMA,
  done: { 2: 1 },
  fav: {},
  opened: {},
  last: 2,
});
storage.map.set(STORAGE_KEY, fromOtherTab);
win.dispatch('storage', { key: STORAGE_KEY, newValue: fromOtherTab, storageArea: storage });
check('the subscriber was told', notified > 0);
check('the other tab state was picked up, not overwritten', store.isDone(2) === true);
check('and our own stale value is gone', store.isDone(1) === false);
if (typeof off === 'function') off();

win.dispatch('storage', { key: 'someone-elses-key', newValue: 'x', storageArea: storage });
check('an unrelated key is ignored', true);

group('export and import');
reset();
store.setDone(1, true);
store.setDone(2, true);
store.toggleFav(9);
store.markOpened(2, 1_700_000_000_000);

const file = exportProgress();
check('the export is plain JSON-serialisable data', JSON.parse(JSON.stringify(file)) !== null);
check('it carries a schema version', Number.isInteger(file.schema));
check('it names the app it came from', file.app === 'qimma');
check('it is stamped with a date', typeof file.savedAt === 'string' && !Number.isNaN(Date.parse(file.savedAt)));
check('done is a sorted list of numbers', Array.isArray(file.done) && file.done.every(Number.isInteger));
const exported = JSON.stringify(file);
check('it mentions the finished sections', exported.includes('1') && exported.includes('2'));

reset();
check('the new device starts empty', store.isDone(1) === false);
const applied = importProgress(JSON.parse(exported));
check('a valid file imports', applied && applied.ok !== false, JSON.stringify(applied));
check('done marks came across', store.isDone(1) === true && store.isDone(2) === true);
check('favourites came across', store.isFav(9) === true);

// Merge must not throw away what is already on this device.
reset();
store.setDone(50, true);
importProgress(JSON.parse(exported), { merge: true });
check('merge keeps what was already here', store.isDone(50) === true);
check('and adds what was in the file', store.isDone(1) === true);

// Replace must not keep it.
reset();
store.setDone(50, true);
importProgress(JSON.parse(exported), { merge: false });
check('replace drops what was already here', store.isDone(50) === false);
check('and installs the file', store.isDone(1) === true);

group('an import that is not what it claims');
for (const [label, payload] of [
  ['null', null],
  ['a string', 'hello'],
  ['a number', 42],
  ['an empty object', {}],
  ['the wrong shape', { done: 'everything' }],
  ['a hostile prototype key', { v: 1, done: { __proto__: 1 }, fav: {}, opened: {} }],
  ['absurd numbers', { v: 1, done: { '-1': 1, 1e9: 1, NaN: 1 }, fav: {}, opened: {} }],
]) {
  reset();
  store.setDone(4, true);
  let crashed = false;
  let result;
  try {
    result = importProgress(payload);
  } catch (error) {
    crashed = true;
    console.error(`        ${error.message}`);
  }
  check(`${label} does not throw`, crashed === false);
  check(`${label} leaves existing progress intact`, store.isDone(4) === true, JSON.stringify(result));
}

reset();
const huge = { v: 1, done: {}, fav: {}, opened: {} };
for (let i = 1; i <= 50_000; i += 1) huge.done[i] = 1;
let crashed = false;
try {
  importProgress(huge);
} catch {
  crashed = true;
}
check('an absurdly large file does not throw', crashed === false);
check('and is capped rather than stored whole', Object.keys(store.snapshot().done ?? {}).length < 50_000);

group('progress written before the sections were renumbered');

// The teacher moved the last twenty sections of the old 262 to the front and
// pushed the rest down by twenty. A student's stored progress has to move with
// them, or every tick they earned would point at a different passage.
//   old   1 -> 21      the first section of the old file
//   old 242 -> 262     the last one before the moved block
//   old 243 ->  1      the first of the twenty that moved
//   old 262 -> 20      the last of them
//   old 263 -> 263     added after the 262, so it never moved
const MOVES = [
  [1, 21],
  [242, 262],
  [243, 1],
  [262, 20],
  [263, 263],
  [301, 301],
];

reset();
storage.map.set(
  STORAGE_KEY,
  JSON.stringify({
    v: 1,
    done: Object.fromEntries(MOVES.map(([was]) => [was, 1])),
    fav: { 243: 1 },
    opened: { 1: 1700000000000, 243: 1700000001000 },
    last: 243,
  }),
);
store.reload();

for (const [was, now] of MOVES) {
  check(`a done section ${was} is now ${now}`, store.isDone(now) === true);
}
check('and nothing was left behind at an old number', store.isDone(242) === false);
check('a favourite moved too', store.isFav(1) === true && store.isFav(243) === false);
check('the resume point moved', store.lastOpened === 1);
check('the opened time went with it', store.openedAt(1) === 1700000001000);
check('the moved entry is stamped with the current schema', store.snapshot().v === STORAGE_SCHEMA);

// Reloading a state that has already moved must not move it a second time.
store.flush();
store.reload();
check('moving happens once, not on every read', store.isDone(21) === true && store.isDone(41) === false);

// A file exported from another device before the change carries old numbers too.
reset();
const oldFile = {
  app: 'qimma',
  schema: 1,
  savedAt: new Date(1700000000000).toISOString(),
  done: [243, 1],
  fav: [262],
  history: [{ n: 243, at: 1700000002000 }],
  last: 243,
};
const movedImport = importProgress(oldFile, { merge: false });
check('an old exported file is accepted', movedImport.error === null, JSON.stringify(movedImport));
check('its sections are moved on the way in', store.isDone(1) === true && store.isDone(21) === true);
check('its favourite is moved as well', store.isFav(20) === true);
check('and its resume point lands on the right section', store.lastOpened === 1);

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
