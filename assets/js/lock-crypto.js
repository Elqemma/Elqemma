/**
 * lock-crypto.js — the lock itself.
 *
 * This site has no server. Every byte it ships can be read by anyone who opens
 * the network tab, so a password that only hides a button hides nothing: the
 * links would still be sitting in the dataset. The form links are therefore not
 * *hidden* but *encrypted*, and the password is the key. Get it wrong and there
 * is nothing to reveal — AES-GCM refuses to decrypt, and no link ever existed
 * in the page to begin with.
 *
 * One file, three callers, on purpose:
 *
 *   assets/js/lock.js        the site — unlocks and hands links to the cards
 *   assets/js/lock-admin.js  the teacher's console — rotates the password
 *   tools/build-lock.mjs     the build — writes the file in the first place
 *
 * A lock whose writer and reader are two implementations is a lock that will
 * one day disagree with itself. There is only one here, and it runs unchanged
 * in Node and in the browser: WebCrypto, TextEncoder and base64 are standard in
 * both, and nothing below touches the DOM.
 *
 * The file it reads and writes (assets/data/unlock.json):
 *
 *   {
 *     app, kind, schema, v, updated, count,
 *     kdf:     { name, hash, iterations },
 *     links:   { salt, iv, ct },   // the 301 form links, under the STUDENT password
 *     keyring: { salt, iv, ct }    // the student password, under the ADMIN password
 *   }
 *
 * `keyring` is what lets the teacher change the password without knowing the
 * current one, and lets him read the current one back when a student asks. It
 * holds a short string, not the links, so students never download it twice.
 */

const subtle = globalThis.crypto?.subtle;
if (!subtle) {
  throw new Error('WebCrypto is unavailable — the lock cannot run here.');
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * OWASP's floor for PBKDF2-SHA-256.
 *
 * A fraction of a second per attempt for one student, and the same fraction per
 * guess for anyone working through a list — which is the whole trade. Raising
 * it buys a linear factor; a longer password buys an exponential one, so this
 * stays at the recommended floor and lock-admin.html argues for length instead.
 */
export const DEFAULT_ITERATIONS = 600000;

export const LOCK_SCHEMA = 1;

/** Google Forms URLs are all the same shape; only the middle differs. */
const FORM_PREFIX = 'https://docs.google.com/forms/d/e/';
const FORM_SUFFIX = '/viewform';
const SHORT_PREFIX = 'https://forms.gle/';

/* -------------------------------------------------------------------------- */
/* Bytes                                                                       */
/* -------------------------------------------------------------------------- */

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(String(value));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBytes(length) {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

/* -------------------------------------------------------------------------- */
/* The password                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A password travels here by WhatsApp, so it arrives dressed in whatever the
 * sender's keyboard and the app added to it. Three of those are silent enough
 * to cost a support message every time, and all three are removed on both
 * sides — the writer and the reader normalise identically, so a password typed
 * on an Arabic keyboard opens a file written from a Latin one:
 *
 *   - Arabic-Indic digits: ٧٠٠٨٣٦٤ and ۷۰۰۸۳۶۴ both mean 7008364.
 *   - bidi and zero-width marks, which RTL apps sprinkle into copied text and
 *     no font ever draws.
 *   - leading and trailing spaces, which a long-press "paste" loves to add.
 *
 * Case is left alone. Lowercasing would throw away half the strength of any
 * Latin password to save a keystroke.
 */
export function normalizePassword(raw) {
  return String(raw ?? '')
    .normalize('NFKC')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u200b-\u200f\u061c\u2066-\u2069\ufeff]/g, '')
    .trim();
}

async function deriveKey(password, salt, iterations, usages) {
  const material = await subtle.importKey(
    'raw',
    encoder.encode(normalizePassword(password)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}

/* -------------------------------------------------------------------------- */
/* Sealing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Encrypt any JSON-serialisable value under `password`.
 *
 * Fresh salt and IV every time. Re-sealing the same links under the same
 * password therefore produces a completely different blob, which is what stops
 * an observer from reading "the teacher did not really change anything today"
 * off two published versions.
 */
export async function seal(password, value, iterations = DEFAULT_ITERATIONS) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt, iterations, ['encrypt']);
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(value)),
  );
  return { salt: toBase64(salt), iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

/**
 * The inverse. Throws `WrongPassword` when the password does not fit.
 *
 * There is no separate hash of the password anywhere in the file, and that is
 * deliberate: AES-GCM's authentication tag already tells us whether the key was
 * right. A stored hash would only add a second, cheaper thing to attack.
 */
export async function open(password, blob, iterations = DEFAULT_ITERATIONS) {
  if (!blob || !blob.salt || !blob.iv || !blob.ct) {
    throw new Error('The lock file is missing a sealed section.');
  }
  const key = await deriveKey(password, fromBase64(blob.salt), iterations, ['decrypt']);
  let plain;
  try {
    plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(blob.iv) }, key, fromBase64(blob.ct));
  } catch {
    const error = new Error('WrongPassword');
    error.name = 'WrongPassword';
    throw error;
  }
  return JSON.parse(decoder.decode(plain));
}

/* -------------------------------------------------------------------------- */
/* The links                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * 301 links share one 34-character prefix and one 9-character suffix. Storing
 * those 301 times would add 13 KB to something every student downloads, so
 * only the part that differs is sealed. Anything that is not a plain Google
 * Forms URL is kept whole and recognised on the way back by its scheme.
 */
function pack(url, prefix, suffix = '') {
  if (typeof url !== 'string' || !url) return null;
  if (url.startsWith(prefix) && url.endsWith(suffix)) {
    return url.slice(prefix.length, url.length - suffix.length);
  }
  return url;
}

function unpack(value, prefix, suffix = '') {
  if (typeof value !== 'string' || !value) return null;
  return value.includes('://') ? value : `${prefix}${value}${suffix}`;
}

/** `[{ n, u, s }]` -> the compact map that gets sealed. */
export function packLinks(rows) {
  const out = {};
  for (const row of rows) {
    const n = Number(row?.n);
    const u = pack(row?.u, FORM_PREFIX, FORM_SUFFIX);
    if (!Number.isInteger(n) || n < 1 || !u) continue;
    const s = pack(row?.s, SHORT_PREFIX);
    out[n] = s && s !== u ? [u, s] : [u];
  }
  return out;
}

/** The compact map -> `Map<number, { u, s }>`, which is what the cards want. */
export function unpackLinks(packed) {
  const out = new Map();
  for (const [key, value] of Object.entries(packed || {})) {
    const n = Number(key);
    const pair = Array.isArray(value) ? value : [value];
    const u = unpack(pair[0], FORM_PREFIX, FORM_SUFFIX);
    if (!Number.isInteger(n) || n < 1 || !u) continue;
    const s = unpack(pair[1], SHORT_PREFIX) || u;
    out.set(n, { u, s });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The file                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A version that changes on every publish, even two in the same second.
 *
 * The site compares it against the one it unlocked with, and that comparison is
 * the whole of "check on every visit whether the password still matches": a new
 * version means everybody re-enters, and no student has to clear anything.
 */
function newVersion() {
  return toBase64(randomBytes(9)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
}

/** Write a complete lock file. `links` is `[{ n, u, s }]`. */
export async function buildLockFile({
  links,
  studentPassword,
  adminPassword,
  iterations = DEFAULT_ITERATIONS,
  updated = new Date().toISOString(),
}) {
  const student = normalizePassword(studentPassword);
  const admin = normalizePassword(adminPassword);
  if (!student) throw new Error('A student password is required.');
  if (!admin) throw new Error('An admin password is required.');
  if (student === admin) {
    throw new Error('The admin password must differ from the one students are given.');
  }

  const packed = packLinks(links);
  const count = Object.keys(packed).length;
  if (!count) throw new Error('There are no links to lock.');

  return {
    app: 'qimma',
    kind: 'lock',
    schema: LOCK_SCHEMA,
    v: newVersion(),
    updated,
    count,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations },
    links: await seal(student, packed, iterations),
    keyring: await seal(admin, { student, updated }, iterations),
  };
}

/** Structural check. Says nothing about whether any password fits. */
export function validateLockFile(file) {
  const problems = [];
  if (!file || typeof file !== 'object') return ['the file is not an object'];
  if (file.app !== 'qimma' || file.kind !== 'lock') problems.push('this is not a qimma lock file');
  if (file.schema !== LOCK_SCHEMA) problems.push(`unknown schema: ${file.schema}`);
  if (typeof file.v !== 'string' || !file.v) problems.push('no version');
  if (!Number.isInteger(file.count) || file.count < 1) problems.push('no section count');
  const iterations = file?.kdf?.iterations;
  if (!Number.isInteger(iterations) || iterations < 100000) {
    problems.push(`iterations too low or missing: ${iterations}`);
  }
  if (file?.kdf?.hash !== 'SHA-256') problems.push('unexpected KDF hash');
  for (const part of ['links', 'keyring']) {
    const blob = file[part];
    if (!blob || !blob.salt || !blob.iv || !blob.ct) problems.push(`the "${part}" section is incomplete`);
  }
  return problems;
}

/** Open the links with a student password. */
export async function openLinks(file, password) {
  return unpackLinks(await open(password, file.links, file.kdf.iterations));
}

/** Open the keyring with the admin password; yields the student password. */
export async function openKeyring(file, password) {
  const ring = await open(password, file.keyring, file.kdf.iterations);
  if (!ring || typeof ring.student !== 'string' || !ring.student) {
    throw new Error('The keyring opened but holds no student password.');
  }
  return ring;
}
