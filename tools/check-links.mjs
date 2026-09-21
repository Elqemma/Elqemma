#!/usr/bin/env node
/**
 * Dataset and link checker.
 *
 *   node tools/check-links.mjs --offline        shape only (CI runs this)
 *   node tools/check-links.mjs                  also probes every form URL
 *   node tools/check-links.mjs --limit 25       probe only the first N (quick sample)
 *
 * The network pass is deliberately NOT part of `npm run verify` or CI: 301
 * outbound requests to Google Forms is slow and rate-limited, and a throttled
 * response would fail a build for a reason unrelated to the commit. Run it by
 * hand after regenerating the dataset.
 *
 * The offline pass is the stricter half. Every field the site reads is checked
 * against the record contract, because a malformed record does not crash the
 * page — it renders a card that goes nowhere, and nobody notices until a
 * student taps it.
 *
 * THE LINKS ARE NOT IN THE DATASET. They are sealed in assets/data/unlock.json,
 * so this tool can only look at them when it is given the password:
 *
 *   QIMMA_STUDENT_PW='…' node tools/check-links.mjs
 *
 * Without it, the sealed file is still checked for shape and coverage — that
 * every section in the dataset has something sealed for it — and the per-URL
 * checks say plainly that they were skipped rather than passing on silence.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openLinks, validateLockFile } from '../assets/js/lock-crypto.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'assets/data/exams.json');
const LOCK = path.join(ROOT, 'assets/data/unlock.json');
const CONCURRENCY = 8;

const args = process.argv.slice(2);
const offline = args.includes('--offline');
const limitFlag = args.indexOf('--limit');

let limit = Infinity;
if (limitFlag !== -1) {
  limit = Number(args[limitFlag + 1]);
  if (!Number.isInteger(limit) || limit < 1) {
    console.error('--limit needs a positive whole number, e.g. --limit 25');
    process.exit(1);
  }
}

let raw;
try {
  raw = JSON.parse(fs.readFileSync(DATA, 'utf8'));
} catch (error) {
  console.error(`cannot read assets/data/exams.json — ${error.message}`);
  process.exit(1);
}

const meta = raw.meta ?? {};
const exams = raw.exams;

if (!Array.isArray(exams) || exams.length === 0) {
  console.error('assets/data/exams.json carries no exams[]');
  process.exit(1);
}

/* ---------------------------------- structure ---------------------------- */

console.log(`checking ${exams.length} records\n`);

const problems = [];
const fail = (message) => problems.push(message);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isCount = (value) => Number.isInteger(value) && value >= 0;

const urls = new Set();
const shortUrls = new Set();
const oldNumbers = new Map();
const flaggedPriority = [];
const sectionMap = { mapped: 0, brandNew: 0, uncovered: 0 };
let previousNumber = 0;
let totalQuestions = 0;
let questionsMin = Infinity;
let questionsMax = -Infinity;

for (const [index, exam] of exams.entries()) {
  const label = Number.isInteger(exam?.n) ? `#${exam.n}` : `record ${index + 1}`;

  if (!Number.isInteger(exam?.n) || exam.n < 1) {
    fail(`${label} has no valid section number`);
  } else {
    // The page trusts file order for previous/next navigation and for the
    // numeric jump in search, so ascending order is part of the contract —
    // and it doubles as the uniqueness check.
    if (exam.n <= previousNumber) fail(`${label} breaks the ascending order (follows #${previousNumber})`);
    previousNumber = exam.n;
  }

  if (!isText(exam?.t)) fail(`${label} has no topic title`);
  if (!isText(exam?.k)) fail(`${label} has no search key (k)`);
  if (!isText(exam?.g)) fail(`${label} has no stem key (g)`);

  if (!Number.isInteger(exam?.q) || exam.q < 1) {
    fail(`${label} has no question count`);
  } else {
    totalQuestions += exam.q;
    questionsMin = Math.min(questionsMin, exam.q);
    questionsMax = Math.max(questionsMax, exam.q);
  }

  // assets/data/exams.json is published as it stands. A link on a record here
  // would be a link on the open internet, which is the one thing the lock
  // exists to prevent — so its presence is the failure, not its absence.
  if (exam?.u !== undefined) fail(`${label} carries a plain form URL — rebuild with npm run build:data`);
  if (exam?.s !== undefined) fail(`${label} carries a plain short link — rebuild with npm run build:data`);

  // `o` is tri-state: a positive old number, 0 for a section the source table
  // marks as brand new, and absent for sections that table never covered. The
  // converter says something different in each case, so a value outside those
  // three states would silently mislabel a section.
  if (exam?.o === undefined) {
    sectionMap.uncovered += 1;
  } else if (!isCount(exam.o)) {
    fail(`${label} has an invalid old number: ${JSON.stringify(exam.o)}`);
  } else if (exam.o === 0) {
    sectionMap.brandNew += 1;
  } else {
    sectionMap.mapped += 1;
    const owner = oldNumbers.get(exam.o);
    if (owner !== undefined) fail(`${label} claims old number ${exam.o}, already taken by #${owner}`);
    else oldNumbers.set(exam.o, exam.n);
  }

  if (exam?.p !== undefined) {
    if (exam.p !== 1) fail(`${label} has an invalid priority flag: ${JSON.stringify(exam.p)}`);
    else flaggedPriority.push(exam.n);
  }
}

/* meta must describe these records and not a previous build of them: every
 * headline figure on the site is read straight out of meta, so a stale number
 * here is a number a visitor reads. */
const agrees = (key, actual) => {
  if (meta[key] !== actual) fail(`meta.${key} says ${JSON.stringify(meta[key])}, the records say ${actual}`);
};

for (const key of ['brand', 'slogan', 'teacher', 'generated']) {
  if (!isText(meta[key])) fail(`meta.${key} is missing`);
}
agrees('total', exams.length);
agrees('totalQuestions', totalQuestions);
agrees('questionsMin', questionsMin);
agrees('questionsMax', questionsMax);

const declaredMap = meta.sectionMap ?? {};
for (const key of ['mapped', 'brandNew', 'uncovered']) {
  if (declaredMap[key] !== sectionMap[key]) {
    fail(`meta.sectionMap.${key} says ${JSON.stringify(declaredMap[key])}, the records say ${sectionMap[key]}`);
  }
}

// The shortlist is optional, but when it exists the two halves must agree: the
// page renders its blurb from meta and filters the cards by the p flags.
const priority = meta.priority ?? null;
if (priority === null) {
  if (flaggedPriority.length) fail(`${flaggedPriority.length} record(s) carry p=1 while meta.priority is null`);
} else if (!Array.isArray(priority.sections)) {
  fail('meta.priority exists but carries no sections[]');
} else {
  const listed = new Set(priority.sections);
  const known = new Set(exams.map((exam) => exam.n));
  const flagged = new Set(flaggedPriority);
  if (!isText(priority.label)) fail('meta.priority.label is missing');
  if (priority.count !== priority.sections.length) {
    fail(`meta.priority.count says ${priority.count}, sections[] holds ${priority.sections.length}`);
  }
  for (const n of listed) {
    if (!known.has(n)) fail(`meta.priority lists #${n}, which is not in the dataset`);
    else if (!flagged.has(n)) fail(`#${n} is on the shortlist but carries no p=1`);
  }
  for (const n of flagged) {
    if (!listed.has(n)) fail(`#${n} carries p=1 but is missing from meta.priority.sections`);
  }
}

/* ------------------------------------ lock -------------------------------- */

let links = null;
let lockNote = '';

try {
  const lockFile = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
  const lockProblems = validateLockFile(lockFile);
  for (const problem of lockProblems) fail(`the lock file: ${problem}`);

  if (!lockProblems.length) {
    if (lockFile.count !== exams.length) {
      fail(`the lock seals ${lockFile.count} sections but the dataset holds ${exams.length}`);
    }

    const password = process.env.QIMMA_STUDENT_PW;
    if (password) {
      links = await openLinks(lockFile, password);

      for (const exam of exams) {
        const link = links.get(exam.n);
        if (!link) {
          fail(`#${exam.n} has nothing sealed for it`);
          continue;
        }
        let parsed = null;
        try {
          parsed = new URL(link.u);
        } catch {
          fail(`#${exam.n} has an unparseable URL: ${link.u}`);
        }
        if (parsed) {
          if (parsed.protocol !== 'https:') fail(`#${exam.n} is not https: ${link.u}`);
          if (!parsed.host.endsWith('google.com') || !parsed.pathname.endsWith('/viewform')) {
            fail(`#${exam.n} is not a Google Forms viewform URL: ${link.u}`);
          }
          if (urls.has(link.u)) fail(`#${exam.n} duplicates an earlier form URL`);
          urls.add(link.u);
        }
        if (link.s && link.s !== link.u) {
          if (shortUrls.has(link.s)) fail(`#${exam.n} duplicates an earlier short link`);
          shortUrls.add(link.s);
        }
      }

      const sections = new Set(exams.map((exam) => exam.n));
      for (const n of links.keys()) {
        if (!sections.has(n)) fail(`the lock seals #${n}, which is not in the dataset`);
      }
      lockNote = `every one of ${links.size} sealed links is a unique https Google Forms URL`;
    } else {
      lockNote = `${lockFile.count} links sealed, version ${lockFile.v} — set QIMMA_STUDENT_PW to check them one by one`;
    }
  }
} catch (error) {
  fail(
    error?.name === 'WrongPassword'
      ? 'QIMMA_STUDENT_PW does not open the lock file'
      : `the lock file could not be read: ${error.message}`,
  );
}

if (problems.length) {
  console.log('structural problems:');
  problems.forEach((message) => console.log(`  ! ${message}`));
} else {
  console.log(`structure: ${exams.length} records, ${totalQuestions} questions (${questionsMin}-${questionsMax} each)`);
  console.log('           no record carries a link — they are sealed, not listed');
  console.log(`           lock: ${lockNote}`);
  console.log(`           sections: ${sectionMap.mapped} mapped, ${sectionMap.brandNew} new, ${sectionMap.uncovered} uncovered`);
  console.log('           meta agrees with the records');
}

if (offline) {
  console.log('\n(--offline: skipped the network pass)');
  process.exit(problems.length ? 1 : 0);
}

/* ---------------------------------- network ------------------------------ */

if (!links) {
  console.error(
    '\ncannot probe anything: the URLs are sealed.\n' +
      "  QIMMA_STUDENT_PW='<the student password>' node tools/check-links.mjs",
  );
  process.exit(1);
}

const targets = exams
  .slice(0, Number.isFinite(limit) ? limit : exams.length)
  .map((exam) => ({ ...exam, u: links.get(exam.n)?.u }))
  .filter((exam) => exam.u);
console.log(`\nprobing ${targets.length} URLs (concurrency ${CONCURRENCY})...\n`);

const failures = [];
let done = 0;

async function probe(exam) {
  try {
    const response = await fetch(exam.u, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (link-check)' },
      signal: AbortSignal.timeout(20000),
    });
    // A retired Google Form still answers 200 and says so in the body, so the
    // status code on its own would wave a dead form through.
    if (!response.ok) {
      failures.push(`#${exam.n} HTTP ${response.status} — ${exam.t}`);
    } else {
      const body = await response.text();
      if (/الاستمارة غير موجودة|Form not found|قد تم إغلاق|no longer accepting/i.test(body)) {
        failures.push(`#${exam.n} form appears closed or missing — ${exam.t}`);
      }
    }
  } catch (error) {
    failures.push(`#${exam.n} request failed (${error.name}) — ${exam.t}`);
  }
  done += 1;
  if (done % 25 === 0 || done === targets.length) {
    process.stdout.write(`  ${done}/${targets.length}\n`);
  }
}

const queue = targets.slice();
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) await probe(queue.shift());
  }),
);

console.log('');
if (failures.length) {
  console.log(`${failures.length} link problem(s):`);
  failures.forEach((message) => console.log(`  ! ${message}`));
} else {
  console.log('network: every probed form responded successfully');
}

process.exit(problems.length || failures.length ? 1 : 0);
