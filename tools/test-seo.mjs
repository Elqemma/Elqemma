#!/usr/bin/env node
/**
 * test-seo.mjs — the site's public claims stay true and machine-readable.
 *
 *     npm test
 *
 * This is the guard rail for everything a crawler, an AI assistant or a student
 * reads before they reach the page itself: the metadata, the structured data,
 * the FAQ, the sitemap, robots.txt and llms.txt.
 *
 * It fails on the things that are easy to break by accident and expensive to
 * notice: an @id that does not resolve on its own page, a FAQ answer that has
 * drifted from the visible text, an <img> with no dimensions, a target="_blank"
 * without rel="noopener", a superlative or a guarantee nobody can support, or a
 * figure that no longer matches the dataset.
 *
 * Zero dependencies, no HTML parser: the checks are deliberately textual, so
 * this file never becomes the thing that has to be maintained.
 * Node >= 18.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(ROOT, f));

const PAGES = ['index.html', 'teacher.html', 'about.html'];
const ALL_HTML = [...PAGES, '404.html'];
const html = Object.fromEntries(ALL_HTML.map((f) => [f, read(f)]));
const data = JSON.parse(read('assets/data/exams.json'));

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

/** Every JSON-LD node on a page, flattened out of its @graph. */
function jsonLd(page) {
  const blocks = [...html[page].matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
  )];
  const nodes = [];
  for (const [, body] of blocks) {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      check(`${page}: JSON-LD parses`, false, error.message);
      continue;
    }
    nodes.push(...(parsed['@graph'] ?? [parsed]));
  }
  return nodes;
}

const ld = Object.fromEntries(PAGES.map((p) => [p, jsonLd(p)]));

/**
 * Strip everything presentational so two strings can be compared for the same
 * words: bidi controls (the markup carries an LRM before a Latin phone number,
 * the page does not), and all whitespace, because stripping an inline <a> or
 * <bdi> leaves spaces where the visible copy has none.
 */
const sameWords = (s) =>
  String(s)
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, '');

/** The plain visible text of a page, tags stripped, whitespace collapsed. */
function visibleText(page) {
  return html[page]
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* -------------------------------------------------------------------------- */
/* Head metadata                                                               */
/* -------------------------------------------------------------------------- */

group('head metadata');

for (const page of ALL_HTML) {
  const s = html[page];
  check(`${page}: lang="ar" dir="rtl"`, /<html lang="ar" dir="rtl">/.test(s));
  check(`${page}: has a viewport meta`, /name="viewport"/.test(s));
  const title = /<title>([^<]+)<\/title>/.exec(s)?.[1] ?? '';
  check(`${page}: has a title`, title.trim().length > 0);
  check(
    `${page}: the title is not longer than 65 characters`,
    title.length <= 65,
    `${title.length}: ${title}`,
  );
  const desc = /<meta\s+name="description"\s+content="([^"]*)"/.exec(s)?.[1]
    ?? /name="description"\s*\n?\s*content="([^"]*)"/.exec(s)?.[1]
    ?? '';
  if (page !== '404.html') {
    check(`${page}: has a meta description`, desc.trim().length > 0);
    check(
      `${page}: the description is 110–200 characters`,
      desc.length >= 110 && desc.length <= 200,
      `${desc.length} characters`,
    );
  }
}

for (const page of PAGES) {
  const s = html[page];
  check(`${page}: has a canonical link`, /rel="canonical"/.test(s));
  check(`${page}: canonical is absolute or the placeholder`, /rel="canonical" href="(__SITE_URL__|https:\/\/)/.test(s));
  check(`${page}: declares og:title`, /property="og:title"/.test(s));
  check(`${page}: declares og:description`, /property="og:description"/.test(s));
  check(`${page}: declares og:image with dimensions`,
    /property="og:image"/.test(s) && /og:image:width/.test(s) && /og:image:height/.test(s));
  check(`${page}: declares og:locale ar_SA`, /property="og:locale" content="ar_SA"/.test(s));
  check(`${page}: declares a twitter card`, /name="twitter:card"/.test(s));
  check(`${page}: exactly one <h1>`, (s.match(/<h1[\s>]/g) || []).length === 1,
    `${(s.match(/<h1[\s>]/g) || []).length} found`);
}

/* The OG image the pages point at must exist, and be the size they claim. */
group('the share card');
check('assets/img/og-cover.jpg exists', exists('assets/img/og-cover.jpg'));
for (const page of PAGES) {
  const src = /property="og:image" content="__SITE_URL__([^"]+)"/.exec(html[page])?.[1];
  check(`${page}: its og:image file exists`, Boolean(src) && exists(src), String(src));
}

/* -------------------------------------------------------------------------- */
/* Structured data                                                             */
/* -------------------------------------------------------------------------- */

group('structured data');

for (const page of PAGES) {
  const nodes = ld[page];
  check(`${page}: carries JSON-LD`, nodes.length > 0);

  // Every @id referenced on a page must also be DEFINED on that page. Google
  // parses one page at a time, so an unresolved @id is a blank node.
  const defined = new Set(nodes.map((n) => n['@id']).filter(Boolean));
  const referenced = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === '@id' && Object.keys(node).length === 1) referenced.add(value);
      else walk(value);
    }
  };
  walk(nodes);
  const dangling = [...referenced].filter((id) => !defined.has(id));
  check(`${page}: every referenced @id resolves on this page`, dangling.length === 0,
    dangling.join(', '));

  // Type coverage.
  const types = nodes.flatMap((n) => [].concat(n['@type'] ?? []));
  check(`${page}: declares a Person`, types.includes('Person'));
  check(`${page}: declares a WebSite`, types.includes('WebSite'));
}

check('index.html declares a CollectionPage', ld['index.html'].some((n) => n['@type'] === 'CollectionPage'));
check('teacher.html declares a ProfilePage', ld['teacher.html'].some((n) => n['@type'] === 'ProfilePage'));
check('about.html declares a WebPage', ld['about.html'].some((n) => n['@type'] === 'WebPage'));

// The Person is one entity, reused. Any stub must agree with the full record.
const persons = PAGES.map((p) => ({ p, node: ld[p].find((n) => n['@type'] === 'Person') }));
const full = persons.find(({ p }) => p === 'teacher.html').node;
check('the Person has a stable @id', typeof full['@id'] === 'string' && full['@id'].includes('#person'));
for (const { p, node } of persons) {
  check(`${p}: the Person shares the canonical @id`, node['@id'] === full['@id']);
  for (const field of ['name', 'jobTitle', 'telephone', 'url']) {
    if (node[field] === undefined) continue;
    check(
      `${p}: Person.${field} agrees with teacher.html`,
      JSON.stringify(node[field]) === JSON.stringify(full[field]),
      `${JSON.stringify(node[field])} vs ${JSON.stringify(full[field])}`,
    );
  }
}

// The one number that must never drift.
const PHONE = '+966507008364';
check('the Person carries the published phone number', full.telephone === PHONE);
for (const page of ALL_HTML) {
  const numbers = [...html[page].matchAll(/\+966\s?5[\d\s]{8,}/g)].map((m) =>
    m[0].replace(/\s/g, ''),
  );
  check(`${page}: every +966 number on the page is his`, numbers.every((n) => n === PHONE),
    [...new Set(numbers)].join(', '));
}

// Breadcrumbs on the inner pages.
for (const page of ['teacher.html', 'about.html']) {
  const crumbs = ld[page].flatMap((n) => (n.breadcrumb ? [n.breadcrumb] : []));
  check(`${page}: declares a BreadcrumbList`, crumbs.length > 0);
  check(`${page}: the breadcrumb has two levels`, crumbs[0]?.itemListElement?.length === 2);
}

/* -------------------------------------------------------------------------- */
/* FAQ markup must match what a person actually reads                          */
/* -------------------------------------------------------------------------- */

group('FAQ parity');

for (const page of ['teacher.html', 'about.html']) {
  const faq = ld[page].find((n) => n['@type'] === 'FAQPage');
  check(`${page}: declares an FAQPage`, Boolean(faq));
  if (!faq) continue;

  const text = visibleText(page);
  const headings = [...html[page].matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)].map((m) =>
    m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
  );

  check(`${page}: the FAQ has at least five questions`, faq.mainEntity.length >= 5,
    `${faq.mainEntity.length}`);

  for (const entry of faq.mainEntity) {
    check(
      `${page}: the question "${entry.name}" is on the page`,
      headings.some((h) => sameWords(h) === sameWords(entry.name)),
      'the markup must say what the page says',
    );
    // Compare the answer loosely: the visible copy carries links and <bdi>.
    const firstClause = entry.acceptedAnswer.text.split(/[.،؟]/)[0];
    check(
      `${page}: the answer to "${entry.name}" is on the page`,
      firstClause.trim().length > 0 && sameWords(text).includes(sameWords(firstClause)),
      firstClause.trim(),
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Claims we cannot support                                                    */
/* -------------------------------------------------------------------------- */

group('unsupported claims');

const BANNED = [
  [/\bالأفضل\b|\bأفضل\s+(مدرب|معلم|أستاذ|موقع)\b/, 'a superlative about him'],
  [/\bنضمن\b|\bضمان\s+(النجاح|الدرجة)|\bمضمون\b/, 'a guarantee'],
  // Only an ASSERTION counts. «هل الأستاذ معتمد من قياس؟ لا.» is the opposite
  // of a claim — it is the page refusing one — so a negation or a question mark
  // in the immediate neighbourhood clears it.
  [
    /(?<!هل\s)(?<!هل\s\S{0,40})معتمد\s+من\s+قياس(?![^.؟]{0,40}(؟|\bلا\b|ليس))|بالتعاون\s+مع\s+قياس/,
    'an endorsement by قياس',
  ],
  [/\b(نسبة|معدل)\s+نجاح\b/, 'a pass rate'],
  [/\b\d[\d,٬]*\s*(طالب|طالبة|متدرب)\b/, 'a student count'],
  [/\bريال\b|\bسعر\s+الدورة\b|\bالاشتراك\s+ب/, 'a price'],
  [/\bرقم\s*١\b|\bالأول\s+في\s+السعودية\b/, 'a ranking claim'],
];

for (const page of ALL_HTML) {
  const text = visibleText(page);
  for (const [pattern, what] of BANNED) {
    const hit = pattern.exec(text);
    check(`${page}: makes no claim of ${what}`, !hit, hit ? `found: "${hit[0]}"` : '');
  }
}
for (const [pattern, what] of BANNED) {
  const hit = pattern.exec(read('llms.txt'));
  check(`llms.txt: makes no claim of ${what}`, !hit, hit ? `found: "${hit[0]}"` : '');
}

// The قياس disclaimer must be present wherever قياس is named.
for (const page of PAGES) {
  const text = visibleText(page);
  if (!/قياس/.test(text)) continue;
  check(
    `${page}: names قياس and says he is not affiliated with it`,
    /ليس\s+تابع(ًا)?\s+ل|وليس\s+تابع(ًا)?\s+ل/.test(text),
  );
}

// The teacher asked (2026-09-24) that nothing call the forms free. This reads
// the raw files, not the visible text: a meta description, a JSON-LD flag, the
// manifest and the share card say it to more people than the page does.
const FREE = /مجّ?ان|isAccessibleForFree/;
for (const file of [...ALL_HTML, 'llms.txt', 'site.webmanifest', 'tools/og-cover.template.html']) {
  const hit = FREE.exec(read(file));
  check(`${file}: does not call the forms free`, !hit, hit ? `found: "${hit[0]}"` : '');
}

// And every page closes on his rights.
for (const page of PAGES) {
  const footer = /<footer class="site-footer">[\s\S]*?<\/footer>/.exec(html[page])?.[0] ?? '';
  check(`${page}: the footer reserves his rights`, /جميع الحقوق محفوظة/.test(footer));
}
check('llms.txt reserves his rights', /جميع الحقوق محفوظة/.test(read('llms.txt')));

// The compilation «زبدة الأقسام» is matched against is never named, anywhere:
// the deploy publishes this whole folder, so a README line or a code comment is
// as public as the page. The teacher asked (2026-09-24). The pattern avoids
// «شجرة الزيتون», which is a real section's title. This file is skipped because
// it has to spell the pattern out.
const SOURCE_NAME = /زيتونة|زيتونه|zaytoun|zaitoun|zaytun|العراب/i;
const TEXT_FILE = /\.(html|css|js|mjs|py|json|md|txt|xml|yml|yaml|webmanifest)$/;
const tracked = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') walk(rel);
    } else if (TEXT_FILE.test(entry.name) && rel !== 'tools/test-seo.mjs') {
      tracked.push(rel);
    }
  }
})('');
const naming = tracked.filter((file) => SOURCE_NAME.test(read(file)));
check('no file names the source of «زبدة الأقسام»', naming.length === 0, naming.join(', '));

// «زبدة الأقسام» itself is hidden unless the teacher switches it on from the
// console, and hidden includes what a crawler reads in the source: no page and
// no llms.txt carries a word of it, shown or not. Its copy lives in
// assets/data/shortlist.json and reaches a page only while features.json says so.
// «الأكثر تكرارًا» is its former name, and stays out too.
const SHORTLIST_WORDS = /زبد[ةه]\s+الأقسام|الأكثر\s+تكرار|تكرّر\s+ورودها|الشارة\s+الذهبية/;
if (fs.existsSync(path.join(ROOT, 'assets/data/shortlist.json'))) {
  // A rename in priority.json has to reach this guard, or the new name could
  // land in a page unnoticed.
  check('the hidden-shortlist guard knows the name the site publishes',
    SHORTLIST_WORDS.test(JSON.parse(read('assets/data/shortlist.json')).label));
}
for (const file of [...ALL_HTML, 'llms.txt']) {
  const hit = SHORTLIST_WORDS.exec(read(file));
  check(`${file}: carries no word of the hidden shortlist`, !hit, hit ? `found: "${hit[0]}"` : '');
}

// The sections are numbered once, as they are today. No page, no script and no
// llms.txt tells a student what a section used to be numbered.
const OLD_NUMBERING = /ترقيم\s+(ال)?قديم|الترقيم\s+القديم|(ال)?رقم\s+(ال)?قديم|كان\s+(ال)?قسم|(ال)?قسم\s+(ال)?قديم|محو[ّ]?ل\s+(ال)?ترقيم|الترقيمين/;
const PAGE_SCRIPTS = fs.readdirSync(path.join(ROOT, 'assets', 'js'))
  .filter((name) => name.endsWith('.js'))
  .map((name) => `assets/js/${name}`);
for (const file of [...ALL_HTML, 'llms.txt', ...PAGE_SCRIPTS]) {
  const hit = OLD_NUMBERING.exec(read(file));
  check(`${file}: never mentions an old section number`, !hit, hit ? `found: "${hit[0]}"` : '');
}

/* -------------------------------------------------------------------------- */
/* Accessibility and safety details that only show up in the markup            */
/* -------------------------------------------------------------------------- */

group('markup hygiene');

for (const page of ALL_HTML) {
  const s = html[page];

  const imgs = [...s.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  const noDims = imgs.filter((t) => !/\bwidth=/.test(t) || !/\bheight=/.test(t));
  check(`${page}: every <img> declares width and height`, noDims.length === 0,
    noDims.map((t) => t.slice(0, 90)).join('\n        '));

  const noAlt = imgs.filter((t) => !/\balt=/.test(t));
  check(`${page}: every <img> declares alt`, noAlt.length === 0,
    noAlt.map((t) => t.slice(0, 90)).join('\n        '));

  // Every <a target="_blank"> must carry rel="noopener noreferrer".
  const blanks = [...s.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)].map((m) => m[0]);
  const unsafe = blanks.filter((t) => !/rel="[^"]*noopener/.test(t) || !/rel="[^"]*noreferrer/.test(t));
  check(`${page}: every target="_blank" carries rel="noopener noreferrer"`, unsafe.length === 0,
    unsafe.map((t) => t.slice(0, 90)).join('\n        '));

  // Every icon-only control needs an accessible name. The buttons inside
  // <template> are excluded here and checked separately: their label names the
  // section the card is for, so it can only be written when the card is built.
  const outsideTemplates = s.replace(/<template[\s\S]*?<\/template>/g, ' ');
  const iconButtons = [...outsideTemplates.matchAll(
    /<button\b[^>]*class="[^"]*icon-btn[^"]*"[^>]*>/g,
  )].map((m) => m[0]);
  const unnamed = iconButtons.filter((t) => !/aria-label=/.test(t));
  check(`${page}: every icon-only button has an aria-label`, unnamed.length === 0,
    unnamed.map((t) => t.slice(0, 90)).join('\n        '));

  // A 404 has one screen and two links; there is nothing to skip past.
  if (page !== '404.html') check(`${page}: has a skip link`, /class="skip-link"/.test(s));

  // Every <use href="#i-…"> must resolve to a symbol on the same page.
  const symbols = new Set([...s.matchAll(/<symbol id="(i-[a-z]+)"/g)].map((m) => m[1]));
  const used = new Set([...s.matchAll(/href="#(i-[a-z]+)"/g)].map((m) => m[1]));
  const missing = [...used].filter((id) => !symbols.has(id));
  check(`${page}: every icon reference resolves`, missing.length === 0, missing.join(', '));
}

// The card template's icon buttons carry no label in the markup because theirs
// names a section. Prove the code that builds a card supplies one.
const app = read('assets/js/app.js');
for (const control of ['card__toggle', 'card__fav', 'card__copy']) {
  const near = new RegExp(`${control}[\\s\\S]{0,600}?aria-label`);
  check(`app.js gives .${control} an aria-label`, near.test(app));
}

// 404 must be able to render with nothing else on the server.
group('404 is self-contained');
/* -------------------------------------------------------------------------- */
/* The teacher's console is not part of the site                               */
/*                                                                             */
/* Not a security boundary — the repository is public, so the file name is     */
/* public. These are the three ways it could end up in front of a student by   */
/* accident: indexed, linked, or listed in the sitemap.                        */
/* -------------------------------------------------------------------------- */

group('the lock console');

const admin = read('lock-admin.html');
check('lock-admin.html is noindex', /<meta\s+name="robots"\s+content="[^"]*noindex/.test(admin));
check('lock-admin.html sends no referrer', /name="referrer"\s+content="no-referrer"/.test(admin));

const sitemapText = read('sitemap.xml');
check('lock-admin.html is not in the sitemap', !sitemapText.includes('lock-admin'));
check('robots.txt disallows the console', /Disallow:\s*\/lock-admin\.html/.test(read('robots.txt')));

for (const page of ALL_HTML) {
  check(`${page}: does not link to the console`, !html[page].includes('lock-admin'));
}

// The sealed file is the one asset with nothing in it for a reader, and a
// crawler spending itself on 35 KB of base64 helps nobody.
check('robots.txt disallows the sealed file', /Disallow:\s*\/assets\/data\/unlock\.json/.test(read('robots.txt')));

/* -------------------------------------------------------------------------- */

const notFound = html['404.html'];
check('404.html loads no external stylesheet', !/<link[^>]+rel="stylesheet"/.test(notFound));
check('404.html loads no external script', !/<script[^>]+src=/.test(notFound));
check('404.html loads no image file', !/<img[^>]+src="(?!data:)/.test(notFound));
// Light is the default on every page, this one included. The only thing that
// may repaint it is a choice the visitor made with the header toggle, which
// arrives as data-theme — never the operating system's setting.
check('404.html does not follow the OS colour scheme', !/prefers-color-scheme/.test(notFound));
// A 404 is served for any missing path, at any depth, so a relative link would
// resolve against the path that was mistyped. It links to the site root and an
// inline script narrows that to the repository root on a project page.
check('404.html links to the site root', /id="homeLink"[^>]*href="\/"/.test(notFound));
check('404.html links to the teacher page', /id="teacherLink"/.test(notFound));
check('404.html resolves those links for a project page',
  /location\.pathname/.test(notFound) && /github\.io/.test(notFound));

/* -------------------------------------------------------------------------- */
/* Generated files agree with the dataset                                      */
/* -------------------------------------------------------------------------- */

group('generated files');

const llms = read('llms.txt');
const { total, totalQuestions, questionsMin, questionsMax } = data.meta;

check('llms.txt exists and is not empty', llms.trim().length > 0);
check('llms.txt leads with his name', /^#\s*الأستاذ عبد الرحمن سيد منصور/m.test(llms));
check('llms.txt states the form count', llms.includes(new Intl.NumberFormat('ar-EG-u-nu-latn').format(total)));
check('llms.txt states the question count',
  llms.includes(new Intl.NumberFormat('ar-EG-u-nu-latn').format(totalQuestions)));
check('llms.txt says the password is not published', /لا تُنشر هنا/.test(llms));
check('llms.txt says the form code is not published', /لا يُنشر هنا|ولا يُنشر/.test(llms));
check('llms.txt carries the site URL placeholder or a real URL',
  /__SITE_URL__|https:\/\//.test(llms));
check('llms.txt states the قياس disclaimer', /ليس تابعًا له ولا معتمدًا منه/.test(llms));

const sitemap = read('sitemap.xml');
check('sitemap.xml is well formed enough to parse as XML-ish',
  sitemap.startsWith('<?xml') && sitemap.includes('</urlset>'));
for (const page of ['', 'teacher.html', 'about.html']) {
  check(`sitemap.xml lists ${page || '/'}`, sitemap.includes(`<loc>__SITE_URL__${page}</loc>`)
    || new RegExp(`<loc>https://[^<]*${page}</loc>`).test(sitemap));
}
check('sitemap.xml carries a lastmod for every url',
  (sitemap.match(/<loc>/g) || []).length === (sitemap.match(/<lastmod>/g) || []).length);
check('sitemap.xml lastmod tracks the dataset', sitemap.includes(data.meta.generated));
check('sitemap.xml declares the teacher\'s photo for image search',
  sitemap.includes('teacher-portrait.jpg'));

const robots = read('robots.txt');
check('robots.txt allows everyone by default', /User-agent:\s*\*\s*\nAllow:\s*\//.test(robots));
for (const bot of ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'Google-Extended', 'PerplexityBot', 'Bingbot']) {
  check(`robots.txt names ${bot}`, new RegExp(`User-agent:\\s*${bot}\\b`, 'i').test(robots));
}
check('robots.txt disallows nothing', !/^\s*Disallow:\s*\/\s*$/m.test(robots));

// The figures stamped into the markup must still be the dataset's figures.
const ar = new Intl.NumberFormat('ar-EG-u-nu-latn');
const STAMPS = {
  total: ar.format(total),
  questions: ar.format(totalQuestions),
  qmin: ar.format(questionsMin),
  qmax: ar.format(questionsMax),
};
for (const page of PAGES) {
  for (const [key, value] of Object.entries(STAMPS)) {
    const found = [...html[page].matchAll(
      new RegExp(`data-stat="${key}"[^>]*>([^<]*)<`, 'g'),
    )].map((m) => m[1].trim());
    if (!found.length) continue;
    check(`${page}: every data-stat="${key}" reads ${value}`,
      found.every((v) => v === value), found.join(', '));
  }
}

check('the manifest points at icons that exist', (() => {
  const manifest = JSON.parse(read('site.webmanifest'));
  return manifest.icons.every((i) => exists(i.src));
})());
check('the manifest is RTL Arabic', (() => {
  const manifest = JSON.parse(read('site.webmanifest'));
  return manifest.lang === 'ar' && manifest.dir === 'rtl';
})());

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
