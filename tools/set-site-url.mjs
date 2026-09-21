#!/usr/bin/env node
/**
 * set-site-url.mjs
 * ---------------------------------------------------------------------------
 * Canonical links, Open Graph images, the sitemap and llms.txt all need an
 * absolute URL, but the real one is only known at deploy time and differs
 * between a project page, a user page and a custom domain. Every such file
 * therefore ships with the literal placeholder `__SITE_URL__`, and this script
 * substitutes the real origin.
 *
 *     node tools/set-site-url.mjs https://user.github.io/repo/
 *     node tools/set-site-url.mjs --reset          put the placeholder back
 *
 * Running it twice is safe: it also recognises a URL it stamped before, so a
 * second deploy to a different address rewrites rather than doubles up. The
 * URL it stamped last is remembered in data/.site-url, and when that file is
 * missing (a fresh CI checkout) it is recovered from the sitemap, whose first
 * <loc> is the site root by construction.
 *
 * The GitHub Actions workflow calls this with the URL reported by
 * actions/configure-pages, so nothing has to be committed by hand.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLACEHOLDER = '__SITE_URL__';
const MARKER_FILE = path.join(ROOT, 'data', '.site-url');
const SITEMAP = 'sitemap.xml';
const TARGETS = [
  'index.html',
  'teacher.html',
  'about.html',
  '404.html',
  SITEMAP,
  'llms.txt',
  'site.webmanifest',
];
const ROBOTS_FILE = path.join(ROOT, 'robots.txt');

const USAGE = [
  'Usage:',
  '  node tools/set-site-url.mjs <https://example.com/base/>   stamp the real URL',
  '  node tools/set-site-url.mjs --reset                       restore __SITE_URL__',
  '',
  'The URL must end with "/" — see below.',
].join('\n');

/**
 * The trailing slash is not a style preference: the pages compose absolute
 * links as `${SITE}about.html`, so a base of ".../repo" would silently produce
 * ".../repoabout.html" in canonical tags and the sitemap — broken in a way
 * nothing on the page reveals. Refuse rather than guess.
 */
function normalizeUrl(input, { strict = true } = {}) {
  if (!input) return null;
  const raw = String(input).trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  if (strict && !raw.endsWith('/')) return null;
  // Query and fragment are meaningless for a site root, so drop them.
  const href = url.origin + url.pathname;
  return href.endsWith('/') ? href : `${href}/`;
}

/** The URL stamped by a previous run, so a re-stamp replaces instead of duplicating. */
function previousUrl() {
  try {
    const remembered = normalizeUrl(fs.readFileSync(MARKER_FILE, 'utf8').trim(), { strict: false });
    if (remembered) return remembered;
  } catch {
    /* no marker: fall through to the sitemap */
  }
  try {
    const sitemap = fs.readFileSync(path.join(ROOT, SITEMAP), 'utf8');
    const first = sitemap.match(/<loc>\s*([^<\s]+)\s*<\/loc>/)?.[1];
    if (first && !first.includes(PLACEHOLDER)) return normalizeUrl(first, { strict: false });
  } catch {
    /* no sitemap either: treat the tree as unstamped */
  }
  return null;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Apply [from, to] pairs to a file; returns how many strings changed. */
function rewrite(file, pairs) {
  const active = pairs.filter(([from, to]) => from && from !== to);
  if (!active.length) return 0;

  // One pass, longest needle first. Substituting pair by pair would let the
  // first result be matched again by the second — moving from
  // https://name.github.io/ to https://name.github.io/repo/ would otherwise
  // keep appending the segment on every run.
  const ordered = [...active].sort((a, b) => b[0].length - a[0].length);
  const replacements = new Map(ordered);
  const pattern = new RegExp(ordered.map(([from]) => escapeRegExp(from)).join('|'), 'g');

  const before = fs.readFileSync(file, 'utf8');
  let count = 0;
  const after = before.replace(pattern, (match) => {
    count += 1;
    return replacements.get(match);
  });

  if (after === before) return 0;
  fs.writeFileSync(file, after, 'utf8');
  return count;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }

  const reset = args.includes('--reset');
  const input = args.find((arg) => !arg.startsWith('-'));
  const previous = previousUrl();

  let site;
  if (reset) {
    // Resetting means rewriting the stamped URL back to the placeholder, so the
    // only thing needed is which URL was stamped.
    site = normalizeUrl(input, { strict: false }) ?? previous;
    if (!site) {
      console.log('nothing to reset: no stamped URL is recorded and the sitemap still holds the placeholder.');
      return;
    }
  } else {
    site = normalizeUrl(input);
    if (!site) {
      console.error(USAGE);
      console.error(`\nReceived: ${input ?? '(nothing)'}`);
      if (input && !String(input).trim().endsWith('/')) {
        console.error(`Did you mean: ${String(input).trim()}/`);
      }
      process.exit(1);
    }
  }

  const pairs = reset
    ? [[site, PLACEHOLDER]]
    : [
        [PLACEHOLDER, site],
        [previous && previous !== site ? previous : null, site],
      ];

  let changedFiles = 0;
  let replacements = 0;

  for (const relative of TARGETS) {
    const file = path.join(ROOT, relative);
    if (!fs.existsSync(file)) {
      console.warn(`  skip  ${relative} (missing)`);
      continue;
    }
    const count = rewrite(file, pairs);
    if (count) {
      changedFiles += 1;
      replacements += count;
      console.log(`  write ${relative} (${count} replacement${count === 1 ? '' : 's'})`);
    } else {
      console.log(`  ok    ${relative} (already current)`);
    }
  }

  // robots.txt: a Sitemap directive has to be an absolute URL, so the committed
  // file carries none and the correct line is written (or removed again) here.
  if (fs.existsSync(ROBOTS_FILE)) {
    const before = fs.readFileSync(ROBOTS_FILE, 'utf8');
    const body = before
      .split(/\r?\n/)
      .filter((line) => !/^\s*sitemap\s*:/i.test(line))
      .join('\n')
      .replace(/\n+$/, '');
    const after = reset ? `${body}\n` : `${body}\n\nSitemap: ${site}sitemap.xml\n`;
    if (after !== before) {
      fs.writeFileSync(ROBOTS_FILE, after, 'utf8');
      changedFiles += 1;
      replacements += 1;
      console.log(`  write robots.txt (Sitemap directive ${reset ? 'removed' : 'set'})`);
    } else {
      console.log('  ok    robots.txt (already current)');
    }
  }

  if (reset) {
    fs.rmSync(MARKER_FILE, { force: true });
    console.log(`\nrestored the ${PLACEHOLDER} placeholder (was ${site})`);
  } else {
    fs.mkdirSync(path.dirname(MARKER_FILE), { recursive: true });
    fs.writeFileSync(MARKER_FILE, `${site}\n`, 'utf8');
    console.log(`\nsite url: ${site}`);
  }
  console.log(`updated ${changedFiles} file(s), ${replacements} replacement(s)`);
}

main();
