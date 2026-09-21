/**
 * Device-local progress store.
 *
 * The dataset carries no per-student state, so "done", "favourite" and
 * "opened" live only in this browser's localStorage. Nothing is ever sent
 * anywhere. Every storage call is wrapped: storage throws in some private
 * windows and when site data is blocked, and in that case the store keeps
 * working in memory for the rest of the visit.
 *
 * Because the state never leaves the device, a student who changes phone or
 * browser would lose it. So the store can also hand its state out as a plain
 * object and take one back — `exportProgress()` / `importProgress()`. That
 * file is the only way progress ever travels, and the student carries it.
 *
 * Public surface, all on `store` (the two transfer helpers are also named
 * exports, so `import { importProgress }` works as well):
 *
 *   isAvailable          false once storage has refused us; state stays in memory
 *   isDone(n) isFav(n)   flags for one section number
 *   setDone(n, on) toggleDone(n) toggleFav(n)
 *   markOpened(n, at?)   records the resume point and the "opened…" time
 *   lastOpened  openedAt(n)
 *   snapshot() restore(s) resetProgress() clear() reload() flush()
 *   subscribe(fn)        fires when another tab, or an import, replaces the state
 *   exportProgress() importProgress(data, { merge })
 */

const KEY = 'qimma:v1';

/**
 * Shape version of both the stored entry and the exported file.
 *
 * 1 — the original.
 * 2 — the sections were renumbered (see below). The shape did not change; the
 *     version did, because the numbers in it now mean different passages.
 */
const SCHEMA = 2;

/**
 * Schema 1 -> 2: the sections were renumbered.
 *
 * The teacher re-ordered his compilation — the last twenty sections of the old
 * 262 moved to the front, and everything before them moved down by twenty — and
 * the site follows that file (tools/build-order.py). Progress is stored against
 * section numbers, so an entry written before the change points at the wrong
 * passage until it is moved with them: a student's «القسم 1» was «خلق المؤمن
 * والحقد» only after the move, and «الزلازل والسكري» before it.
 *
 * The arithmetic is written out here rather than read from the dataset. It is
 * one fixed step in the past, it must give the same answer whether or not
 * exams.json has loaded, and a future renumbering gets its own step rather than
 * editing this one.
 */
const MOVED_TO_FRONT = 20;
const OLD_LAST_SECTION = 262;

function renumberFromV1(n) {
  if (n > OLD_LAST_SECTION) return n;
  if (n > OLD_LAST_SECTION - MOVED_TO_FRONT) return n - (OLD_LAST_SECTION - MOVED_TO_FRONT);
  return n + MOVED_TO_FRONT;
}

/** Move a whole state from the old numbering to the current one, in place. */
function migrateFromV1(state) {
  const move = (map) => {
    const out = {};
    for (const [key, value] of Object.entries(map)) out[renumberFromV1(Number(key))] = value;
    return out;
  };
  state.done = move(state.done);
  state.fav = move(state.fav);
  state.opened = move(state.opened);
  state.last = isExamNumber(state.last) ? renumberFromV1(state.last) : 0;
}

/**
 * An imported file is untrusted input that lands in a quota-limited store, so
 * each of its lists is read up to this many entries. The site has 301
 * sections: anything near this ceiling is a mistake or an attack, not progress.
 */
const MAX_ENTRIES = 2000;

/** Exposed so the caller and the tests never have to repeat the literals. */
export const STORAGE_KEY = KEY;
export const STORAGE_SCHEMA = SCHEMA;

/**
 * A brand-new state object. Built by a function rather than spread from a
 * shared constant: a shallow copy would share the nested maps, so "clearing"
 * would hand back the very objects that still hold the old progress.
 */
const fresh = () => ({ v: SCHEMA, done: {}, fav: {}, opened: {}, last: 0 });

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isExamNumber = (value) => Number.isInteger(value) && value > 0;

/** Keep only positive-integer keys; values become 1 (flags) or a timestamp. */
function cleanMap(value, timestamps = false) {
  const out = {};
  if (!isRecord(value)) return out;
  for (const [key, raw] of Object.entries(value)) {
    const n = Number(key);
    if (!isExamNumber(n)) continue;
    if (timestamps) {
      const at = Number(raw);
      if (at > 0) out[n] = at;
    } else if (raw) {
      out[n] = 1;
    }
  }
  return out;
}

/** Parse a stored entry defensively: anything malformed is dropped, not trusted. */
function parse(raw) {
  const parsed = JSON.parse(raw);
  const next = fresh();
  if (!isRecord(parsed)) return next;
  next.done = cleanMap(parsed.done);
  next.fav = cleanMap(parsed.fav);
  next.opened = cleanMap(parsed.opened, true);
  next.last = isExamNumber(parsed.last) ? parsed.last : 0;
  // An entry written before the renumbering names its sections by their old
  // numbers. Move it here, once, so nothing downstream has to know: `next` came
  // from fresh(), so it is stamped with the current schema and the next write
  // settles it.
  if ((Number(parsed.v) || 1) < SCHEMA) migrateFromV1(next);
  return next;
}

let available = true;
let cache = null;

function read() {
  if (cache) return cache;
  cache = fresh();

  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    available = false; // blocked storage: stay in memory
    return cache;
  }

  if (raw) {
    try {
      cache = parse(raw);
    } catch {
      /* corrupted entry: start clean; the next write replaces it */
    }
  }
  return cache;
}

let flushHandle = 0;

function flush() {
  clearTimeout(flushHandle);
  flushHandle = 0;
  if (!available || !cache) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    available = false;
  }
}

/** Coalesce bursts of changes; `flush()` runs early whenever the page is hidden. */
function write() {
  if (!available) return;
  clearTimeout(flushHandle);
  flushHandle = setTimeout(flush, 120);
}

const listeners = new Set();

/** Only for changes the caller did not make itself: another tab, or an import. */
function notify() {
  listeners.forEach((fn) => fn());
}

if (typeof window !== 'undefined') {
  // Opening an exam hides this tab, and mobile browsers may discard a hidden
  // tab without warning — so never leave a change sitting in the debounce.
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  // Another tab of the portal changed progress: drop the stale copy and let
  // the page repaint from the fresh one instead of overwriting it later.
  window.addEventListener('storage', (event) => {
    if (event.key !== KEY && event.key !== null) return;
    clearTimeout(flushHandle);
    flushHandle = 0;
    cache = null;
    notify();
  });
}

/* ---- transfer between devices --------------------------------------------- */

/**
 * Read a list of section numbers out of an imported file. Two shapes are
 * accepted: the array this store exports, and the `{ "7": 1 }` map a student
 * may have copied straight out of localStorage. Never throws — whatever cannot
 * be read is counted and dropped.
 *
 * @returns {{ list: number[], ignored: number }}
 */
function readNumbers(value) {
  const list = [];
  const seen = new Set();
  let ignored = 0;

  let raw;
  if (Array.isArray(value)) {
    raw = value;
  } else if (isRecord(value)) {
    raw = Object.entries(value)
      .filter(([, on]) => Boolean(on))
      .map(([key]) => key);
  } else {
    // A missing section is not a defect; a section of the wrong type is one.
    return { list, ignored: value === undefined || value === null ? 0 : 1 };
  }

  for (const item of raw) {
    if (list.length >= MAX_ENTRIES) {
      ignored += 1;
      continue;
    }
    const n = Number(isRecord(item) ? item.n : item);
    if (!isExamNumber(n) || seen.has(n)) {
      ignored += 1;
      continue;
    }
    seen.add(n);
    list.push(n);
  }
  return { list, ignored };
}

/**
 * Same, for the opened-at history: `[{ n, at }]`, a bare list of numbers, or
 * the `{ "7": 1737… }` map. `fallbackAt` dates an entry whose own timestamp is
 * unusable, so a real visit keeps its place instead of being thrown away.
 *
 * @returns {{ list: Array<{ n: number, at: number }>, ignored: number }}
 */
function readHistory(value, fallbackAt) {
  const list = [];
  const seen = new Set();
  let ignored = 0;

  let raw;
  if (Array.isArray(value)) {
    raw = value;
  } else if (isRecord(value)) {
    raw = Object.entries(value).map(([n, at]) => ({ n, at }));
  } else {
    return { list, ignored: value === undefined || value === null ? 0 : 1 };
  }

  for (const item of raw) {
    if (list.length >= MAX_ENTRIES) {
      ignored += 1;
      continue;
    }
    const entry = isRecord(item) ? item : { n: item, at: 0 };
    const n = Number(entry.n);
    if (!isExamNumber(n) || seen.has(n)) {
      ignored += 1;
      continue;
    }
    const at = Number(entry.at);
    seen.add(n);
    list.push({ n, at: at > 0 ? at : fallbackAt });
  }
  return { list, ignored };
}

/** The section opened most recently, or `fallback` when nothing was opened. */
function newestOpened(opened, fallback) {
  let best = 0;
  let bestAt = 0;
  for (const [key, at] of Object.entries(opened)) {
    if (at > bestAt) {
      bestAt = at;
      best = Number(key);
    }
  }
  return best || fallback;
}

/**
 * The whole device-local state as a plain, JSON-serialisable object — what the
 * caller writes to the file a student carries to another device or browser.
 *
 * Shape:
 *   { app: 'qimma', schema: 2, savedAt: ISO string,
 *     done: number[], fav: number[],
 *     history: [{ n, at }] newest first, last: number }
 *
 * Section numbers are sorted so two exports of the same progress compare equal
 * as text. Nothing here identifies the student: it is section numbers and times.
 *
 * @returns {{ app: string, schema: number, savedAt: string, done: number[],
 *             fav: number[], history: Array<{ n: number, at: number }>, last: number }}
 */
export function exportProgress() {
  const state = read();
  const numbers = (map) => Object.keys(map).map(Number).sort((a, b) => a - b);

  return {
    app: 'qimma',
    schema: SCHEMA,
    savedAt: new Date().toISOString(),
    done: numbers(state.done),
    fav: numbers(state.fav),
    history: Object.entries(state.opened)
      .map(([n, at]) => ({ n: Number(n), at }))
      .sort((a, b) => b.at - a.at || b.n - a.n),
    last: state.last,
  };
}

/**
 * Take a file produced by `exportProgress()` back in. Defensive by contract:
 * the argument is a file a student picked, so this never throws and never
 * trusts a field — it reports what it could use instead.
 *
 * @param {object|string} data   the parsed object, or the raw JSON text
 * @param {{ merge?: boolean }} [options]
 *        merge (default true) adds to what this device already has: a done
 *        mark or a favourite is never removed, and the newer of the two opened
 *        times wins. merge:false replaces the state outright — the caller must
 *        confirm that with the student first, and can undo it with a
 *        `snapshot()` taken beforehand.
 * @returns {{ ok: boolean, mode: 'merge'|'replace'|null,
 *             applied: { done: number, fav: number, history: number },
 *             ignored: { done: number, fav: number, history: number },
 *             error: null|'unreadable'|'not-an-object'|'unsupported-schema'|'empty' }}
 *
 *   applied  entries from the file that changed this device's state
 *   ignored  entries dropped as malformed, duplicated, or past the size cap
 *   error    a code, never a sentence: the caller owns the Arabic wording.
 *              unreadable          the text is not JSON
 *              not-an-object       JSON, but not an object
 *              unsupported-schema  written by a newer version of the site
 *              empty               readable, but holds no usable progress
 *
 * On success the state is saved at once and subscribers are notified, so a
 * caller that re-renders from `subscribe()` needs no extra repaint.
 */
export function importProgress(data, options = {}) {
  const merge = options.merge !== false; // adding is the safe default
  const result = {
    ok: false,
    mode: null,
    applied: { done: 0, fav: 0, history: 0 },
    ignored: { done: 0, fav: 0, history: 0 },
    error: null,
  };

  let parsed = data;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      result.error = 'unreadable';
      return result;
    }
  }
  if (!isRecord(parsed)) {
    result.error = 'not-an-object';
    return result;
  }

  // A file from a future version may mean something else by the same fields,
  // so refuse it rather than half-read it. An older or absent one is fine.
  const schema = Number(parsed.schema ?? parsed.v ?? SCHEMA);
  if (!Number.isInteger(schema) || schema < 1 || schema > SCHEMA) {
    result.error = 'unsupported-schema';
    return result;
  }

  const savedAt = Date.parse(parsed.savedAt);
  const fallbackAt = Number.isFinite(savedAt) ? savedAt : Date.now();

  const done = readNumbers(parsed.done);
  const fav = readNumbers(parsed.fav);
  const history = readHistory(parsed.history ?? parsed.opened, fallbackAt);
  result.ignored = { done: done.ignored, fav: fav.ignored, history: history.ignored };

  // A file exported before the renumbering names its sections by their old
  // numbers too, whichever device it came from.
  if (schema < SCHEMA) {
    done.list = done.list.map(renumberFromV1);
    fav.list = fav.list.map(renumberFromV1);
    for (const entry of history.list) entry.n = renumberFromV1(entry.n);
  }

  if (!done.list.length && !fav.list.length && !history.list.length) {
    result.error = 'empty';
    return result;
  }

  // Re-sanitised deep copy: a half-applied import must never reach the live
  // state, and merging must not alias the maps it is reading.
  const target = merge ? parse(JSON.stringify(read())) : fresh();

  // The local resume point is compared against the imported one, so read its
  // time before the merge below can overwrite it.
  const localLast = target.last;
  const localAt = localLast ? target.opened[localLast] || 0 : 0;

  for (const n of done.list) {
    if (target.done[n]) continue;
    target.done[n] = 1;
    result.applied.done += 1;
  }
  for (const n of fav.list) {
    if (target.fav[n]) continue;
    target.fav[n] = 1;
    result.applied.fav += 1;
  }
  for (const entry of history.list) {
    if ((target.opened[entry.n] || 0) >= entry.at) continue; // the newer visit wins
    target.opened[entry.n] = entry.at;
    result.applied.history += 1;
  }

  const storedLast = isExamNumber(Number(parsed.last)) ? Number(parsed.last) : 0;
  const importedLast = storedLast && schema < SCHEMA ? renumberFromV1(storedLast) : storedLast;
  const importedAt = importedLast
    ? history.list.find((entry) => entry.n === importedLast)?.at ?? fallbackAt
    : 0;

  if (!merge) {
    target.last = importedLast && target.opened[importedLast]
      ? importedLast
      : newestOpened(target.opened, importedLast);
  } else if (importedLast && importedAt > localAt) {
    // The other device was used more recently, so "continue where you were"
    // should point there.
    target.last = importedLast;
  } else if (!target.last) {
    target.last = newestOpened(target.opened, 0);
  }

  cache = target;
  result.ok = true;
  result.mode = merge ? 'merge' : 'replace';
  flush(); // an import is rare and deliberate: never leave it in the debounce
  notify();
  return result;
}

export const store = {
  /** False once storage has refused a read or a write; the state then lives in memory only. */
  get isAvailable() {
    read();
    return available;
  },

  /** Has the student marked section `n` as done on this device? */
  isDone(n) {
    return Boolean(read().done[n]);
  },

  /** Is section `n` in this device's favourites? */
  isFav(n) {
    return Boolean(read().fav[n]);
  },

  /**
   * Mark section `n` done, or take the mark off.
   * @returns {boolean} the new state
   */
  setDone(n, on) {
    const s = read();
    if (on) s.done[n] = 1;
    else delete s.done[n];
    write();
    return Boolean(on);
  },

  /**
   * Flip the done mark on section `n`.
   * @returns {boolean} the new state
   */
  toggleDone(n) {
    return this.setDone(n, !this.isDone(n));
  },

  /**
   * Add section `n` to the favourites, or take it out.
   * @returns {boolean} the new state
   */
  toggleFav(n) {
    const s = read();
    const next = !s.fav[n];
    if (next) s.fav[n] = 1;
    else delete s.fav[n];
    write();
    return next;
  },

  /** Record that a form was opened (the resume point and the "opened…" hint). */
  markOpened(n, now = Date.now()) {
    const s = read();
    s.opened[n] = now;
    s.last = n;
    write();
  },

  /** The section to resume from, or 0 when nothing has been opened yet. */
  get lastOpened() {
    return read().last;
  },

  /** When section `n` was last opened, in epoch milliseconds, or 0. */
  openedAt(n) {
    return read().opened[n] || 0;
  },

  /** An independent deep copy, for undo. */
  snapshot() {
    return JSON.parse(JSON.stringify(read()));
  },

  /** Put a `snapshot()` back, re-sanitising it on the way in. */
  restore(snapshot) {
    cache = parse(JSON.stringify(snapshot));
    write();
  },

  /**
   * Forget completion history — done marks, opened times and the resume point —
   * but keep favourites, which the student chose on purpose.
   */
  resetProgress() {
    const fav = { ...read().fav };
    cache = { ...fresh(), fav };
    write();
  },

  /** Wipe everything, favourites included. */
  clear() {
    clearTimeout(flushHandle);
    flushHandle = 0;
    cache = fresh();
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* the in-memory state is already clean */
    }
  },

  /** Save any unsaved change, then drop the in-memory copy so the next read comes from storage. */
  reload() {
    if (flushHandle) flush();
    cache = null;
  },

  /** Called after another tab — or an import — replaces the stored progress. */
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Write immediately (used by tests and before navigation). */
  flush,

  /** See the named export above. */
  exportProgress,

  /** See the named export above. */
  importProgress,
};
