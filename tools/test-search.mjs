#!/usr/bin/env node
/**
 * test-search.mjs — the search, and the dataset it searches.
 *
 *     npm test
 *
 * Two jobs:
 *   1. The dataset in assets/data/exams.json is well formed. Every one of these
 *      assertions corresponds to something the page would render wrongly.
 *   2. assets/js/search.js finds what a student would type. The cases are
 *      written as "what someone actually types" -> "what must come back",
 *      because that is the only definition of correct a search has.
 *
 * Zero dependencies. Node >= 18.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseQuery, searchExams, normalizeArabic, stemKey } from '../assets/js/search.js';
import { normalizeArabic as buildNormalize, stemKey as buildStem } from './build-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'data', 'exams.json'), 'utf8'));
const exams = data.exams;

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

/* -------------------------------------------------------------------------- */
/* The dataset                                                                 */
/* -------------------------------------------------------------------------- */

group('dataset');

check('exams is a non-empty array', Array.isArray(exams) && exams.length > 0);
check('meta.total agrees with the array', data.meta.total === exams.length,
  `meta.total=${data.meta.total} length=${exams.length}`);

const numbers = exams.map((e) => e.n);
check('every number is a positive integer', numbers.every((n) => Number.isInteger(n) && n > 0));
check('numbers are unique', new Set(numbers).size === numbers.length);
check('records are sorted ascending', numbers.every((n, i) => i === 0 || n > numbers[i - 1]));

check('every record has a non-empty title', exams.every((e) => typeof e.t === 'string' && e.t.trim()));
// This file is published as it stands, so the one thing it must not contain is
// a way into a form. The links moved to assets/data/unlock.json, encrypted;
// tools/test-lock.mjs checks them there and checks that they leaked nowhere.
check('no record carries a form link', exams.every((e) => e.u === undefined));
check('no record carries a short link', exams.every((e) => e.s === undefined));
check('the dataset declares itself locked', data.meta.locked === true);

check(
  'question counts are positive integers inside the declared range',
  exams.every(
    (e) =>
      e.q === null ||
      (Number.isInteger(e.q) && e.q >= data.meta.questionsMin && e.q <= data.meta.questionsMax),
  ),
);
check(
  'totalQuestions is the sum of the records',
  data.meta.totalQuestions === exams.reduce((sum, e) => sum + (e.q || 0), 0),
);

/* The access code in the source export must never reach the published site. */
const published = [
  'index.html',
  'teacher.html',
  'about.html',
  '404.html',
  'llms.txt',
  'assets/data/exams.json',
].map((f) => ({ f, body: fs.readFileSync(path.join(ROOT, f), 'utf8') }));

/* forms.json holds the links in the clear, so it is gitignored and absent from
   a fresh checkout (CI). The check runs wherever the file exists — i.e. on the
   machine that builds and commits the published files. */
const sourceFile = path.join(ROOT, 'data', 'source', 'forms.json');
const source = fs.existsSync(sourceFile) ? JSON.parse(fs.readFileSync(sourceFile, 'utf8')) : null;
if (!source) console.log('  (data/source/forms.json is not here: skipped the access-code check)');
const code = String(source?.['كلمة_المرور'] ?? '').trim();
if (code) {
  for (const { f, body } of published) {
    // A bare 4-digit code could occur by chance in a URL id, so only flag it
    // when it stands alone as a word.
    const bare = new RegExp(`(^|[^0-9A-Za-z_-])${code}([^0-9A-Za-z_-]|$)`);
    check(`the access code never appears in ${f}`, !bare.test(body));
  }
}

/* -------------------------------------------------------------------------- */
/* The section map                                                             */
/* -------------------------------------------------------------------------- */

group('section map (old numbering -> new)');

const mapped = exams.filter((e) => Number.isInteger(e.o) && e.o > 0);
check('at least one section carries an old number', mapped.length > 0);
check(
  'meta.sectionMap.mapped agrees with the records',
  data.meta.sectionMap.mapped === mapped.length,
);
check(
  'no old number is claimed by two sections',
  new Set(mapped.map((e) => e.o)).size === mapped.length,
  'a duplicate would make the converter answer with whichever section it hit first',
);
check(
  'o is only ever a non-negative integer',
  exams.every((e) => e.o === undefined || (Number.isInteger(e.o) && e.o >= 0)),
);
check(
  'meta.sectionMap.brandNew counts the records marked 0',
  data.meta.sectionMap.brandNew === exams.filter((e) => e.o === 0).length,
);
check(
  'mapped + brandNew + uncovered === total',
  data.meta.sectionMap.mapped + data.meta.sectionMap.brandNew + data.meta.sectionMap.uncovered ===
    exams.length,
);

/* -------------------------------------------------------------------------- */
/* Normalisation parity with the build                                         */
/* -------------------------------------------------------------------------- */

group('normalisation parity (client vs build)');

const PARITY_SAMPLES = [
  'الزلازل والسكري',
  'الاحتكاك والنجاح',
  'إكمال الجُمل',
  'المفردة الشاذّة',
  'التناظر اللفظي',
  'الأنــــدلس',
  'نوبة الهلع',
  'مَكتَبةُ الإسكندريّة',
  '٤٧',
  'ABC 123',
];

for (const sample of PARITY_SAMPLES) {
  check(
    `normalizeArabic matches the build for "${sample}"`,
    normalizeArabic(sample) === buildNormalize(sample),
    `client="${normalizeArabic(sample)}" build="${buildNormalize(sample)}"`,
  );
  check(
    `stemKey matches the build for "${sample}"`,
    stemKey(normalizeArabic(sample)) === buildStem(buildNormalize(sample)),
  );
}

check(
  'every stored key k equals normalizeArabic(t)',
  exams.every((e) => e.k === normalizeArabic(e.t)),
  'a drift here means the pre-built index no longer matches what the client computes',
);
check('every stored stem g equals stemKey(k)', exams.every((e) => e.g === stemKey(e.k)));

/* -------------------------------------------------------------------------- */
/* Searching                                                                   */
/* -------------------------------------------------------------------------- */

group('search');

const find = (q) => searchExams(exams, parseQuery(q));
const titleOf = (n) => exams.find((e) => e.n === n)?.t;

function firstIs(query, expectedNumber, why) {
  const { results } = find(query);
  check(
    `"${query}" -> section ${expectedNumber} (${titleOf(expectedNumber)})`,
    results[0]?.n === expectedNumber,
    why || `got ${results[0] ? `${results[0].n} — ${results[0].t}` : 'nothing'}`,
  );
}

function finds(query, predicate, label) {
  const { results } = find(query);
  check(`"${query}" ${label}`, results.some(predicate), `${results.length} result(s)`);
}

// An empty query is the whole list, in order.
const all = find('');
check('an empty query returns everything', all.results.length === exams.length);

// A number addresses a section directly.
firstIs('1', 1);
firstIs('47', 47);
firstIs('٤٧', 47, 'Arabic-Indic digits must fold to Latin');
firstIs(' 47 ', 47, 'surrounding whitespace must not matter');

// The old numbering is a first-class way in.
const withOld = mapped.find((e) => e.o !== e.n && !exams.some((x) => x.n === e.o));
if (withOld) {
  const { results, via } = find(String(withOld.o));
  check(
    `"${withOld.o}" (an old number) finds section ${withOld.n}`,
    results.some((r) => r.n === withOld.n),
  );
  check(
    `the old-number hit is labelled via "o"`,
    via instanceof Map && via.get(withOld.n) === 'o',
  );
}

// A number that is BOTH a current number and some section's old number must
// rank the current section first: that is what the student most likely meant.
const both = mapped.find((e) => exams.some((x) => x.n === e.o) && e.o !== e.n);
if (both) {
  const { results, via } = find(String(both.o));
  check(
    `"${both.o}" ranks the CURRENT section ${both.o} above the old-numbering match`,
    results[0]?.n === both.o,
    `got ${results[0]?.n}`,
  );
  check(`the old-numbering match is still returned`, results.some((r) => r.n === both.n));
  check(`and is labelled via "o"`, via?.get(both.n) === 'o');
}

// Arabic folding.
finds('زلازل', (e) => e.t.includes('الزلازل'), 'finds a title carrying ال');
finds('الزلازل', (e) => e.t.includes('الزلازل'), 'finds the definite form');
finds('الاحتكاك', (e) => e.t.includes('الاحتكاك'), 'matches plain text');
finds('التنميه', (e) => e.t.includes('التنمية'), 'folds ة to ه');
finds('الأندلسي', (e) => e.t.includes('الأندلسي'), 'folds the hamza forms');

// Typo tolerance, but only as a fallback.
const strict = find('الزلازل');
check('a strict hit is not marked fuzzy', strict.fuzzy === false);
const fuzzy = find('الزلزل');
check('a one-character typo still finds something', fuzzy.results.length > 0);
check('and the result is marked fuzzy', fuzzy.fuzzy === true);

// Nonsense finds nothing rather than everything.
const nonsense = find('قثقثقثقثقث');
check('gibberish returns no results', nonsense.results.length === 0);

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
