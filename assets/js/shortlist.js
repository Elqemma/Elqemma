/**
 * shortlist.js — «زبدة الأقسام», hidden unless the teacher shows it.
 *
 * Two published files decide it, and nothing else the site ships mentions it:
 *
 *   assets/data/features.json   the switch, { "shortlist": true | false }.
 *                               lock-admin.html flips it; it ships false.
 *   assets/data/shortlist.json  the list and every word about it, written by
 *                               tools/build-data.mjs. Fetched only when the
 *                               switch is on.
 *
 * exams.json, the pages and llms.txt carry no trace of it, so a page with the
 * switch off is a page that never had the feature. And it fails closed: a
 * missing, unreadable or malformed file of either kind means off.
 */

const FEATURES_URL = new URL('../data/features.json', import.meta.url);
const SHORTLIST_URL = new URL('../data/shortlist.json', import.meta.url);

async function getJson(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * One entry of the list, in the list's own order, so `r` is its number there:
 *   { r, n, t? }  a section on the site; `t` only where the list names it differently
 *   { r, t, q? }  a section with no form yet, which keeps its place in the order
 * Anything else is dropped, and the entries after it keep their own numbers.
 */
function readEntry(row, index) {
  const r = index + 1;
  if (Number.isInteger(row)) return { r, n: row };
  if (!row || typeof row !== 'object') return null;
  const t = text(row.t);
  if (Number.isInteger(row.n)) return t ? { r, n: row.n, t } : { r, n: row.n };
  if (!t) return null;
  return Number.isInteger(row.q) && row.q > 0 ? { r, t, q: row.q } : { r, t };
}

/**
 * The published shortlist when the switch is on, otherwise null. Never throws:
 * a feature that cannot be read is a feature that is off.
 */
export async function loadShortlist() {
  try {
    const features = await getJson(FEATURES_URL);
    if (features?.shortlist !== true) return null;

    const list = await getJson(SHORTLIST_URL);
    const entries = Array.isArray(list?.sections) ? list.sections.map(readEntry).filter(Boolean) : [];
    const label = text(list?.label);
    if (!entries.some((e) => e.n !== undefined) || !label) return null;

    return {
      label,
      short: text(list.short) || label,
      blurb: text(list.blurb),
      updated: text(list.updated) || null,
      entries,
      about: list.about && typeof list.about === 'object' ? list.about : null,
    };
  } catch {
    return null;
  }
}

/** Digits keep lining figures inside Arabic text, as everywhere else on the site. */
function withFigures(node, value) {
  for (const part of String(value).split(/(\d[\d,٬.]*)/)) {
    if (!part) continue;
    if (/^\d/.test(part)) {
      node.append(Object.assign(document.createElement('span'), { className: 'tnum', textContent: part }));
    } else {
      node.append(part);
    }
  }
  return node;
}

/**
 * The about page's explanation of the badge, built from the published copy in
 * place of `marker` — an empty <template> the page ships and nothing else. The
 * nodes replace it rather than filling it, so they sit directly in the prose
 * column and take its rhythm like the sections around them.
 */
export function renderAbout(marker, shortlist) {
  const about = shortlist?.about;
  const heading = text(about?.heading);
  const paragraphs = Array.isArray(about?.paragraphs) ? about.paragraphs.map(text).filter(Boolean) : [];
  if (!marker || !heading || !paragraphs.length) return;

  const h2 = Object.assign(document.createElement('h2'), { id: 'key', textContent: heading });
  const body = paragraphs.map((p) => withFigures(document.createElement('p'), p));
  const note = text(about.note);
  if (note) body.push(Object.assign(document.createElement('p'), { className: 'note', textContent: note }));

  marker.replaceWith(h2, ...body);
}
