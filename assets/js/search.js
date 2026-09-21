/**
 * Arabic-first, forgiving, client-side search over the exam records.
 *
 * Public API
 * ----------
 *   normalizeArabic(input) -> string
 *       Fold Arabic text to its searchable form. Identical in behaviour to
 *       `normalizeArabic` in tools/build-data.mjs, which built the `k` keys.
 *   normalize(input) -> string                 alias of normalizeArabic
 *   stemKey(normalized) -> string              mirrors build-data.mjs stemKey
 *   normalizeWithMap(input) -> { norm, map }   map[i] = index in the ORIGINAL
 *
 *   parseQuery(raw) -> { raw, norm, tokens, digits, isEmpty }
 *       Parse the input box once per keystroke; reuse the result for every row.
 *       `digits` is the folded query when it is nothing but digits, else null.
 *
 *   searchExams(exams, query) -> { results, fuzzy, via }
 *       `results`  the matching exam records, best first (ties by section no.).
 *       `fuzzy`    true when only the typo-tolerant pass found anything, so the
 *                  caller can warn that the results are approximate.
 *       `via`      Map<exam.n, 'n' | 'o'>, filled only for number queries:
 *                  'n' = the number is the section's number today,
 *                  'o' = it is the number this section used to carry, so the
 *                  caller can label that row as an old-numbering hit.
 *
 *   highlightRanges(title, query) -> [[start, end), ...]
 *       Sorted, merged ranges over the ORIGINAL Arabic title.
 *
 * Design notes
 * ------------
 * - Normalisation mirrors `tools/build-data.mjs` so the pre-built `k` and `g`
 *   keys on each record can be matched directly — no per-keystroke
 *   normalisation of the corpus.
 * - Students should never need the exact title: alef/hamza/ta-marbuta/
 *   alef-maqsura are folded, diacritics and tatweel are stripped, the definite
 *   article and a leading waw are indexed as extra stems, and a one-character
 *   typo is tolerated when the strict pass finds nothing.
 * - Arabic-Indic digits are folded to Latin so both scripts of a number work.
 * - Every Arabic literal below is written as a \u escape on purpose: bracketed
 *   ranges of RTL characters reorder visually in editors, and one silent swap
 *   here would desync the client from the keys baked into exams.json.
 */

/* Arabic diacritics (harakat, superscript alef, Quranic marks) + tatweel. */
const DIACRITIC_CHARS = '\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640';
const DIACRITICS = new RegExp(`[${DIACRITIC_CHARS}]`, 'g');
/* Non-global twin: safe for .test() (a /g regex keeps lastIndex state). */
const IS_DIACRITIC = new RegExp(`[${DIACRITIC_CHARS}]`);

const ALEF = '\u0627';
const LAM = '\u0644';
const WAW = '\u0648';
const YAA = '\u064a';
const HAA = '\u0647';
const ALEF_VARIANTS = '\u0622\u0623\u0625\u0671';
const AL = ALEF + LAM; // the definite article

/** Fold a string to its searchable form. Length-changing steps are isolated. */
export function normalizeArabic(input) {
  return String(input ?? '')
    .replace(DIACRITICS, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, ALEF)
    .replace(/\u0629/g, HAA)
    .replace(/\u0649/g, YAA)
    .replace(/\u0624/g, WAW)
    .replace(/\u0626/g, YAA)
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Shorter name for the call sites that only ever fold a string. */
export const normalize = normalizeArabic;

/** Strip the definite article / leading conjunction from one folded word. */
function stemWord(word) {
  let s = word;
  if (s.length > 3 && s.startsWith(WAW)) s = s.slice(1);
  if (s.length > 4 && s.startsWith(AL)) s = s.slice(2);
  return s;
}

/** Extra recall key: drop the definite article and a leading conjunction. */
export function stemKey(normalized) {
  return String(normalized ?? '')
    .split(' ')
    .map(stemWord)
    .filter(Boolean)
    .join(' ');
}

/**
 * Normalise while keeping a map back to the original string's indices, so
 * matches can be highlighted on the untouched Arabic title.
 * Only called for the handful of cards actually on screen.
 */
export function normalizeWithMap(input) {
  const src = String(input ?? '');
  let out = '';
  const map = [];
  let pendingSpace = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (IS_DIACRITIC.test(ch)) continue;

    let mapped = ch;
    if (ALEF_VARIANTS.includes(ch)) mapped = ALEF;
    else if (ch === '\u0629') mapped = HAA;
    else if (ch === '\u0649') mapped = YAA;
    else if (ch === '\u0624') mapped = WAW;
    else if (ch === '\u0626') mapped = YAA;
    else if (ch >= '\u0660' && ch <= '\u0669') mapped = String(ch.charCodeAt(0) - 0x0660);
    else if (ch >= '\u06f0' && ch <= '\u06f9') mapped = String(ch.charCodeAt(0) - 0x06f0);
    else if (/\s/.test(ch) || !/[\p{L}\p{N}]/u.test(ch)) mapped = ' ';

    if (mapped === ' ') {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace) {
      out += ' ';
      map.push(i);
      pendingSpace = false;
    }
    out += mapped.toLowerCase();
    map.push(i);
  }

  return { norm: out, map };
}

/** Bounded Levenshtein: returns true when distance <= 1. */
function withinOneEdit(a, b) {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;

  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (la > lb) i += 1;
    else if (lb > la) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

/** Parse the raw input box value into a reusable query object. */
export function parseQuery(raw) {
  const norm = normalizeArabic(raw);
  const tokens = norm.split(' ').filter(Boolean);
  const digits = /^[0-9]+$/.test(norm) ? norm : null;
  return { raw: String(raw ?? ''), norm, tokens, digits, isEmpty: tokens.length === 0 };
}

/* Folded keys. The build writes them; fall back for a hand-made record. */
const keyOf = (exam) => exam.k || exam._k || (exam._k = normalizeArabic(exam.t));
const stemsOf = (exam) => exam.g || exam._g || (exam._g = stemKey(keyOf(exam)));

/**
 * Score one record against a parsed query. Returns { s, via }; s === 0 means
 * no match. `fuzzy` enables the typo-tolerant fallback pass.
 */
function scoreExam(exam, query, fuzzy) {
  if (query.digits) {
    const n = String(exam.n);
    if (n === query.digits) return { s: 1000, via: 'n' };
    // The series was renumbered, so a student reading an older worksheet types
    // the old number. Answer it — but below today's number, because the same
    // digits now mean a different section and that one has to lead.
    // o === 0 is the build's marker for "new section, no old counterpart", so
    // a record flagged that way must never answer the query "0".
    if (exam.o > 0 && String(exam.o) === query.digits) return { s: 700, via: 'o' };
    if (n.startsWith(query.digits)) return { s: 600, via: 'n' };
    if (n.includes(query.digits)) return { s: 300, via: 'n' };
    // Fall through: a number may also appear inside a title.
  }

  const key = keyOf(exam);
  const stems = stemsOf(exam);
  let score = 0;

  for (const token of query.tokens) {
    const t = stemWord(token);
    let hit = 0;

    if (key === token) hit = 500;
    else if (key.startsWith(`${token} `)) hit = 120;
    else if (key.includes(` ${token}`) || key.startsWith(token)) hit = 90;
    else if (stems.startsWith(t)) hit = 75;
    else if (stems.includes(` ${t}`)) hit = 70;
    else if (key.includes(token)) hit = 45;
    else if (t !== token && key.includes(t)) hit = 40;
    else if (stems.includes(t)) hit = 35;
    else if (fuzzy && token.length >= 3) {
      const words = exam._w || (exam._w = key.split(' ').filter(Boolean));
      for (const w of words) {
        if (withinOneEdit(w, token) || withinOneEdit(stemWord(w), t)) {
          hit = 18;
          break;
        }
      }
    }

    if (!hit) return { s: 0, via: null }; // every token must match (AND)
    score += hit;
  }

  // Shorter titles that match are usually the more precise hit.
  return { s: score + Math.max(0, 24 - key.length / 2), via: null };
}

/**
 * Search a list of exams. Runs a strict pass first, then a typo-tolerant pass
 * only if the strict pass found nothing.
 */
export function searchExams(exams, query) {
  if (query.isEmpty) return { results: exams.slice(), fuzzy: false, via: new Map() };

  for (const fuzzy of [false, true]) {
    const scored = [];
    for (const exam of exams) {
      const { s, via } = scoreExam(exam, query, fuzzy);
      if (s > 0) scored.push({ exam, s, via });
    }
    if (scored.length) {
      scored.sort((a, b) => b.s - a.s || a.exam.n - b.exam.n);
      const via = new Map();
      for (const row of scored) if (row.via) via.set(row.exam.n, row.via);
      return { results: scored.map((row) => row.exam), fuzzy, via };
    }
  }

  return { results: [], fuzzy: true, via: new Map() };
}

/**
 * Compute highlight ranges (on the ORIGINAL title) for a parsed query.
 * Returns a sorted, merged array of [start, end) index pairs.
 */
export function highlightRanges(title, query) {
  if (query.isEmpty || query.digits) return [];
  const { norm, map } = normalizeWithMap(title);
  const ranges = [];

  for (const token of query.tokens) {
    for (const needle of new Set([token, stemWord(token)])) {
      if (needle.length < 2) continue;
      let from = 0;
      let at = norm.indexOf(needle, from);
      while (at !== -1) {
        const start = map[at];
        const end = map[at + needle.length - 1] + 1;
        if (start !== undefined && end !== undefined) ranges.push([start, end]);
        from = at + needle.length;
        at = norm.indexOf(needle, from);
      }
    }
  }

  if (!ranges.length) return [];
  ranges.sort((a, b) => a[0] - b[0]);

  const merged = [ranges[0]];
  for (const [s, e] of ranges.slice(1)) {
    const last = merged[merged.length - 1];
    if (s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}
