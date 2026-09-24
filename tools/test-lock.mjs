#!/usr/bin/env node
/**
 * test-lock.mjs — the lock holds, and nothing leaked past it.
 *
 *     npm test
 *
 * Two jobs, and the second matters more than the first.
 *
 * The first is that the crypto behaves: the right password opens the links, a
 * wrong one cannot, the keyring hands the admin the current student password,
 * and a password typed on an Arabic keyboard opens a file written from a Latin
 * one. Those are ordinary round-trip tests.
 *
 * The second is that no plain form link survives anywhere a visitor can reach.
 * Encryption that is applied to a copy is not encryption, and this is exactly
 * the mistake that would be invisible in a browser: the site would look locked
 * and work perfectly while assets/data/exams.json — or llms.txt, or a leftover
 * build report — quietly listed all 301 URLs. So every file that gets published
 * is read and searched, and the search is for the shape of a Google Forms link
 * rather than for any particular one.
 *
 * Zero dependencies. Node >= 18.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_ITERATIONS,
  buildLockFile,
  normalizePassword,
  openKeyring,
  openLinks,
  packLinks,
  unpackLinks,
  validateLockFile,
} from '../assets/js/lock-crypto.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

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

group('the shape of a lock file');

const lockFile = JSON.parse(read('assets/data/unlock.json'));
const problems = validateLockFile(lockFile);
check('assets/data/unlock.json is a valid lock file', problems.length === 0, problems.join('; '));
check('it uses at least 600,000 PBKDF2 iterations', lockFile.kdf.iterations >= 600000, String(lockFile.kdf.iterations));
check('it carries a version', typeof lockFile.v === 'string' && lockFile.v.length >= 8);
check('the links and the keyring use different salts', lockFile.links.salt !== lockFile.keyring.salt);
check('and different IVs', lockFile.links.iv !== lockFile.keyring.iv);

const exams = JSON.parse(read('assets/data/exams.json'));
check('the lock covers every section in the dataset', lockFile.count === exams.exams.length,
  `lock ${lockFile.count} vs dataset ${exams.exams.length}`);
check('the dataset says it is locked', exams.meta.locked === true);

/* -------------------------------------------------------------------------- */

group('nothing published carries a link in the clear');

// The shape of a Google Forms link, not any particular one: a test that hunted
// for today's URLs would pass the day they were regenerated.
//
// An ID is required after the prefix, because the bare prefix is not a link —
// assets/js/lock-crypto.js holds it as the constant it strips off 301 URLs so
// it does not store them 301 times. `1FAIpQL` opens every Google Forms ID.
const FORM_SHAPE =
  /docs\.google\.com\/forms\/d\/e\/[A-Za-z0-9_-]{8,}|forms\.gle\/[A-Za-z0-9]{5,}|1FAIpQL[A-Za-z0-9_-]{6,}/;

// A leak test that matches nothing passes forever and protects nothing, so the
// pattern is checked against a real link and against the thing it must ignore.
check(
  'the leak pattern catches a long form URL',
  FORM_SHAPE.test('https://docs.google.com/forms/d/e/1FAIpQLScyCObh-E8TBqtr6JoxJ-FZ9Hq/viewform'),
);
check('the leak pattern catches a short link', FORM_SHAPE.test('https://forms.gle/FX6ZPBGgDFd9qnV27'));
check('the leak pattern catches a bare form ID', FORM_SHAPE.test('1FAIpQLSf8SNetAzZMSr'));
check('the leak pattern ignores the bare prefix', !FORM_SHAPE.test('https://docs.google.com/forms/d/e/'));

// Everything GitHub Pages serves. tools/ is excluded because it is developer
// code that names the pattern in order to check it, and data/source/ because
// it is gitignored — the two files in it are the plain originals and never ship.
const PUBLISHED = [
  'index.html',
  'about.html',
  'teacher.html',
  '404.html',
  'lock-admin.html',
  'llms.txt',
  'sitemap.xml',
  'robots.txt',
  'site.webmanifest',
  'assets/data/exams.json',
  'assets/data/unlock.json',
  'assets/data/features.json',
  'assets/data/shortlist.json',
  'assets/js/app.js',
  'assets/js/shortlist.js',
  'assets/js/lock.js',
  'assets/js/lock-crypto.js',
  'assets/js/lock-admin.js',
  'assets/js/search.js',
  'assets/js/store.js',
  'assets/js/ui.js',
  'data/build-report.json',
];

for (const file of PUBLISHED) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    check(`${file} exists`, false);
    continue;
  }
  const body = read(file);
  const hit = FORM_SHAPE.exec(body);
  check(
    `${file} contains no form link`,
    !hit,
    hit ? `found "${hit[0]}" at offset ${hit.index}` : '',
  );
}

for (const exam of exams.exams) {
  if (exam.u !== undefined || exam.s !== undefined) {
    check(`section ${exam.n} carries no link field`, false, JSON.stringify(exam));
  }
}
check('no section in the dataset carries a link field', true);

// The plain sources must be ignored by git, or the whole exercise is theatre.
const gitignore = read('.gitignore');
check('data/source/forms.json is gitignored', gitignore.includes('data/source/forms.json'));
check('data/source/links.generated.json is gitignored', gitignore.includes('data/source/links.generated.json'));

/* -------------------------------------------------------------------------- */

group('sealing and opening');

const LINKS = [
  { n: 1, u: 'https://docs.google.com/forms/d/e/AAA111/viewform', s: 'https://forms.gle/aaa' },
  { n: 2, u: 'https://docs.google.com/forms/d/e/BBB222/viewform', s: null },
  { n: 301, u: 'https://example.org/somewhere/else', s: null },
];

const STUDENT = 'قمة-2026';
const ADMIN = 'MNPQ47XK';

// 600,000 iterations twelve times over would make `npm test` crawl; the number
// under test is the one in the published file, checked above.
const FAST = 120000;

const sealed = await buildLockFile({
  links: LINKS,
  studentPassword: STUDENT,
  adminPassword: ADMIN,
  iterations: FAST,
});

check('a freshly sealed file validates', validateLockFile(sealed).length === 0);
check('it counts what went in', sealed.count === LINKS.length);

const opened = await openLinks(sealed, STUDENT);
check('the student password opens the links', opened.size === LINKS.length);
check('a normal Google Forms URL survives the round trip', opened.get(1).u === LINKS[0].u);
check('so does its short link', opened.get(1).s === LINKS[0].s);
check('a section with no short link falls back to the long one', opened.get(2).s === LINKS[1].u);
check('a URL of some other shape is kept whole', opened.get(301).u === LINKS[2].u);

let refused = false;
try {
  await openLinks(sealed, 'قمة-2027');
} catch (error) {
  refused = error?.name === 'WrongPassword';
}
check('a wrong password is refused, by name', refused);

let adminRefused = false;
try {
  await openLinks(sealed, ADMIN);
} catch (error) {
  adminRefused = error?.name === 'WrongPassword';
}
check('the admin password does not open the links directly', adminRefused);

const ring = await openKeyring(sealed, ADMIN);
check('the keyring opens with the admin password', ring.student === normalizePassword(STUDENT));

let ringRefused = false;
try {
  await openKeyring(sealed, STUDENT);
} catch (error) {
  ringRefused = error?.name === 'WrongPassword';
}
check('the student password does not open the keyring', ringRefused);

/* -------------------------------------------------------------------------- */

group('one publish is never mistakable for another');

const again = await buildLockFile({
  links: LINKS,
  studentPassword: STUDENT,
  adminPassword: ADMIN,
  iterations: FAST,
});

check('re-sealing changes the version', again.v !== sealed.v);
check('re-sealing changes the salt', again.links.salt !== sealed.links.salt);
// Same links, same password, different bytes: nobody reading two published
// versions can tell whether the teacher actually changed anything.
check('re-sealing the same links produces different ciphertext', again.links.ct !== sealed.links.ct);

/* -------------------------------------------------------------------------- */

group('a password typed by a real person');

check('Arabic-Indic digits fold to Latin', normalizePassword('٧٠٠٨٣٦٤') === '7008364');
check('Extended Arabic-Indic digits fold too', normalizePassword('۷۰۰۸۳۶۴') === '7008364');
check('surrounding spaces are dropped', normalizePassword('  2030  ') === '2030');
check('bidi marks pasted from a chat app are dropped', normalizePassword('\u200f2030\u200e') === '2030');
check('a zero-width space is dropped', normalizePassword('20\u200b30') === '2030');
check('case is preserved', normalizePassword('AbC') === 'AbC');

const arabicTyped = await buildLockFile({
  links: LINKS,
  studentPassword: '٢٠٣٠',
  adminPassword: ADMIN,
  iterations: FAST,
});
const byLatin = await openLinks(arabicTyped, '2030');
check('a file sealed with Arabic digits opens with Latin ones', byLatin.size === LINKS.length);

/* -------------------------------------------------------------------------- */

group('what the builder refuses');

async function refuses(what, options) {
  try {
    await buildLockFile({ iterations: FAST, ...options });
    check(what, false, 'it was allowed');
  } catch {
    check(what, true);
  }
}

await refuses('an empty student password', { links: LINKS, studentPassword: '', adminPassword: ADMIN });
await refuses('an empty admin password', { links: LINKS, studentPassword: STUDENT, adminPassword: '' });
await refuses('one password for both roles', { links: LINKS, studentPassword: ADMIN, adminPassword: ADMIN });
await refuses('nothing to lock', { links: [], studentPassword: STUDENT, adminPassword: ADMIN });
await refuses('a password that is only bidi marks', {
  links: LINKS,
  studentPassword: '‏‎',
  adminPassword: ADMIN,
});

/* -------------------------------------------------------------------------- */

group('packing');

const packed = packLinks(LINKS);
check('the shared prefix is not stored 301 times', packed[1][0] === 'AAA111');
check('the short link keeps only its code', packed[1][1] === 'aaa');
check('a foreign URL is stored whole', packed[301][0] === LINKS[2].u);
check('unpacking is the inverse', unpackLinks(packed).get(1).u === LINKS[0].u);
check('a record with no usable URL is dropped', Object.keys(packLinks([{ n: 5 }])).length === 0);
check('a record with no number is dropped', Object.keys(packLinks([{ u: LINKS[0].u }])).length === 0);

check('the default iteration count is at least the OWASP floor', DEFAULT_ITERATIONS >= 600000);

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
