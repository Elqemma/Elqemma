/**
 * shortlist.js — «الأكثر تكرارًا», hidden unless the teacher shows it.
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
 * The published shortlist when the switch is on, otherwise null. Never throws:
 * a feature that cannot be read is a feature that is off.
 */
export async function loadShortlist() {
  try {
    const features = await getJson(FEATURES_URL);
    if (features?.shortlist !== true) return null;

    const list = await getJson(SHORTLIST_URL);
    const sections = Array.isArray(list?.sections) ? list.sections.filter(Number.isInteger) : [];
    const label = text(list?.label);
    if (!sections.length || !label) return null;

    return {
      label,
      blurb: text(list.blurb),
      updated: text(list.updated) || null,
      sections,
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
