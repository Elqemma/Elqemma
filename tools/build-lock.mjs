#!/usr/bin/env node
/**
 * build-lock.mjs — seal the form links behind a password.
 *
 * Reads the secret link file that build-data.mjs leaves behind and writes
 * assets/data/unlock.json, which is the only place on this site where the 301
 * Google Forms links exist. They are encrypted there, so the file is safe to
 * commit and safe to publish; without the password it is 36 KB of noise.
 *
 *   node tools/build-lock.mjs --student "<pw>" --admin "<pw>"   write it
 *   node tools/build-lock.mjs --verify                          check it
 *   node tools/build-lock.mjs                                   same as --verify
 *
 * Passwords may also arrive as QIMMA_STUDENT_PW / QIMMA_ADMIN_PW, which keeps
 * them out of the shell history. --verify uses QIMMA_STUDENT_PW when it is set
 * and checks the seal really opens; without it the check is structural.
 *
 * Day to day the teacher never runs this. He opens lock-admin.html, types his
 * own password and gets a new file — the same file, written by the same code
 * in assets/js/lock-crypto.js. This tool is for the first build and for CI.
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
  validateLockFile,
} from '../assets/js/lock-crypto.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LINKS_FILE = path.join(ROOT, 'data', 'source', 'links.generated.json');
const EXAMS_FILE = path.join(ROOT, 'assets', 'data', 'exams.json');
const OUT_FILE = path.join(ROOT, 'assets', 'data', 'unlock.json');
const EOL = '\n';

const args = process.argv.slice(2);

function flag(name) {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? null : args[at + 1] ?? '';
}

function die(message, hint) {
  console.error(`\n  ✗ ${message}`);
  if (hint) console.error(`    ${hint}`);
  console.error('');
  process.exit(1);
}

function readJson(file, what) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    die(`could not read ${what}: ${path.relative(ROOT, file)}`, error.message);
  }
}

/* -------------------------------------------------------------------------- */
/* Weak passwords                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The ciphertext is public, so a guessable password is a published one. These
 * are warnings rather than refusals: it is the teacher's site and his call, but
 * he should be told before the file is written, not after a student finds out.
 */
function weaknesses(password, label) {
  const out = [];
  const pw = normalizePassword(password);
  if (pw.length < 6) out.push(`${label}: only ${pw.length} characters — 8 or more is much harder to guess`);
  if (/^\d+$/.test(pw) && pw.length < 9) {
    out.push(`${label}: digits only, so there are just ${10 ** pw.length} possibilities to try`);
  }
  // The teacher's phone number is printed on every page of this site.
  if (pw && '0507008364'.includes(pw)) {
    out.push(`${label}: this is part of the phone number published on every page — the first thing anyone would try`);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Verify                                                                      */
/* -------------------------------------------------------------------------- */

async function verify() {
  if (!fs.existsSync(OUT_FILE)) {
    die(
      'there is no lock file yet: assets/data/unlock.json',
      'create one with: node tools/build-lock.mjs --student "<pw>" --admin "<pw>"',
    );
  }
  const file = readJson(OUT_FILE, 'the lock file');
  const problems = validateLockFile(file);
  if (problems.length) die(`the lock file is not usable:${EOL}    - ${problems.join(`${EOL}    - `)}`);

  const exams = readJson(EXAMS_FILE, 'the dataset');
  const sections = Array.isArray(exams?.exams) ? exams.exams.length : 0;

  if (file.count !== sections) {
    die(
      `the lock covers ${file.count} sections but the dataset has ${sections}`,
      'the dataset was rebuilt without resealing — run build:lock again',
    );
  }
  for (const exam of exams.exams || []) {
    if (exam.u || exam.s) {
      die(
        `section ${exam.n} still carries a plain link in assets/data/exams.json`,
        'that file is public — rebuild with npm run build:data',
      );
    }
  }

  console.log(`lock        : version ${file.v}, ${file.count} sections, ${file.kdf.iterations} iterations`);
  console.log(`            : sealed ${file.updated}`);

  const student = process.env.QIMMA_STUDENT_PW;
  if (student) {
    const links = await openLinks(file, student);
    if (links.size !== file.count) die(`the seal opened but yielded ${links.size} links, not ${file.count}`);
    console.log(`            : QIMMA_STUDENT_PW opens it — ${links.size} links recovered`);
  } else {
    console.log('            : (set QIMMA_STUDENT_PW to also check the seal opens)');
  }

  const admin = process.env.QIMMA_ADMIN_PW;
  if (admin) {
    const ring = await openKeyring(file, admin);
    if (student && normalizePassword(student) !== ring.student) {
      die('the keyring holds a different student password than QIMMA_STUDENT_PW');
    }
    console.log('            : QIMMA_ADMIN_PW opens the keyring');
  }
}

/* -------------------------------------------------------------------------- */
/* Write                                                                       */
/* -------------------------------------------------------------------------- */

async function write(studentPassword, adminPassword) {
  if (!fs.existsSync(LINKS_FILE)) {
    die(
      'there are no links to seal: data/source/links.generated.json',
      'run `npm run build:data` first (it needs data/source/forms.json, which is not in git)',
    );
  }
  const source = readJson(LINKS_FILE, 'the link file');
  const rows = Array.isArray(source?.links) ? source.links : [];
  if (!rows.length) die('the link file holds no links');

  const iterations = Number(flag('iterations')) || DEFAULT_ITERATIONS;

  const warnings = [
    ...weaknesses(studentPassword, 'the student password'),
    ...weaknesses(adminPassword, 'the admin password'),
  ];

  const file = await buildLockFile({
    links: rows,
    studentPassword,
    adminPassword,
    iterations,
  });

  // Prove it opens before it replaces anything. A lock file that cannot be
  // unlocked would take the whole site down with it.
  const back = await openLinks(file, studentPassword);
  if (back.size !== rows.length) {
    die(`sealed ${rows.length} links but only ${back.size} came back out`);
  }
  const ring = await openKeyring(file, adminPassword);
  if (ring.student !== normalizePassword(studentPassword)) {
    die('the keyring did not round-trip the student password');
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(file) + EOL, 'utf8');

  console.log(`lock        : ${rows.length} links sealed into assets/data/unlock.json`);
  console.log(`            : version ${file.v}, ${iterations} PBKDF2 iterations`);
  console.log('            : verified — the seal opens with the student password');
  for (const warning of warnings) console.log(`            ! ${warning}`);
  console.log('');
  console.log('  Publish it by committing assets/data/unlock.json. Every student');
  console.log('  is locked out until they enter the new password.');
}

/* -------------------------------------------------------------------------- */

const studentFlag = flag('student');
const adminFlag = flag('admin');
const studentPassword = studentFlag ?? process.env.QIMMA_STUDENT_PW ?? null;
const adminPassword = adminFlag ?? process.env.QIMMA_ADMIN_PW ?? null;

// Asking to write has to be explicit. The environment variables exist so that
// --verify can open the seal in CI, and a stray one must never be enough to
// re-seal the site's links by accident.
const wants = args.includes('--write') || studentFlag !== null || adminFlag !== null;

try {
  if (args.includes('--verify') || !wants) {
    await verify();
  } else if (!studentPassword || !adminPassword) {
    die(
      'both passwords are needed to write a lock file',
      'node tools/build-lock.mjs --student "<pw>" --admin "<pw>"',
    );
  } else {
    await write(studentPassword, adminPassword);
  }
} catch (error) {
  die(error.message);
}
