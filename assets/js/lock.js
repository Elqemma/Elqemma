/**
 * lock.js — the gate, as the site sees it.
 *
 * Crypto lives in lock-crypto.js. This file is the part with a memory: it
 * fetches the sealed file, decides whether this visitor is in or out, keeps
 * them in across visits, and tells whoever is listening when that changes. It
 * touches no DOM; app.js owns every pixel.
 *
 * Three rules shape it, and all three come from the same fact — the teacher
 * publishes by committing one file, and everything else is a browser he does
 * not control.
 *
 * 1. THE FILE IS THE AUTHORITY, AND IT IS NEVER CACHED.
 *    Every page load fetches assets/data/unlock.json with `cache: 'no-store'`
 *    and a one-shot query string. Two independent defences, because one of them
 *    failing is silent: no-store settles the browser's own cache, the query
 *    string settles every proxy between here and GitHub. This site registers no
 *    service worker, so there is no third cache to argue with.
 *
 * 2. THE VERSION IS THE CHECK.
 *    The sealed file carries a `v` that changes on every publish. A visitor is
 *    let back in only if the version they unlocked is the version now being
 *    served. So "does the password still match?" is answered on every single
 *    visit, and the answer costs one string comparison, not a key derivation.
 *
 * 3. A NEW PASSWORD LOCKS EVERYONE OUT BY ITSELF.
 *    Publishing a new file changes `v` and re-seals the links. Saved passwords
 *    stop opening it, saved links stop matching it. Nobody has to clear
 *    anything, and there is no window in which yesterday's password still
 *    works — the links it opens no longer exist.
 *
 * What is kept, and where:
 *
 *   localStorage    the password the visitor typed, so a student types it once
 *                   and not every morning. It is their own password on their
 *                   own device; it protects nothing to withhold it from them.
 *   sessionStorage  the opened links, against this version. Purely a speed
 *                   cache: deriving the key is deliberately slow, and without
 *                   this every move between pages would pay for it again.
 *
 * Both are wrapped, because both throw in a locked-down browser, and neither is
 * ever required: with storage unavailable the gate simply asks each time.
 */

import { openLinks, validateLockFile } from './lock-crypto.js';

const LOCK_URL = new URL('../data/unlock.json', import.meta.url);

const PW_KEY = 'qimma.lock.pw';
const CACHE_KEY = 'qimma.lock.open';

/** Why the gate is shut. The UI says something different for each. */
export const REASON = {
  /** No password has ever been entered on this device. */
  NEW: 'new',
  /** One had been, but the teacher has published a new one since. */
  CHANGED: 'changed',
  /** The one just typed is wrong. */
  WRONG: 'wrong',
  /** The sealed file could not be fetched or is unusable. */
  ERROR: 'error',
};

/* -------------------------------------------------------------------------- */
/* Storage that cannot throw                                                   */
/* -------------------------------------------------------------------------- */

function safeStore(kind) {
  let store = null;
  try {
    store = window[kind];
    const probe = `__qimma_${kind}__`;
    store.setItem(probe, '1');
    store.removeItem(probe);
  } catch {
    store = null;
  }
  return {
    get(key) {
      try {
        return store?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        store?.setItem(key, value);
      } catch {
        /* full, private, or blocked — the gate works without it */
      }
    },
    remove(key) {
      try {
        store?.removeItem(key);
      } catch {
        /* ditto */
      }
    },
  };
}

const persistent = safeStore('localStorage');
const session = safeStore('sessionStorage');

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

const listeners = new Set();

const state = {
  status: 'loading', // 'loading' | 'locked' | 'unlocked' | 'error'
  reason: REASON.NEW,
  version: null,
  updated: null,
  count: 0,
  links: null, // Map<number, { u, s }>
  file: null,
};

function emit() {
  for (const fn of listeners) {
    try {
      fn(lock);
    } catch (error) {
      console.error('[lock] a listener threw:', error);
    }
  }
}

function cacheOpened(version, links) {
  session.set(CACHE_KEY, JSON.stringify({ v: version, links: Object.fromEntries(links) }));
}

function readCache(version) {
  const raw = session.get(CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== version || !parsed.links) return null;
    const links = new Map();
    for (const [key, value] of Object.entries(parsed.links)) {
      const n = Number(key);
      if (Number.isInteger(n) && value?.u) links.set(n, value);
    }
    return links.size ? links : null;
  } catch {
    return null;
  }
}

function forget() {
  persistent.remove(PW_KEY);
  session.remove(CACHE_KEY);
}

function settle(links) {
  state.links = links;
  state.status = 'unlocked';
  state.reason = REASON.NEW;
  cacheOpened(state.version, links);
}

/* -------------------------------------------------------------------------- */
/* Boot                                                                        */
/* -------------------------------------------------------------------------- */

async function fetchLockFile() {
  // Two cache defeats, on purpose — see rule 1 at the top of this file.
  const url = new URL(LOCK_URL);
  url.searchParams.set('t', String(Date.now()));

  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const file = await response.json();
  const problems = validateLockFile(file);
  if (problems.length) throw new Error(problems.join('; '));
  return file;
}

async function init() {
  try {
    const file = await fetchLockFile();
    state.file = file;
    state.version = file.v;
    state.updated = file.updated ?? null;
    state.count = file.count ?? 0;

    // Fast path: this tab already opened this exact version.
    const cached = readCache(file.v);
    if (cached) {
      settle(cached);
      emit();
      return;
    }

    const saved = persistent.get(PW_KEY);
    if (!saved) {
      state.status = 'locked';
      state.reason = REASON.NEW;
      emit();
      return;
    }

    try {
      settle(await openLinks(file, saved));
    } catch {
      // The saved password no longer opens the file, which means one thing:
      // the teacher has published a new one. Drop it rather than making the
      // student watch it fail again on the next page.
      forget();
      state.status = 'locked';
      state.reason = REASON.CHANGED;
    }
    emit();
  } catch (error) {
    console.error('[lock] could not read the lock file:', error);
    state.status = 'error';
    state.reason = REASON.ERROR;
    emit();
  }
}

/* -------------------------------------------------------------------------- */
/* The public face                                                             */
/* -------------------------------------------------------------------------- */

export const lock = {
  get status() {
    return state.status;
  },
  get reason() {
    return state.reason;
  },
  get isUnlocked() {
    return state.status === 'unlocked';
  },
  get isReady() {
    return state.status !== 'loading';
  },
  get version() {
    return state.version;
  },
  get updated() {
    return state.updated;
  },
  get count() {
    return state.count;
  },

  /** Resolves once the first verdict is in. */
  ready: null,

  /**
   * The links for one section, or null while locked.
   *
   * Everything outbound on this site goes through here. While the gate is shut
   * this returns null and there is no URL anywhere in the page to fall back on
   * — the cards are not hiding a link, they genuinely do not have one.
   */
  linkFor(n) {
    return state.links?.get(Number(n)) ?? null;
  },

  /**
   * Try a password.
   *
   * Deliberately not instant. 600,000 rounds of PBKDF2 cost a student a
   * fraction of a second, once — and cost anyone working through a list of
   * candidates that same fraction per candidate, with no way to skip it.
   */
  async unlock(password) {
    if (!state.file) return { ok: false, reason: REASON.ERROR };
    const typed = String(password ?? '');
    if (!typed.trim()) return { ok: false, reason: REASON.WRONG };

    try {
      const links = await openLinks(state.file, typed);
      persistent.set(PW_KEY, typed);
      settle(links);
      emit();
      return { ok: true, reason: null };
    } catch (error) {
      if (error?.name !== 'WrongPassword') {
        console.error('[lock] unlocking failed:', error);
        return { ok: false, reason: REASON.ERROR };
      }
      state.reason = REASON.WRONG;
      return { ok: false, reason: REASON.WRONG };
    }
  },

  /** Shut the gate again and forget the password — for a shared device. */
  relock() {
    forget();
    state.links = null;
    state.status = 'locked';
    state.reason = REASON.NEW;
    emit();
  },

  /** Called after a failed load, from the error panel's retry button. */
  async retry() {
    state.status = 'loading';
    emit();
    await init();
  },

  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

lock.ready = init();
