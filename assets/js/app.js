/**
 * القمة في القسم اللفظي — the portal over the teacher's verbal-section forms
 *
 * Static, data-driven, no framework. State lives in one object, is mirrored to
 * the URL (so any view is shareable and the back button works), and drives a
 * single render pass. Cards are cloned from a <template>, 24 to a page.
 *
 * Opening a form marks it done straight away (with an undo). Progress changes
 * never re-render the list: they repaint only the affected card, the counters
 * and the quick-access tiles, so a student deep in the grid never loses their
 * place.
 *
 * THE LINKS ARE NOT IN THE DATASET. assets/data/exams.json is public, so it
 * carries numbers, titles and question counts and nothing that could open a
 * form. The 301 links live encrypted in assets/data/unlock.json and reach this
 * file only through lock.linkFor(), which returns null until a student's
 * password decrypts them. Every locked state below follows from that one fact:
 * a locked card is not hiding its link, it does not have one. See lock.js.
 *
 * Two things here that the shape of this dataset forced:
 *   - Every section carries its own question count (5–16), so the count is read
 *     off the record rather than from one figure in the metadata.
 *   - The teacher renumbered his sections. A record may carry `o`, the number it
 *     used to have; search.js scores a match on it and the card states it, so a
 *     student's old notebook is still a valid index.
 */

import { parseQuery, searchExams, highlightRanges } from './search.js';
import { store, exportProgress, importProgress } from './store.js';
import { lock, REASON } from './lock.js';

/**
 * Cards on a page. 24 divides by two, three and four, so the last row is full
 * at every column count the grid uses, and 301 sections come out as thirteen
 * pages instead of one scroll nobody reaches the end of.
 */
const PAGE_SIZE = 24;
const DATA_URL = new URL('../data/exams.json', import.meta.url);

/* -------------------------------------------------------------------------- */
/* Element lookup                                                              */
/* -------------------------------------------------------------------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const el = {
  search: $('#searchInput'),
  searchForm: $('#searchForm'),
  clear: $('#searchClear'),
  grid: $('#examGrid'),
  template: $('#examCardTemplate'),
  count: $('#resultCount'),
  countLive: $('#resultCountLive'),
  empty: $('#emptyState'),
  emptyIcon: $('#emptyIcon'),
  emptyTitle: $('#emptyTitle'),
  emptyLead: $('#emptyLead'),
  emptyTerm: $('#emptyTerm'),
  suggestions: $('#emptySuggestions'),
  error: $('#errorState'),
  pager: $('#pager'),
  pagerPrev: $('#pagerPrev'),
  pagerNext: $('#pagerNext'),
  pagerPages: $('#pagerPages'),
  pagerMeta: $('#pagerMeta'),
  rangeChips: $('#rangeChips'),
  controls: $('#filterControls'),
  controlsHome: $('#controlsHome'),
  sheet: $('#filterSheet'),
  sheetBody: $('#filterSheetBody'),
  sheetOpen: $('#filterTrigger'),
  sheetBadge: $('#filterBadge'),
  sheetClose: $('#filterSheetClose'),
  sheetApply: $('#filterSheetApply'),
  sheetReset: $('#filterSheetReset'),
  activeFilters: $('#activeFilters'),
  activeTags: $('#activeTags'),
  resetAll: $('#resetAll'),
  resetProxies: $$('[data-reset-proxy]'),
  sortSelect: $('#sortSelect'),
  statusGroup: $('#statusGroup'),
  errorRetry: $('#errorRetry'),
  gateCard: $('#gateCard'),
  gateIcon: $('#gateIcon'),
  gateEyebrow: $('#gateEyebrow'),
  gateTitle: $('#gate-title'),
  gateText: $('#gateText'),
  gateForm: $('#gateForm'),
  gateInput: $('#gateInput'),
  gatePeek: $('#gatePeek'),
  gateSubmit: $('#gateSubmit'),
  gateSubmitLabel: $('#gateSubmitLabel'),
  gateResult: $('#gateResult'),
  gateAsk: $('#gateAsk'),
  gateOpen: $('#gateOpen'),
  gateRelock: $('#gateRelock'),
  progressExport: $('#progressExport'),
  progressImport: $('#progressImport'),
  progressFile: $('#progressFile'),
  progress: $('#progressPanel'),
  progressBar: $('#progressBar'),
  progressFill: $('#progressFill'),
  progressLabel: $('#progressLabel'),
  progressPct: $('#progressPct'),
  progressReset: $('#progressReset'),
  progressKeyTrack: $('#progressKeyTrack'),
  progressKeyBar: $('#progressKeyBar'),
  progressKeyFill: $('#progressKeyFill'),
  progressKeyName: $('#progressKeyName'),
  progressKeyPct: $('#progressKeyPct'),
  keyBar: $('#keyBar'),
  keyToggle: $('#keyToggle'),
  keyToggleLabel: $('#keyToggleLabel'),
  keyToggleCount: $('#keyToggleCount'),
  keyHint: $('#keyHint'),
  sortKeyOption: $('#sortKeyOption'),
  tileKey: $('#tileKey'),
  tileKeyLabel: $('#tileKeyLabel'),
  tileKeyMeta: $('#tileKeyMeta'),
  tileKeyState: $('#tileKeyState'),
  tileResume: $('#tileResume'),
  tileResumeLabel: $('#tileResumeLabel'),
  tileResumeMeta: $('#tileResumeMeta'),
  tileTodo: $('#tileTodo'),
  tileTodoMeta: $('#tileTodoMeta'),
  tileFav: $('#tileFav'),
  tileFavMeta: $('#tileFavMeta'),
  tileRandom: $('#tileRandom'),
  tileRandomMeta: $('#tileRandomMeta'),
  toast: $('#toast'),
  toastText: $('#toastText'),
  toastActions: $('#toastActions'),
  statTotal: $$('[data-stat="total"]'),
  statQuestions: $$('[data-stat="questions"]'),
  statUpdated: $$('[data-stat="updated"]'),
  statPriority: $$('[data-stat="priority"]'),
  statKeyItem: $('.hero__stats-key'),
};

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

const DEFAULTS = { q: '', range: 'all', status: 'all', sort: 'number-asc', key: 'all' };

const state = {
  ...DEFAULTS,
  data: null,
  /** Every exam, ascending by number. */
  ordered: [],
  /** number -> exam */
  byNumber: new Map(),
  query: parseQuery(''),
  results: [],
  fuzzy: false,
  /** Which page of `results` is on screen, counting from 1. */
  page: 1,
  /** How many pages `results` fills. Never below 1, so "page 1 of 1" holds. */
  pages: 1,
  /** Result count per status tab, under the current range, shortlist and search. */
  counts: { all: 0, todo: 0, done: 0, fav: 0 },
  /**
   * Set when a number query matched a section by the number it USED to carry,
   * so the result line can say so instead of looking like a mismatch:
   * { old, exam }.
   */
  oldHit: null,
  /**
   * The teacher's "most repeated" shortlist, as published in the dataset:
   * { label, blurb, count, updated } — or null when this build carries none,
   * in which case every part of the UI that mentions it stays hidden.
   */
  priority: null,
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const arabicNumber = (n) => new Intl.NumberFormat('ar-EG-u-nu-latn').format(n);

/**
 * A numeric range must stay a single left-to-right run. Left to the bidi
 * algorithm inside an RTL paragraph, "1 - 50" is laid out with 1 on the right,
 * which reads as "50 - 1" to anyone scanning left to right. <bdi dir="ltr">
 * isolates it so the range always renders the way people write it.
 */
function rangeElement(from, to) {
  const bdi = document.createElement('bdi');
  bdi.dir = 'ltr';
  bdi.className = 'tnum';
  bdi.textContent = `${arabicNumber(from)}–${arabicNumber(to)}`;
  return bdi;
}

/** Render an ISO date as Arabic prose, falling back to the raw value. */
function formatDate(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return iso;
  }
}

/**
 * Progress as a percentage that never overstates: floored, with one decimal
 * below 10 so the first finished form reads "0.3٪" rather than "0٪".
 */
function percentText(done, total) {
  if (!total || done <= 0) return '0٪';
  if (done >= total) return '100٪';
  const pct = (done / total) * 100;
  const value = pct < 10 ? Math.floor(pct * 10) / 10 : Math.floor(pct);
  return `${arabicNumber(value)}٪`;
}

const TIME_UNITS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

let relativeFormat = null;
try {
  relativeFormat = new Intl.RelativeTimeFormat('ar-EG-u-nu-latn', { numeric: 'auto' });
} catch {
  /* very old engines: the "opened" hint simply omits the time */
}

/** "الآن", "قبل 5 دقائق", "أمس", "الأسبوع الماضي"… */
function timeAgo(timestamp) {
  const seconds = (timestamp - Date.now()) / 1000;
  if (Math.abs(seconds) < 60 || !relativeFormat) return 'الآن';
  for (const [unit, size] of TIME_UNITS) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return 'الآن';
}

/* -------------------------------------------------------------------------- */
/* Arabic number agreement                                                     */
/*                                                                             */
/* Counted nouns inflect by category in Arabic, so "1 نموذجًا" and "3 نموذجًا"  */
/* are both wrong. Intl.PluralRules('ar') gives the six categories; for one and */
/* two the idiomatic phrasing drops the digit entirely.                         */
/* -------------------------------------------------------------------------- */

const PLURAL = new Intl.PluralRules('ar');

const UNITS = {
  exam: {
    zero: () => 'لا نماذج',
    one: () => 'نموذج واحد',
    two: () => 'نموذجان',
    few: (n) => `${arabicNumber(n)} نماذج`,
    many: (n) => `${arabicNumber(n)} نموذجًا`,
    other: (n) => `${arabicNumber(n)} نموذج`,
  },
  question: {
    zero: () => 'لا أسئلة',
    one: () => 'سؤال واحد',
    two: () => 'سؤالان',
    few: (n) => `${arabicNumber(n)} أسئلة`,
    many: (n) => `${arabicNumber(n)} سؤالًا`,
    other: (n) => `${arabicNumber(n)} سؤال`,
  },
};

/** e.g. countPhrase(1, 'exam') -> "نموذج واحد", countPhrase(13, 'question') -> "13 سؤالًا" */
function countPhrase(n, unit) {
  const table = UNITS[unit];
  return (table[PLURAL.select(n)] || table.other)(n);
}

/** The bare noun in the form that agrees with `n`, without the numeral. */
function unitNoun(n, unit) {
  return countPhrase(n, unit).replace(/^[\d٠-٩,،.\s]+/, '');
}

/**
 * The link for a section, or null.
 *
 * There is no longer a URL on the record to fall back on: assets/data/exams.json
 * is public, so it carries no links at all. They live encrypted in the lock, and
 * this is the one door they come through. While the gate is shut every call here
 * returns null, which is not a refusal to hand the link over — there is nothing
 * in the page to hand over. See assets/js/lock.js.
 */
function examUrl(exam) {
  return lock.linkFor(exam?.n)?.u ?? null;
}

/** The short link a student would paste to a friend; falls back to the long one. */
function examShortUrl(exam) {
  const link = lock.linkFor(exam?.n);
  return link?.s ?? link?.u ?? null;
}

/** Defence in depth: never render a link that is not a plain https URL. */
function isSafeUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function debounce(fn, wait) {
  let handle = 0;
  return (...args) => {
    clearTimeout(handle);
    handle = setTimeout(() => fn(...args), wait);
  };
}

/* -------------------------------------------------------------------------- */
/* The shortlist                                                               */
/*                                                                             */
/* `p` is stamped on a record by tools/build-data.mjs from                      */
/* data/source/priority.json. Nothing here knows which numbers are on the list: */
/* replacing that file and rebuilding is the whole update procedure.            */
/* -------------------------------------------------------------------------- */

const isKey = (exam) => Boolean(exam?.p);

/** The published label, or a safe default if this build carries no shortlist. */
function keyLabel() {
  return state.priority?.label || 'الأكثر تكرارًا';
}

function parseRange(value) {
  const match = /^(\d+)-(\d+)$/.exec(value || '');
  if (!match) return null;
  return { from: Number(match[1]), to: Number(match[2]) };
}

/* -------------------------------------------------------------------------- */
/* Toast — a short status line with at most one action (undo, next form…)     */
/* -------------------------------------------------------------------------- */

let toastHandle = 0;

function hideToast() {
  clearTimeout(toastHandle);
  const hadFocus = el.toast.contains(document.activeElement);
  el.toast.classList.remove('toast--visible');
  el.toastActions.replaceChildren();
  el.toastActions.hidden = true;
  if (hadFocus) document.activeElement.blur();
}

function scheduleToastHide(ms) {
  clearTimeout(toastHandle);
  toastHandle = setTimeout(hideToast, ms);
}

/**
 * @param {string} message
 * @param {{ duration?: number, action?: { label: string, href?: string, onClick?: () => void } }} [options]
 * @returns {HTMLElement | null} the action element, if any
 */
function toast(message, { duration = 2600, action = null } = {}) {
  if (!el.toast) return null;
  el.toastText.textContent = message;
  el.toastActions.replaceChildren();

  let actionNode = null;
  if (action) {
    actionNode = action.href
      ? Object.assign(document.createElement('a'), {
          href: action.href,
          target: '_blank',
          rel: 'noopener noreferrer',
        })
      : Object.assign(document.createElement('button'), { type: 'button' });
    actionNode.className = 'toast__action';
    actionNode.textContent = action.label;
    actionNode.addEventListener('click', () => {
      hideToast();
      action.onClick?.();
    });
    el.toastActions.append(actionNode);
  }

  el.toastActions.hidden = !action;
  el.toast.classList.add('toast--visible');
  // Raised while the page is hidden (the form just opened in front of it):
  // hold it until the student is back, so the confirmation is actually seen.
  if (document.visibilityState === 'hidden') clearTimeout(toastHandle);
  else scheduleToastHide(duration);
  return actionNode;
}

/* -------------------------------------------------------------------------- */
/* URL <-> state                                                               */
/* -------------------------------------------------------------------------- */

function readStateFromUrl() {
  const params = new URLSearchParams(location.search);
  state.q = params.get('q') ?? DEFAULTS.q;
  state.range = params.get('range') ?? DEFAULTS.range;
  state.status = params.get('status') ?? DEFAULTS.status;
  state.sort = params.get('sort') ?? DEFAULTS.sort;

  // `?key=1` is the shareable link to the shortlist; anything else is "all".
  state.key = params.get('key') === '1' ? 'only' : 'all';

  if (!['all', 'todo', 'done', 'fav'].includes(state.status)) state.status = 'all';
  if (!['number-asc', 'number-desc', 'title', 'recent', 'key'].includes(state.sort)) {
    state.sort = 'number-asc';
  }
  // Sorting the shortlist first is meaningless in a build that has none.
  if (state.sort === 'key' && !state.priority) state.sort = DEFAULTS.sort;
  if (state.key === 'only' && !state.priority) state.key = 'all';
  if (state.range !== 'all' && !parseRange(state.range)) state.range = 'all';

  // `?page=3` makes a page shareable and survives a reload. It is clamped in
  // compute(), once the filters above are settled and the list has a length.
  const page = Number(params.get('page'));
  state.page = Number.isInteger(page) && page > 0 ? page : 1;
}

const syncUrl = debounce(() => {
  const params = new URLSearchParams();
  for (const name of ['q', 'range', 'status', 'sort']) {
    if (state[name] && state[name] !== DEFAULTS[name]) params.set(name, state[name]);
  }
  if (state.key === 'only') params.set('key', '1');
  if (state.page > 1) params.set('page', String(state.page));
  const search = params.toString();
  const next = `${location.pathname}${search ? `?${search}` : ''}`;
  history.replaceState(null, '', next);
}, 250);

/* -------------------------------------------------------------------------- */
/* Filtering                                                                   */
/* -------------------------------------------------------------------------- */

const STATUS_FILTERS = {
  all: null,
  todo: (exam) => !store.isDone(exam.n),
  done: (exam) => store.isDone(exam.n),
  fav: (exam) => store.isFav(exam.n),
};

/** Only the controls that actually live inside the mobile sheet. */
function sheetFilterCount() {
  let n = 0;
  if (state.status !== 'all') n += 1;
  if (state.sort !== DEFAULTS.sort) n += 1;
  return n;
}

/**
 * Everything the current range and shortlist switch allow, before status and
 * search narrow it further. Both are independent axes, so the status tab
 * counts are always counts of what selecting that tab would really show.
 */
function activePool() {
  let pool = state.ordered;
  const range = parseRange(state.range);
  if (range) pool = pool.filter((e) => e.n >= range.from && e.n <= range.to);
  if (state.key === 'only') pool = pool.filter(isKey);
  return pool;
}

function searchWithin(pool, status) {
  const test = STATUS_FILTERS[status];
  return searchExams(test ? pool.filter(test) : pool, state.query);
}

/** Recount every status tab exactly as selecting it would filter. */
function countStatuses(pool = activePool()) {
  for (const status of Object.keys(STATUS_FILTERS)) {
    state.counts[status] = searchWithin(pool, status).results.length;
  }
}

function compute() {
  const pool = activePool();
  state.query = parseQuery(state.q);

  const { results, fuzzy, via } = searchWithin(pool, state.status);
  state.fuzzy = fuzzy;

  // «160» is a perfectly good way to ask for a section — it just is not the
  // number that section carries today. Say which one answered, rather than
  // letting the student wonder why they got section 21.
  state.oldHit = null;
  if (via && via.size) {
    const hit = results.find((e) => via.get(e.n) === 'o');
    if (hit && Number.isInteger(hit.o) && hit.o > 0) {
      state.oldHit = { old: hit.o, exam: hit, alsoCurrent: state.byNumber.has(hit.o) };
    }
  }
  countStatuses(pool);

  // A text query is already ranked by relevance; only re-sort when the user
  // explicitly picked an order or the query is empty.
  const explicitSort = state.sort !== DEFAULTS.sort;
  if (state.query.isEmpty || explicitSort) {
    const sorted = results.slice();
    if (state.sort === 'number-desc') sorted.sort((a, b) => b.n - a.n);
    else if (state.sort === 'title') sorted.sort((a, b) => a.t.localeCompare(b.t, 'ar'));
    else if (state.sort === 'recent') {
      sorted.sort((a, b) => store.openedAt(b.n) - store.openedAt(a.n) || a.n - b.n);
    } else if (state.sort === 'questions-asc') {
      // 5 to 16 questions is a wide spread, so "what can I finish now?" is a
      // real question. Ties keep ascending order rather than shuffling.
      sorted.sort((a, b) => (a.q || 0) - (b.q || 0) || a.n - b.n);
    } else if (state.sort === 'key') {
      // Shortlist first, still ascending within each group: a way to see the
      // priority forms at the top without hiding the rest.
      sorted.sort((a, b) => Number(isKey(b)) - Number(isKey(a)) || a.n - b.n);
    } else sorted.sort((a, b) => a.n - b.n);
    state.results = sorted;
  } else {
    state.results = results;
  }

  state.pages = Math.max(1, Math.ceil(state.results.length / PAGE_SIZE));
  // A filter can shorten the list under a reader who is deep inside it; without
  // this they would be looking at a page that no longer exists.
  if (state.page > state.pages) state.page = state.pages;
}

/* -------------------------------------------------------------------------- */
/* Card rendering                                                              */
/* -------------------------------------------------------------------------- */

function paintTitle(node, exam) {
  const ranges = highlightRanges(exam.t, state.query);
  if (!ranges.length) {
    node.textContent = exam.t;
    return;
  }
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) fragment.append(exam.t.slice(cursor, start));
    const mark = document.createElement('mark');
    mark.textContent = exam.t.slice(start, end);
    fragment.append(mark);
    cursor = end;
  }
  if (cursor < exam.t.length) fragment.append(exam.t.slice(cursor));
  node.replaceChildren(fragment);
}

/** Everything on a card that depends on progress. Safe to call any time. */
function paintCardState(node) {
  const n = Number(node.dataset.n);
  const exam = state.byNumber.get(n);
  if (!exam) return;

  const done = store.isDone(n);
  const fav = store.isFav(n);
  const number = arabicNumber(n);

  node.classList.toggle('card--done', done);

  const toggle = $('.card__toggle', node);
  const toggleText = done ? 'إلغاء تحديد الإنجاز' : 'تحديد كمُنجز';
  toggle.setAttribute('aria-pressed', String(done));
  toggle.setAttribute('aria-label', `${toggleText} — القسم ${number}`);
  toggle.title = toggleText;

  const favButton = $('.card__fav', node);
  const favText = fav ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة';
  favButton.setAttribute('aria-pressed', String(fav));
  favButton.setAttribute('aria-label', `${favText} — القسم ${number}`);
  favButton.title = favText;

  // Status line: "done" wins; otherwise say when it was last opened, so a
  // form that was started but never marked is easy to spot.
  const status = $('[data-meta="status"]', node);
  const openedAt = store.openedAt(n);
  if (done || openedAt) {
    status.hidden = false;
    status.classList.toggle('card__status--done', done);
    $('use', status).setAttribute('href', done ? '#i-check' : '#i-clock');
    $('[data-field="status"]', status).textContent = done ? 'مُنجز' : `فتحته ${timeAgo(openedAt)}`;
  } else {
    status.hidden = true;
  }

  const cta = $('a.card__cta', node);
  if (cta) {
    const verb = done ? 'أعد الاختبار' : 'ابدأ الاختبار';
    $('.card__cta-label', cta).textContent = verb;
    cta.setAttribute('aria-label', `${verb} — القسم ${number}: ${exam.t}`);
  }
}

/** The shortlist badge and edge. Fixed per record, so it is painted once. */
function paintCardKey(node, exam) {
  const key = isKey(exam);
  node.classList.toggle('card--key', key);

  const badge = $('[data-meta="key"]', node);
  if (!badge) return;
  if (!key) {
    badge.remove(); // most cards: one fewer node to carry through the grid
    return;
  }
  badge.hidden = false;
  $('[data-field="key"]', badge).textContent = keyLabel();
}

function buildLockedCta(exam) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--tint card__cta card__cta--locked';
  button.setAttribute('aria-label', `مقفول — القسم ${arabicNumber(exam.n)}: ${exam.t}. اكتب كلمة المرور لفتحه`);

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'icon');
  icon.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-lock');
  icon.append(use);

  const label = document.createElement('span');
  label.className = 'card__cta-label';
  label.textContent = 'مقفول';

  button.append(icon, label);
  return button;
}

function buildCard(exam) {
  const node = el.template.content.firstElementChild.cloneNode(true);
  const url = examUrl(exam);

  node.dataset.n = String(exam.n);
  node.id = `exam-${exam.n}`;

  $('.card__number b', node).textContent = arabicNumber(exam.n);
  paintTitle($('.card__title', node), exam);

  // The forms are not a fixed length here: each one says how many questions it
  // holds, which is exactly what a student picking their next 10 minutes wants.
  const questions = Number(exam.q) || 0;
  if (questions > 0) {
    $('[data-field="questions"]', node).textContent = countPhrase(questions, 'question');
  } else {
    $('[data-meta="questions"]', node)?.remove();
  }

  // `o` is the number this section carried before the renumbering: a positive
  // number is the old number, 0 means the teacher's table marks it as new, and
  // an absent `o` means the table does not cover this section at all. Only the
  // first case says anything useful on a card, so the other two drop the pill.
  const oldPill = $('[data-meta="old"]', node);
  if (oldPill) {
    if (Number.isInteger(exam.o) && exam.o > 0) {
      oldPill.hidden = false;
      $('[data-field="old"]', oldPill).textContent = `كان القسم ${arabicNumber(exam.o)}`;
      oldPill.title = 'رقم هذا القسم في الترقيم القديم';
    } else {
      oldPill.remove();
    }
  }

  const cta = $('.card__cta', node);
  if (!lock.isUnlocked) {
    // Locked. Not a disabled link — a button, because while the gate is shut
    // there is no link here to disable, and the only thing this card can still
    // do for the reader is take them to the field that changes that.
    cta.replaceWith(buildLockedCta(exam));
    node.dataset.locked = 'true';
  } else if (url && isSafeUrl(url)) {
    cta.href = url;
  } else {
    // A record with no usable link is never offered as an active exam.
    cta.replaceWith(
      Object.assign(document.createElement('span'), {
        className: 'btn btn--secondary card__cta',
        textContent: 'الرابط غير متاح',
      }),
    );
    node.dataset.broken = 'true';
  }

  const copy = $('.card__copy', node);
  copy.disabled = !lock.isUnlocked;
  copy.setAttribute('aria-label', `نسخ رابط القسم ${arabicNumber(exam.n)}`);
  copy.title = lock.isUnlocked ? 'نسخ رابط القسم' : 'افتح القفل لنسخ الرابط';

  paintCardKey(node, exam);
  paintCardState(node);
  return node;
}

function syncCard(n) {
  const node = document.getElementById(`exam-${n}`);
  if (node) paintCardState(node);
}

function repaintCards() {
  $$('.card', el.grid).forEach(paintCardState);
}

async function copyExamLink(exam) {
  const link = examShortUrl(exam);
  if (!link || !isSafeUrl(link)) {
    if (!lock.isUnlocked) focusGate();
    return;
  }
  try {
    await navigator.clipboard.writeText(link);
    toast('نُسخ رابط القسم');
  } catch {
    window.prompt('انسخ الرابط:', link);
  }
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

function renderPage() {
  const start = (state.page - 1) * PAGE_SIZE;
  const fragment = document.createDocumentFragment();
  for (const exam of state.results.slice(start, start + PAGE_SIZE)) {
    fragment.append(buildCard(exam));
  }
  el.grid.replaceChildren(fragment);
  renderPager();
}

/**
 * Which page numbers to print.
 *
 * Thirteen of them fit on a desktop and not on a phone, so past a handful the
 * row keeps the first, the last, and the pages either side of this one, with a
 * gap standing in for the rest. The two ends are padded so the row stays about
 * the same width wherever the reader is, instead of growing and shrinking as
 * they move through it.
 */
function pageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const keep = new Set([1, total, current - 1, current, current + 1]);
  if (current <= 4) for (const n of [2, 3, 4, 5]) keep.add(n);
  if (current >= total - 3) for (const n of [total - 4, total - 3, total - 2, total - 1]) keep.add(n);

  const pages = [...keep].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out = [];
  for (const [i, n] of pages.entries()) {
    if (i && n - pages[i - 1] > 1) out.push(null); // a gap, not a page
    out.push(n);
  }
  return out;
}

function renderPager() {
  const total = state.results.length;

  // One page is not a choice, so there is nothing to show.
  el.pager.hidden = state.pages <= 1;
  if (el.pager.hidden) {
    el.pagerPages.replaceChildren();
    el.pagerMeta.textContent = '';
    return;
  }

  el.pagerPrev.disabled = state.page <= 1;
  el.pagerNext.disabled = state.page >= state.pages;

  const fragment = document.createDocumentFragment();
  for (const n of pageNumbers(state.page, state.pages)) {
    const item = document.createElement('li');
    if (n === null) {
      item.className = 'pager__gap';
      item.setAttribute('aria-hidden', 'true');
      item.textContent = '…';
    } else {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pager__page';
      button.dataset.page = String(n);
      button.textContent = arabicNumber(n);
      button.setAttribute('aria-label', `الصفحة ${arabicNumber(n)}`);
      if (n === state.page) button.setAttribute('aria-current', 'page');
      item.append(button);
    }
    fragment.append(item);
  }
  el.pagerPages.replaceChildren(fragment);

  const from = (state.page - 1) * PAGE_SIZE + 1;
  const to = Math.min(state.page * PAGE_SIZE, total);
  // A range inside RTL prose has to be isolated or the bidi algorithm lays it
  // out backwards, so it is built with the helper rather than interpolated.
  el.pagerMeta.replaceChildren(
    document.createTextNode(
      `الصفحة ${arabicNumber(state.page)} من ${arabicNumber(state.pages)} · `,
    ),
    rangeElement(from, to),
    document.createTextNode(` من ${countPhrase(total, 'exam')}`),
  );
}

function renderCount() {
  const total = state.ordered.length;
  const n = state.results.length;
  const text =
    n === total
      ? countPhrase(n, 'exam')
      : `${arabicNumber(n)} من ${countPhrase(total, 'exam')}`;
  el.count.innerHTML = '';
  el.count.append(Object.assign(document.createElement('b'), { textContent: text }));
  el.countLive.textContent = n === 0 ? 'لا توجد نتائج' : `${text} في النتائج`;

  if (state.oldHit) {
    const note = Object.assign(document.createElement('span'), {
      className: 'result-count__note',
      textContent: state.oldHit.alsoCurrent
        ? `\u0648\u0627\u0644\u0631\u0642\u0645 ${arabicNumber(state.oldHit.old)} \u0643\u0627\u0646 \u0623\u064a\u0636\u064b\u0627 \u0631\u0642\u0645 \u0627\u0644\u0642\u0633\u0645 ${arabicNumber(state.oldHit.exam.n)} \u0641\u064a \u0627\u0644\u062a\u0631\u0642\u064a\u0645 \u0627\u0644\u0642\u062f\u064a\u0645`
        : `\u0627\u0644\u0631\u0642\u0645 ${arabicNumber(state.oldHit.old)} \u0631\u0642\u0645 \u0642\u062f\u064a\u0645 \u2014 \u0648\u0647\u0648 \u0627\u0644\u0642\u0633\u0645 ${arabicNumber(state.oldHit.exam.n)} \u0641\u064a \u0627\u0644\u062a\u0631\u0642\u064a\u0645 \u0627\u0644\u062d\u0627\u0644\u064a`,
    });
    el.count.append(note);
  }
}

function renderActiveFilters() {
  const tags = [];
  if (state.q.trim()) tags.push({ key: 'q', label: `بحث: ${state.q.trim()}` });
  if (state.range !== 'all') {
    const r = parseRange(state.range);
    tags.push({ key: 'range', label: 'النماذج', range: r });
  }
  if (state.key === 'only') tags.push({ key: 'key', label: keyLabel() });
  if (state.status !== 'all') {
    const labels = { todo: 'لم تُنجز بعد', done: 'المُنجزة', fav: 'المفضلة' };
    tags.push({ key: 'status', label: labels[state.status] });
  }
  if (state.sort !== DEFAULTS.sort) {
    const labels = {
      'number-desc': 'الترتيب: من الأحدث رقمًا',
      title: 'الترتيب: أبجديًا',
      recent: 'الترتيب: آخر ما فُتح',
      key: `الترتيب: ${keyLabel()} أولًا`,
    };
    tags.push({ key: 'sort', label: labels[state.sort] });
  }

  el.activeTags.replaceChildren();
  for (const tag of tags) {
    const wrap = document.createElement('span');
    wrap.className = 'tag';
    wrap.append(Object.assign(document.createElement('span'), { textContent: tag.label }));
    if (tag.range) wrap.append(' ', rangeElement(tag.range.from, tag.range.to));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'tag__remove';
    const spoken = tag.range
      ? `${tag.label} ${arabicNumber(tag.range.from)} إلى ${arabicNumber(tag.range.to)}`
      : tag.label;
    remove.setAttribute('aria-label', `إزالة عامل التصفية: ${spoken}`);
    remove.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-close"/></svg>';
    remove.addEventListener('click', () => {
      state[tag.key] = DEFAULTS[tag.key];
      if (tag.key === 'q') el.search.value = '';
      applyChange();
    });
    wrap.append(remove);
    el.activeTags.append(wrap);
  }

  el.activeFilters.hidden = tags.length === 0;

  const count = sheetFilterCount();
  el.sheetBadge.hidden = count === 0;
  el.sheetBadge.textContent = arabicNumber(count);
}

/** Empty views that are about the student's own lists get their own guidance. */
const STATUS_EMPTY = {
  fav: {
    icon: 'i-heart',
    title: 'لا توجد نماذج في المفضلة',
    lead: 'اضغط على أيقونة القلب في أي بطاقة لحفظ القسم هنا والرجوع إليه بسرعة.',
  },
  done: {
    icon: 'i-check',
    title: 'لم تُنجز أي قسم بعد',
    lead: 'اضغط «ابدأ الاختبار» في أي قسم، وسيُسجَّل هنا كمُنجز تلقائيًا.',
  },
  todo: {
    icon: 'i-check',
    title: 'أنجزت جميع النماذج',
    lead: 'أحسنت. يمكنك مراجعة أي قسم من تبويب «الكل» في أي وقت.',
  },
};

function renderEmptyState() {
  const hasResults = state.results.length > 0;
  el.empty.hidden = hasResults;
  el.grid.hidden = !hasResults;

  if (hasResults) return;

  const term = state.q.trim();
  const keyOnly = state.key === 'only';
  const listOnly = !term && !keyOnly && state.range === 'all' && STATUS_EMPTY[state.status];

  // The shortlist is spread unevenly across the numbering — some ranges hold
  // none of it at all — so an empty result under it is an ordinary outcome,
  // not a dead end. Name the switch responsible and offer to release it.
  const keyEmpty = !term &&
    keyOnly && {
      icon: 'i-target',
      title: `لا توجد نماذج من ${keyLabel()} هنا`,
      lead:
        state.range !== 'all'
          ? `لا يضم هذا النطاق أي نموذج من ${keyLabel()}. جرّب نطاقًا آخر، أو اعرض كل النماذج.`
          : `لا يوجد نموذج من ${keyLabel()} ضمن عوامل التصفية الحالية.`,
    };

  const copy = keyEmpty || listOnly || {
    icon: 'i-inbox',
    title: 'لا توجد نتائج',
    lead: term ? 'لم نجد نموذجًا مطابقًا لـ' : 'لا توجد نماذج ضمن عوامل التصفية الحالية.',
  };
  el.emptyIcon.setAttribute('href', `#${copy.icon}`);
  el.emptyTitle.textContent = copy.title;
  el.emptyLead.textContent = copy.lead;
  el.emptyTerm.textContent = term;
  el.emptyTerm.hidden = !term;

  // Suggest the closest numbers so a mistyped number is still one click away.
  el.suggestions.replaceChildren();

  if (keyEmpty) {
    const release = document.createElement('button');
    release.type = 'button';
    release.className = 'chip';
    release.textContent = 'اعرض كل النماذج';
    release.addEventListener('click', () => {
      state.key = 'all';
      applyChange();
    });
    el.suggestions.append(release);
  }

  const digits = state.query.digits;
  if (digits && state.data) {
    const target = Number(digits);
    const nearest = state.ordered
      .map((e) => ({ e, d: Math.abs(e.n - target) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);
    if (nearest.length) {
      el.suggestions.append(
        Object.assign(document.createElement('span'), {
          className: 'active-filters__label',
          textContent: 'أقرب النماذج:',
        }),
      );
      for (const { e } of nearest) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.textContent = `${arabicNumber(e.n)} · ${e.t}`;
        chip.addEventListener('click', () => {
          state.q = String(e.n);
          el.search.value = state.q;
          applyChange();
        });
        el.suggestions.append(chip);
      }
    }
  }
}

/**
 * Quick-jump chips. Their counts are recomputed rather than read from the
 * dataset's own totals, because the shortlist switch changes what each range
 * actually holds — and because boot() drops any record with an unusable link,
 * which a pre-built total would not know about.
 */
function renderChips() {
  const keyOnly = state.key === 'only';
  const allLabel = $('.chip__label', el.rangeChips);
  if (allLabel) allLabel.textContent = keyOnly ? 'كل الأرقام' : 'كل النماذج';

  $$('[data-range]', el.rangeChips).forEach((chip) => {
    chip.setAttribute('aria-pressed', String(chip.dataset.range === state.range));

    const badge = $('.chip__count', chip);
    if (!badge) return;

    const range = parseRange(chip.dataset.range);
    const within = range
      ? state.ordered.filter((e) => e.n >= range.from && e.n <= range.to)
      : state.ordered;
    const count = keyOnly ? within.filter(isKey).length : within.length;

    badge.textContent = arabicNumber(count);
    chip.classList.toggle('chip--empty', count === 0);
    if (range) {
      chip.setAttribute(
        'aria-label',
        `النماذج من ${arabicNumber(range.from)} إلى ${arabicNumber(range.to)} (${countPhrase(
          count,
          'exam',
        )})`,
      );
    }
  });
}

/** The shortlist toggle, in the toolbar and on its quick-access tile. */
function renderKeyControls() {
  if (!state.priority) return;
  const on = state.key === 'only';
  const label = keyLabel();

  el.keyToggle.setAttribute('aria-pressed', String(on));
  el.keyToggle.setAttribute(
    'aria-label',
    on ? `إلغاء تصفية ${label} وعرض كل النماذج` : `اعرض ${label} وحدها`,
  );

  el.tileKey.setAttribute('aria-pressed', String(on));
  el.tileKeyState.textContent = on ? 'معروضة الآن' : 'اعرضها';

  // The tile above carries the blurb; repeating it here would print the same
  // sentence twice on one screen. This line explains the control instead, and
  // has to read correctly whichever way the switch is currently set.
  el.keyHint.textContent = on
    ? 'معروضة وحدها الآن — اضغط المفتاح للرجوع إلى كل النماذج.'
    : 'اضغط لعرضها وحدها — يعمل مع البحث والحالة والمجموعات معًا.';
}

function renderStatusCounts() {
  $$('[data-status]', el.statusGroup).forEach((button) => {
    const badge = $('.segmented__count', button);
    if (badge) badge.textContent = arabicNumber(state.counts[button.dataset.status] ?? 0);
  });
}

function renderControls() {
  el.sortSelect.value = state.sort;
  renderKeyControls();
  $$('[data-status]', el.statusGroup).forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.status === state.status));
  });
  renderStatusCounts();
}

function render() {
  el.grid.setAttribute('aria-busy', 'false');
  renderCount();
  renderActiveFilters();
  renderChips();
  renderControls();
  renderEmptyState();
  renderPage();
}

function applyChange({ scroll = false, keepPage = false } = {}) {
  // Any change to what is in the list puts the reader back at its start.
  // Clamping alone would leave them on some arbitrary page of a list they have
  // just replaced, which reads as the site losing their place.
  if (!keepPage) state.page = 1;
  compute();
  render();
  syncUrl();
  if (scroll) scrollToResults();
}

/** Turn to another page. The results themselves have not changed. */
function goToPage(next) {
  const target = Math.min(Math.max(1, Math.trunc(next) || 1), state.pages);
  if (target === state.page) return;
  state.page = target;
  render();
  syncUrl();
  scrollToResults();
  // The click that turned the page was at the foot of the list and the reader
  // is now at its head, so the keyboard goes with them. A mouse leaves no ring:
  // the focus styles in base.css are :focus-visible.
  el.grid.querySelector('.card__cta')?.focus({ preventScroll: true });
}

/** Bring the top of the list into view — only if the student is below it. */
function keepResultsInView() {
  const section = document.getElementById('exams');
  if (section && section.getBoundingClientRect().top < 0) scrollToResults();
}

function scrollToResults() {
  document.getElementById('exams')?.scrollIntoView({ block: 'start' });
}

/* -------------------------------------------------------------------------- */
/* Progress                                                                    */
/* -------------------------------------------------------------------------- */

/** Counted against the published dataset, so stale numbers never inflate it. */
function progressStats() {
  let done = 0;
  let fav = 0;
  let keyTotal = 0;
  let keyDone = 0;
  for (const exam of state.ordered) {
    const key = isKey(exam);
    if (key) keyTotal += 1;
    if (store.isDone(exam.n)) {
      done += 1;
      if (key) keyDone += 1;
    }
    if (store.isFav(exam.n)) fav += 1;
  }
  const total = state.ordered.length;
  return {
    total,
    done,
    fav,
    todo: total - done,
    keyTotal,
    keyDone,
    keyTodo: keyTotal - keyDone,
  };
}

/** Fill, label and ARIA for one progress track. */
function paintTrack({ bar, fill, pct }, done, total) {
  const share = total ? (done / total) * 100 : 0;
  const text = percentText(done, total);
  // A tiny share of a wide track renders as nothing at all; keep a visible
  // sliver so "some progress" never looks like "no progress".
  fill.style.width = share > 0 ? `max(${share.toFixed(2)}%, 8px)` : '0';
  pct.textContent = text;
  bar.setAttribute('aria-valuenow', share.toFixed(1));
  bar.setAttribute(
    'aria-valuetext',
    `${arabicNumber(done)} من ${arabicNumber(total)} (${text})`,
  );
}

/**
 * Where "resume" should take the student:
 *  - the last form they opened, if they have not marked it done ("أكمل")
 *  - otherwise the first unfinished form after it ("تابع")
 *  - otherwise the first unfinished form at all ("ابدأ" on a fresh device)
 *  - nothing, once every form is done.
 */
function resumeTarget() {
  const exams = state.ordered;
  const last = state.byNumber.get(store.lastOpened);
  if (last && !store.isDone(last.n)) return { exam: last, mode: 'continue' };

  const after = last ? exams.find((e) => e.n > last.n && !store.isDone(e.n)) : null;
  const next = after || exams.find((e) => !store.isDone(e.n));
  if (!next) return { exam: null, mode: 'complete' };

  const started = Boolean(last) || exams.some((e) => store.isDone(e.n));
  return { exam: next, mode: started ? 'next' : 'start' };
}

/** A form not yet done (never the one just opened); any form once all are done. */
function randomTarget() {
  const exams = state.ordered;
  const last = store.lastOpened;
  const todo = exams.filter((e) => !store.isDone(e.n) && e.n !== last);
  const pool = todo.length ? todo : exams.filter((e) => e.n !== last);
  const from = pool.length ? pool : exams;
  return from.length ? from[Math.floor(Math.random() * from.length)] : null;
}

function pointTileAt(tile, exam, label) {
  if (!exam) {
    tile.removeAttribute('href');
    tile.removeAttribute('target');
    delete tile.dataset.target;
    delete tile.dataset.locked;
    return;
  }

  const url = examUrl(exam);
  if (!url) {
    // Locked. The tile still knows which section it means and still leads
    // somewhere — to the gate, which is the only place that can open it. A
    // tile with no href at all would be unreachable by keyboard.
    tile.href = '#unlock';
    tile.removeAttribute('target');
    tile.dataset.locked = 'true';
    delete tile.dataset.target;
    tile.setAttribute('aria-label', `${label} — ${exam.t} (مقفول: اكتب كلمة المرور)`);
    return;
  }

  tile.href = url;
  tile.setAttribute('target', '_blank');
  delete tile.dataset.locked;
  tile.dataset.target = String(exam.n);
  tile.setAttribute('aria-label', `${label} — ${exam.t} (يفتح في تبويب جديد)`);
}

const RESUME_LABELS = {
  start: (n) => `ابدأ بالقسم ${n}`,
  continue: (n) => `أكمل القسم ${n}`,
  next: (n) => `تابع بالقسم ${n}`,
};

function refreshQuickAccess() {
  if (!state.ordered.length) return;
  const stats = progressStats();

  if (store.isAvailable) {
    el.progress.hidden = stats.done === 0;
    el.progressLabel.textContent = `أنجزتَ ${arabicNumber(stats.done)} من ${countPhrase(
      stats.total,
      'exam',
    )}`;
    paintTrack(
      { bar: el.progressBar, fill: el.progressFill, pct: el.progressPct },
      stats.done,
      stats.total,
    );

    // The second track answers the question the shortlist raises: how much of
    // the part that matters most is already behind you?
    el.progressKeyTrack.hidden = stats.keyTotal === 0;
    if (stats.keyTotal) {
      el.progressKeyName.textContent = `${keyLabel()} — ${arabicNumber(
        stats.keyDone,
      )} من ${arabicNumber(stats.keyTotal)}`;
      paintTrack(
        { bar: el.progressKeyBar, fill: el.progressKeyFill, pct: el.progressKeyPct },
        stats.keyDone,
        stats.keyTotal,
      );
    }
  } else {
    el.progress.hidden = true;
  }

  const resume = resumeTarget();
  if (resume.exam) {
    const label = RESUME_LABELS[resume.mode](arabicNumber(resume.exam.n));
    el.tileResumeLabel.textContent = label;
    el.tileResumeMeta.textContent = resume.exam.t;
    pointTileAt(el.tileResume, resume.exam, label);
  } else {
    const review = randomTarget();
    el.tileResumeLabel.textContent = 'أنجزت جميع النماذج';
    el.tileResumeMeta.textContent = 'راجِع قسمًا عشوائيًا';
    pointTileAt(el.tileResume, review, 'مراجعة نموذج عشوائي');
  }

  if (stats.todo === 0) el.tileTodoMeta.textContent = 'أنجزت جميع النماذج';
  else if (stats.done === 0) el.tileTodoMeta.textContent = 'كل قسم تبدؤه يُسجَّل كمُنجز';
  else el.tileTodoMeta.textContent = `بقي لك ${countPhrase(stats.todo, 'exam')}`;

  el.tileFavMeta.textContent = stats.fav
    ? `${countPhrase(stats.fav, 'exam')} في المفضلة`
    : 'احفظ أي قسم بالضغط على القلب';

  el.tileRandomMeta.textContent =
    stats.done > 0 && stats.todo > 0 ? 'من النماذج التي لم تُنجزها' : 'يفتح فورًا في تبويب جديد';
  pointTileAt(el.tileRandom, randomTarget(), 'قسم عشوائي');

  if (stats.keyTotal) {
    // Before any progress, say what the set is; after some, say what is left.
    el.tileKeyMeta.textContent =
      stats.keyDone === 0
        ? state.priority?.blurb || `${countPhrase(stats.keyTotal, 'exam')} ابدأ بها`
        : stats.keyTodo === 0
          ? `أنجزتها كلها — ${countPhrase(stats.keyTotal, 'exam')}`
          : `بقي لك ${countPhrase(stats.keyTodo, 'exam')} من ${arabicNumber(stats.keyTotal)}`;
  }
}

/** Counters, tiles and tabs — everything except the list itself. */
function refreshProgress() {
  refreshQuickAccess();
  countStatuses();
  renderStatusCounts();
}

function setDone(n, on, { announce = true } = {}) {
  store.setDone(n, on);
  syncCard(n);
  refreshProgress();
  if (announce) {
    toast(on ? `سُجِّل القسم ${arabicNumber(n)} كمُنجز` : `أُلغي تحديد القسم ${arabicNumber(n)}`);
  }
}

function toggleFav(n) {
  const on = store.toggleFav(n);
  syncCard(n);
  refreshProgress();
  toast(on ? 'أُضيف إلى المفضلة' : 'أُزيل من المفضلة');
}

/**
 * Called from the click on any link that opens a form: the form counts as done
 * from that moment, and the toast offers an undo for a mistaken tap.
 *
 * UI updates are deferred: re-pointing a tile's href inside its own click
 * handler would make the browser open the *new* target instead of the one
 * that was clicked.
 */
function examOpened(n, { random = false } = {}) {
  const exam = state.byNumber.get(n);
  if (!exam) return;

  const newlyDone = !store.isDone(n);
  store.markOpened(n);
  if (newlyDone) store.setDone(n, true);
  store.flush(); // this tab is about to be hidden, and may be discarded

  setTimeout(() => {
    syncCard(n);
    refreshProgress();

    const number = arabicNumber(n);
    if (!newlyDone) {
      if (random) toast(`فُتح القسم ${number}: ${exam.t}`);
      return;
    }
    toast(random ? `فُتح القسم ${number} وسُجِّل كمُنجز` : `سُجِّل القسم ${number} كمُنجز`, {
      duration: 6000,
      action: { label: 'تراجع', onClick: () => setDone(n, false) },
    });
  }, 0);
}

/* -------------------------------------------------------------------------- */
/* Deep links                                                                  */
/* -------------------------------------------------------------------------- */

function flashCard(n) {
  const target = document.getElementById(`exam-${n}`);
  if (!target) return false;
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.classList.remove('card--flash');
  void target.offsetWidth; // restart the animation
  target.classList.add('card--flash');
  const cta = $('.card__cta', target);
  if (cta && cta.tagName === 'A') cta.focus({ preventScroll: true });
  return true;
}

/** Reveal a specific form number, loading more batches if it is further down. */
function revealExam(n) {
  if (!state.byNumber.has(n)) return false;
  const index = state.results.findIndex((e) => e.n === n);
  if (index === -1) {
    // It is filtered out — clear filters so the user still lands on it.
    state.range = 'all';
    state.status = 'all';
    state.q = '';
    el.search.value = '';
    applyChange();
    return revealExam(n);
  }
  // Turn to the page it sits on rather than piling up everything before it.
  const page = Math.floor(index / PAGE_SIZE) + 1;
  if (page !== state.page) {
    state.page = page;
    render();
    syncUrl();
  }
  return flashCard(n);
}

/* -------------------------------------------------------------------------- */
/* Mobile filter sheet                                                          */
/* -------------------------------------------------------------------------- */

let lastFocused = null;

function openSheet() {
  hideToast(); // it would sit over the sheet's own buttons
  el.sheetBody.append(el.controls);
  el.sheet.hidden = false;
  document.body.style.overflow = 'hidden';
  lastFocused = document.activeElement;
  el.sheetClose.focus();
  document.addEventListener('keydown', sheetKeydown);
}

function closeSheet() {
  el.controlsHome.append(el.controls);
  el.sheet.hidden = true;
  document.body.style.overflow = '';
  document.removeEventListener('keydown', sheetKeydown);
  if (lastFocused instanceof HTMLElement) lastFocused.focus();
}

function sheetKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeSheet();
    return;
  }
  if (event.key !== 'Tab') return;

  const focusable = $$(
    'a[href], button:not([disabled]), select, input, [tabindex]:not([tabindex="-1"])',
    el.sheet,
  ).filter((node) => node.offsetParent !== null);
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* -------------------------------------------------------------------------- */
/* Wiring                                                                       */
/* -------------------------------------------------------------------------- */

/** Treat a middle-click like a click: it opens the form just the same. */
function onOpenLink(node, handler) {
  node.addEventListener('click', handler);
  node.addEventListener('auxclick', (event) => {
    if (event.button === 1) handler(event);
  });
}

function bindEvents() {
  el.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    el.search.blur();
  });

  const onInput = debounce(() => {
    state.q = el.search.value;
    el.clear.hidden = !state.q;
    applyChange();
  }, 130);

  el.search.addEventListener('input', () => {
    el.clear.hidden = !el.search.value;
    onInput();
  });

  el.clear.addEventListener('click', () => {
    el.search.value = '';
    state.q = '';
    el.clear.hidden = true;
    el.search.focus();
    applyChange();
  });

  el.rangeChips.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-range]');
    if (!chip) return;
    state.range = chip.dataset.range === state.range ? 'all' : chip.dataset.range;
    applyChange({ scroll: true });
  });

  el.statusGroup.addEventListener('click', (event) => {
    const button = event.target.closest('[data-status]');
    if (!button || button.dataset.status === state.status) return;
    state.status = button.dataset.status;
    applyChange();
    if (el.sheet.hidden) keepResultsInView();
  });

  el.sortSelect.addEventListener('change', () => {
    state.sort = el.sortSelect.value;
    applyChange();
    if (el.sheet.hidden) keepResultsInView();
  });

  // The toggle in the toolbar and the tile at the top of the page drive the
  // same switch; only the tile scrolls the list into view, because it is the
  // one the student pressed from somewhere else on the page.
  const toggleKey = ({ scroll = false } = {}) => {
    state.key = state.key === 'only' ? 'all' : 'only';
    applyChange({ scroll });
  };

  el.keyToggle.addEventListener('click', () => {
    toggleKey();
    if (el.sheet.hidden) keepResultsInView();
  });

  el.tileKey.addEventListener('click', () => toggleKey({ scroll: true }));

  // One delegated listener for every card, however many batches are loaded.
  el.grid.addEventListener('click', (event) => {
    const node = event.target.closest('.card');
    const exam = node && state.byNumber.get(Number(node.dataset.n));
    if (!exam) return;

    if (event.target.closest('.card__toggle')) setDone(exam.n, !store.isDone(exam.n));
    else if (event.target.closest('.card__fav')) toggleFav(exam.n);
    else if (event.target.closest('.card__copy')) copyExamLink(exam);
    else if (event.target.closest('.card__cta--locked')) focusGate();
    else if (event.target.closest('a.card__cta')) examOpened(exam.n);
  });

  el.grid.addEventListener('auxclick', (event) => {
    if (event.button !== 1) return;
    const cta = event.target.closest('a.card__cta');
    const n = Number(cta?.closest('.card')?.dataset.n);
    if (n) examOpened(n);
  });

  el.resetAll.addEventListener('click', resetAll);
  el.resetProxies.forEach((button) => button.addEventListener('click', resetAll));
  el.sheetReset.addEventListener('click', () => {
    resetAll();
    closeSheet();
  });

  el.pagerPrev.addEventListener('click', () => goToPage(state.page - 1));
  el.pagerNext.addEventListener('click', () => goToPage(state.page + 1));
  el.pagerPages.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-page]');
    if (button) goToPage(Number(button.dataset.page));
  });

  el.sheetOpen.addEventListener('click', openSheet);
  el.sheetClose.addEventListener('click', closeSheet);
  el.sheetApply.addEventListener('click', closeSheet);
  $('.sheet__backdrop', el.sheet).addEventListener('click', closeSheet);

  onOpenLink(el.tileResume, () => {
    const n = Number(el.tileResume.dataset.target);
    if (n) examOpened(n);
    else if (el.tileResume.dataset.locked) focusGate();
  });

  onOpenLink(el.tileRandom, () => {
    const n = Number(el.tileRandom.dataset.target);
    if (!n && el.tileRandom.dataset.locked) return focusGate();
    if (n) examOpened(n, { random: true });
  });

  el.tileTodo.addEventListener('click', () => {
    state.status = 'todo';
    state.q = '';
    el.search.value = '';
    el.clear.hidden = true;
    applyChange({ scroll: true });
  });

  el.tileFav.addEventListener('click', () => {
    state.status = 'fav';
    state.q = '';
    el.search.value = '';
    el.clear.hidden = true;
    applyChange({ scroll: true });
  });

  // Reset is immediate and undoable — a confirmation dialog protects nothing
  // that an undo does not protect better.
  el.progressReset.addEventListener('click', () => {
    const snapshot = store.snapshot();
    store.resetProgress();
    repaintCards();
    refreshProgress();
    const undo = toast('مُسح سجل الإنجاز، والمفضلة كما هي', {
      duration: 8000,
      action: {
        label: 'تراجع',
        onClick: () => {
          store.restore(snapshot);
          repaintCards();
          refreshProgress();
          toast('استُعيد سجل الإنجاز');
        },
      },
    });
    // The reset button disappears with the progress it reset; keep the
    // keyboard focus somewhere useful instead of dropping it on <body>.
    undo?.focus({ preventScroll: true });
  });

  el.toast.addEventListener('mouseenter', () => clearTimeout(toastHandle));
  el.toast.addEventListener('mouseleave', () => {
    if (el.toast.classList.contains('toast--visible')) scheduleToastHide(2500);
  });
  el.toast.addEventListener('focusin', () => clearTimeout(toastHandle));
  el.toast.addEventListener('focusout', (event) => {
    if (!el.toast.contains(event.relatedTarget) && el.toast.classList.contains('toast--visible')) {
      scheduleToastHide(2500);
    }
  });

  // "/" focuses search from anywhere; Escape clears it.
  document.addEventListener('keydown', (event) => {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      el.search.focus();
      el.search.select();
    } else if (event.key === 'Escape' && document.activeElement === el.search && el.search.value) {
      el.search.value = '';
      state.q = '';
      el.clear.hidden = true;
      applyChange();
    }
  });

  window.addEventListener('popstate', () => {
    readStateFromUrl();
    el.search.value = state.q;
    el.clear.hidden = !state.q;
    compute();
    render();
  });

  document.addEventListener('visibilitychange', () => {
    const toastShown = el.toast.classList.contains('toast--visible');
    if (document.visibilityState === 'hidden') {
      if (toastShown) clearTimeout(toastHandle);
      return;
    }
    // Back from the form: refresh the "opened…" times, and give the held
    // confirmation (with its undo) a few seconds on screen.
    repaintCards();
    refreshProgress();
    if (toastShown) scheduleToastHide(5000);
  });

  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    // Restored from the back/forward cache: storage events were missed.
    store.reload();
    repaintCards();
    refreshProgress();
  });

  if (el.gateForm) {
    el.gateForm.addEventListener('submit', submitGate);
    el.gatePeek.addEventListener('click', () => {
      setPeek(el.gatePeek.getAttribute('aria-pressed') !== 'true');
      el.gateInput.focus();
    });
    // Typing again clears yesterday's refusal: the message was about the last
    // attempt, not about what is in the field now.
    el.gateInput.addEventListener('input', () => {
      if (el.gateResult.dataset.state === 'wrong') setGateResult(null, '');
    });
    el.gateRelock.addEventListener('click', () => {
      lock.relock();
      toast('أُقفلت النماذج على هذا الجهاز');
      focusGate();
    });
  }

  el.errorRetry?.addEventListener('click', () => location.reload());

  el.progressExport?.addEventListener('click', downloadProgress);
  el.progressImport?.addEventListener('click', () => el.progressFile?.click());
  el.progressFile?.addEventListener('change', (event) => {
    const [file] = event.target.files || [];
    uploadProgress(file);
    event.target.value = ''; // so picking the same file again still fires
  });

  // Another tab of the portal changed progress.
  store.subscribe(() => {
    repaintCards();
    refreshProgress();
  });

  // Keep the controls in the right container when the viewport crosses 900px.
  const mq = window.matchMedia('(min-width: 900px)');
  const syncControlsHome = () => {
    if (mq.matches && !el.sheet.hidden) closeSheet();
    if (mq.matches && el.controls.parentElement !== el.controlsHome) {
      el.controlsHome.append(el.controls);
    }
  };
  mq.addEventListener('change', syncControlsHome);
}

function resetAll() {
  Object.assign(state, DEFAULTS);
  el.search.value = '';
  el.clear.hidden = true;
  applyChange();
}

/* -------------------------------------------------------------------------- */
/* The gate                                                                    */
/*                                                                             */
/* One card at the top of the list, in four states. It owns nothing: the       */
/* verdict comes from lock.js, and every state below is a reading of it.       */
/*                                                                             */
/* There is deliberately no lockout after N wrong tries. A counter in this     */
/* file is a variable in the reader's own browser — anyone willing to work     */
/* around it has already opened the console, where the lock is not this        */
/* counter but 600,000 rounds of PBKDF2 per guess. All a lockout would buy is  */
/* a student who fat-fingered a password three times being told to go away.    */
/* -------------------------------------------------------------------------- */

const GATE_TEXT = {
  locked:
    'أسماء الأقسام وأرقامها مفتوحة للجميع، وفتحُ النموذج نفسه يحتاج كلمة المرور. تُكتب مرة واحدة على هذا الجهاز.',
  unlocked: 'النماذج مفتوحة على هذا الجهاز. اضغط «ابدأ الاختبار» على أي قسم بالأسفل.',
  loading: 'لحظة واحدة…',
  error: 'تعذّر الوصول إلى ملف الفتح. تحقّق من اتصالك ثم حدّث الصفحة.',
};

let gateBusy = false;

function setGateResult(kind, message) {
  if (!el.gateResult) return;
  if (!message) {
    el.gateResult.removeAttribute('data-state');
    el.gateResult.textContent = '';
    return;
  }
  el.gateResult.dataset.state = kind;
  el.gateResult.textContent = message;
}

function setGateIcon(name) {
  $('use', el.gateIcon)?.setAttribute('href', name);
}

function renderGate() {
  if (!el.gateCard) return;
  const status = lock.status;

  el.gateCard.dataset.state = status;
  el.gateForm.hidden = status !== 'locked';
  el.gateAsk.hidden = status === 'unlocked' || status === 'loading';
  el.gateOpen.hidden = status !== 'unlocked';

  if (status === 'loading') {
    setGateIcon('#i-lock');
    el.gateEyebrow.textContent = 'جارٍ التحقق';
    el.gateTitle.textContent = 'جارٍ التحقق من الفتح…';
    el.gateText.textContent = GATE_TEXT.loading;
    setGateResult(null, '');
    return;
  }

  if (status === 'unlocked') {
    setGateIcon('#i-unlock');
    el.gateEyebrow.textContent = 'النماذج مفتوحة';
    el.gateTitle.textContent = 'تم فتح النماذج';
    el.gateText.textContent = GATE_TEXT.unlocked;
    setGateResult('ok', `جاهز — ${countPhrase(lock.count, 'exam')} في متناولك.`);
    return;
  }

  if (status === 'error') {
    setGateIcon('#i-lock');
    el.gateEyebrow.textContent = 'تعذّر التحقق';
    el.gateTitle.textContent = 'لم نتمكّن من قراءة ملف الفتح';
    el.gateText.textContent = GATE_TEXT.error;
    setGateResult('wrong', 'حدّث الصفحة، وإن تكرّر الأمر راسل الأستاذ.');
    return;
  }

  setGateIcon('#i-lock');
  el.gateEyebrow.textContent = 'النماذج مقفولة';
  el.gateTitle.textContent = 'اكتب كلمة المرور لفتح النماذج';
  el.gateText.textContent = GATE_TEXT.locked;

  if (lock.reason === REASON.CHANGED) {
    // The saved password stopped opening the file, which can only mean the
    // teacher published a new one. Say that, rather than "wrong password" —
    // the student did nothing wrong and nothing on their side is broken.
    setGateResult('note', 'تم تغيير كلمة المرور. اطلب الكلمة الجديدة من الأستاذ.');
  } else if (lock.reason === REASON.WRONG) {
    setGateResult('wrong', 'كلمة المرور غير صحيحة. تأكّد منها وحاول مرة أخرى.');
  } else {
    setGateResult(null, '');
  }
}

/** Send the reader to the one field that can change anything. */
function focusGate() {
  const section = document.getElementById('unlock');
  if (!section) return;
  section.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (!el.gateForm.hidden) {
    el.gateInput.focus({ preventScroll: true });
    el.gateInput.select();
  }
}

async function submitGate(event) {
  event?.preventDefault();
  if (gateBusy || !el.gateInput) return;

  const typed = el.gateInput.value;
  if (!typed.trim()) {
    setGateResult('wrong', 'اكتب كلمة المرور أولًا.');
    el.gateInput.focus();
    return;
  }

  // Deriving the key is slow on purpose, and on a phone it is slow enough to
  // notice. Say something, or the button looks broken.
  gateBusy = true;
  el.gateSubmit.disabled = true;
  el.gateInput.readOnly = true;
  el.gateSubmitLabel.textContent = 'جارٍ الفتح…';
  setGateResult('note', 'جارٍ التحقق…');

  const result = await lock.unlock(typed);

  gateBusy = false;
  el.gateSubmit.disabled = false;
  el.gateInput.readOnly = false;
  el.gateSubmitLabel.textContent = 'ادخل';

  if (result.ok) {
    // The password is not left sitting in a field on a shared phone.
    el.gateInput.value = '';
    setPeek(false);
    toast(`تم فتح النماذج — ${countPhrase(lock.count, 'exam')}`);
    return; // lock.onChange repaints everything
  }

  renderGate();
  if (result.reason === REASON.ERROR) {
    setGateResult('wrong', 'تعذّر التحقق الآن. حدّث الصفحة وحاول مرة أخرى.');
  }
  el.gateInput.focus();
  el.gateInput.select();
}

function setPeek(on) {
  if (!el.gatePeek) return;
  el.gateInput.type = on ? 'text' : 'password';
  el.gatePeek.setAttribute('aria-pressed', String(on));
  el.gatePeek.setAttribute('aria-label', on ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
  $('use', el.gatePeek)?.setAttribute('href', on ? '#i-eye-off' : '#i-eye');
}

/** Everything that changes when the gate opens or shuts. */
function onLockChange() {
  renderGate();
  if (!state.ordered.length) return;
  renderPage();
  refreshQuickAccess();
}

/* -------------------------------------------------------------------------- */
/* Moving progress to another device                                           */
/*                                                                             */
/* Progress is deliberately device-local, which means a new phone starts empty. */
/* A file the student carries themselves is the only transfer this site will   */
/* ever have: no account, no server, nothing that can leak.                    */
/* -------------------------------------------------------------------------- */

function downloadProgress() {
  const payload = exportProgress();
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: `qimma-progress-${stamp}.json`,
  });
  document.body.append(a);
  a.click();
  a.remove();
  // Revoking straight away cancels the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('\u062d\u064f\u0641\u0638\u062a \u0646\u0633\u062e\u0629 \u0645\u0646 \u062a\u0642\u062f\u0651\u0645\u0643 \u0641\u064a \u0645\u0644\u0641');
}

async function uploadProgress(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    // Merge rather than replace: a student restoring on a phone they have
    // already used should not lose what they did on it.
    const result = importProgress(parsed, { merge: true });
    if (!result || result.ok === false) {
      toast('\u0627\u0644\u0645\u0644\u0641 \u063a\u064a\u0631 \u0635\u0627\u0644\u062d \u2014 \u0644\u0645 \u064a\u062a\u063a\u064a\u0651\u0631 \u0634\u064a\u0621');
      return;
    }
    repaintCards();
    refreshQuickAccess();
    toast(`\u0627\u0633\u062a\u064f\u0639\u064a\u062f \u062a\u0642\u062f\u0651\u0645\u0643: ${countPhrase(progressStats().done, 'exam')} \u0645\u064f\u0646\u062c\u0632\u0629`);
  } catch {
    toast('\u062a\u0639\u0630\u0651\u0631\u062a \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0645\u0644\u0641 \u2014 \u062a\u0623\u0643\u062f \u0623\u0646\u0647 \u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0630\u064a \u062d\u0641\u0638\u062a\u0647 \u0645\u0646 \u0647\u0646\u0627');
  }
}

/* -------------------------------------------------------------------------- */
/* Boot                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Everything the shortlist adds to the page, set up once from the dataset.
 * A build without a shortlist leaves all of it hidden — the switch, the tile,
 * the sort option and the second progress track — rather than showing an
 * empty promise.
 */
function renderPriorityMeta(priority) {
  state.priority = priority || null;

  // No shortlist in this build: every affordance that mentions one stays
  // hidden. The hero figure ships hidden in the markup so it never flashes a
  // «0 الأكثر تكرارًا» before the data arrives.
  if (!state.priority) {
    if (el.statKeyItem) el.statKeyItem.hidden = true;
    return;
  }

  const label = keyLabel();
  const count = arabicNumber(state.priority.count);

  el.statPriority.forEach((n) => (n.textContent = count));
  document.querySelectorAll('[data-unit="priority"]').forEach((n) => {
    n.textContent = label;
  });

  el.keyToggleLabel.textContent = label;
  el.keyToggleCount.textContent = count;
  el.keyBar.hidden = false;

  el.tileKeyLabel.textContent = label;
  el.tileKey.hidden = false;

  if (el.statKeyItem) el.statKeyItem.hidden = false;

  el.sortKeyOption.textContent = `${label} أولًا`;
  el.sortKeyOption.hidden = false;
}

function renderMeta(meta) {
  const fmt = (n) => (typeof n === 'number' ? arabicNumber(n) : '—');
  el.statTotal.forEach((n) => (n.textContent = fmt(meta.total)));
  el.statQuestions.forEach((n) => (n.textContent = fmt(meta.totalQuestions)));
  renderPriorityMeta(meta.priority);

  // Unit labels must agree with the number they sit beside.
  document.querySelectorAll('[data-unit="exam"]').forEach((n) => {
    // Exactly what tools/build-data.mjs stamps into the markup: if the two ever
    // disagree the hero silently reflows on boot, which is a layout shift.
    n.textContent = unitNoun(meta.total, 'exam');
  });
  document.querySelectorAll('[data-unit="question"]').forEach((n) => {
    n.textContent = unitNoun(meta.totalQuestions ?? 0, 'question');
  });
  el.statUpdated.forEach((n) => {
    if (!meta.generated) {
      n.closest('li')?.remove();
      return;
    }
    n.textContent = formatDate(meta.generated);
    n.setAttribute('datetime', meta.generated);
  });

  el.rangeChips.replaceChildren();
  const allChip = document.createElement('button');
  allChip.type = 'button';
  allChip.className = 'chip';
  allChip.dataset.range = 'all';
  allChip.append(
    Object.assign(document.createElement('span'), {
      className: 'chip__label',
      textContent: 'كل النماذج',
    }),
  );
  allChip.append(
    Object.assign(document.createElement('span'), {
      className: 'chip__count',
      textContent: arabicNumber(meta.total),
    }),
  );
  el.rangeChips.append(allChip);

  for (const range of meta.ranges ?? []) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.range = `${range.from}-${range.to}`;
    chip.append(rangeElement(range.from, range.to));
    chip.setAttribute(
      'aria-label',
      `النماذج من ${arabicNumber(range.from)} إلى ${arabicNumber(range.to)} (${countPhrase(
        range.count,
        'exam',
      )})`,
    );
    chip.append(
      Object.assign(document.createElement('span'), {
        className: 'chip__count',
        textContent: arabicNumber(range.count),
      }),
    );
    el.rangeChips.append(chip);
  }
}

function showError() {
  el.error.hidden = false;
  el.grid.hidden = true;
  el.grid.setAttribute('aria-busy', 'false');
  el.empty.hidden = true;
  el.pager.hidden = true;
  document.getElementById('quickAccess')?.setAttribute('hidden', '');

  // Without data these controls promise something the page cannot deliver.
  document.getElementById('heroStats')?.setAttribute('hidden', '');
  el.searchForm?.setAttribute('hidden', '');
  document.getElementById('searchHint')?.setAttribute('hidden', '');
  document.querySelector('.toolbar__controls')?.setAttribute('hidden', '');
  el.sheetOpen?.setAttribute('hidden', '');
  document.querySelector('.ranges')?.setAttribute('hidden', '');
  el.keyBar?.setAttribute('hidden', '');
  el.count.textContent = '';
}

async function boot() {
  document.documentElement.classList.add('has-js');

  try {
    const response = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data || !Array.isArray(data.exams) || data.exams.length === 0) {
      throw new Error('empty dataset');
    }

    // A record needs a number and a title to be a card. It no longer needs a
    // link: the links are not in this file at all, and whether one can be
    // produced is the lock's question, asked again every time a card is built.
    data.exams = data.exams.filter((e) => Boolean(e && Number.isInteger(e.n) && e.t));
    if (!data.exams.length) throw new Error('no usable records');

    data.meta = data.meta || {};
    data.meta.total = data.exams.length;

    // Records were just dropped for unusable links; the shortlist count has to
    // follow, or the page would advertise forms it cannot open.
    if (data.meta.priority) {
      const flagged = data.exams.filter((e) => e.p).length;
      data.meta.priority = flagged ? { ...data.meta.priority, count: flagged } : null;
    }

    state.data = data;
    state.ordered = data.exams.slice().sort((a, b) => a.n - b.n);
    state.byNumber = new Map(state.ordered.map((e) => [e.n, e]));

    // Wait for the verdict before the first paint. It is already in flight —
    // lock.js starts fetching when it is imported — and on a device that has
    // unlocked before this is the difference between the cards appearing right
    // and the cards appearing locked and then visibly flipping.
    await lock.ready;
    lock.onChange(onLockChange);

    renderMeta(data.meta);
    bindEvents();
    renderGate();
    readStateFromUrl();
    el.search.value = state.q;
    el.clear.hidden = !state.q;
    refreshQuickAccess();
    compute();
    render();

    // Deep link: #exam-47 scrolls to and highlights that form.
    const hash = /^#exam-(\d+)$/.exec(location.hash);
    if (hash) requestAnimationFrame(() => revealExam(Number(hash[1])));
  } catch (error) {
    console.error('[exams] failed to load data:', error);
    showError();
  }
}

boot();
