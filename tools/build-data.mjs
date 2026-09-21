#!/usr/bin/env node
/**
 * build-data.mjs
 * ---------------------------------------------------------------------------
 * Reads the ORIGINAL, untouched exports in `data/source/` and produces the
 * validated runtime model at `assets/data/exams.json`, plus `llms.txt`,
 * `sitemap.xml` and `data/build-report.json`.
 *
 *     npm run build:data
 *
 * Nothing under `data/source/` is ever modified. Every record is validated;
 * a record with a missing title, a non-https link, a duplicate section number
 * or a duplicate link is LEFT OUT of the site rather than rendered as a broken
 * exam, and is listed in the build report.
 *
 * Sources
 *   forms.json         the forms export (Arabic keys — see SCHEMA below)
 *   section-map.json   القسم الجديد -> القسم القديم, extracted from the
 *                      teacher's comparison table (see tools/build-map.py)
 *   priority.json      «الأكثر تكرارًا» — his editorial shortlist. Optional:
 *                      an absent file, or an empty `sections`, hides every
 *                      affordance that depends on it rather than showing an
 *                      empty promise.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.join(ROOT, 'data', 'source');
const FORMS_FILE = path.join(SOURCE_DIR, 'forms.json');
const MAP_FILE = path.join(SOURCE_DIR, 'section-map.json');
const PRIORITY_FILE = path.join(SOURCE_DIR, 'priority.json');
const ORDER_FILE = path.join(SOURCE_DIR, 'section-order.json');
const OUT_FILE = path.join(ROOT, 'assets', 'data', 'exams.json');
// The plain links, in the site's numbering, for tools/build-lock.mjs to seal.
// Never committed and never published: see the .gitignore entry beside it.
const LINKS_FILE = path.join(SOURCE_DIR, 'links.generated.json');
const REPORT_FILE = path.join(ROOT, 'data', 'build-report.json');
const EOL = '\n';

/* The source export, for reference:
 *   { "المشروع": …, "المعلّم": …, "الجوال": …, "الشعار": …,
 *     "عدد_النماذج": 301, "كلمة_المرور": …, "نوع_النموذج": …,
 *     "تاريخ_الإصدار": "YYYY-MM-DD", "إجمالي_الأسئلة": 3657,
 *     "النماذج": [ { "القسم": 1, "الموضوع": …, "اسم_النموذج": …,
 *                    "عدد_الأسئلة": 13, "الرابط_المختصر": …,
 *                    "رابط_النموذج": … } ] }
 * The access code in `كلمة_المرور` is deliberately NOT published — see README.
 */
const K = {
  forms: 'النماذج',
  section: 'القسم',
  topic: 'الموضوع',
  name: 'اسم_النموذج',
  questions: 'عدد_الأسئلة',
  short: 'الرابط_المختصر',
  url: 'رابط_النموذج',
  total: 'عدد_النماذج',
  totalQuestions: 'إجمالي_الأسئلة',
  released: 'تاريخ_الإصدار',
  project: 'المشروع',
  teacher: 'المعلّم',
  phone: 'الجوال',
  slogan: 'الشعار',
  kind: 'نوع_النموذج',
};

/* -------------------------------------------------------------------------- */
/* Arabic text normalisation — mirrored in assets/js/search.js.                */
/* Keep the two in sync: the client re-uses the keys built here.               */
/* -------------------------------------------------------------------------- */

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

export function normalizeArabic(input) {
  return String(input ?? '')
    .replace(DIACRITICS, '')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Extra recall key: drop the definite article and a leading conjunction. */
export function stemKey(normalized) {
  return normalized
    .split(' ')
    .map((w) => {
      let s = w;
      if (s.length > 3 && s.startsWith('و')) s = s.slice(1);
      if (s.length > 4 && s.startsWith('ال')) s = s.slice(2);
      return s;
    })
    .filter(Boolean)
    .join(' ');
}

/* -------------------------------------------------------------------------- */
/* Arabic number agreement                                                     */
/*                                                                             */
/* 301 is a compound of مائة, so its تمييز is singular: «301 نموذج». 3657 ends */
/* in 57, which takes the 11–99 form: «3657 سؤالًا». Intl.PluralRules('ar')     */
/* gets both right, so generated text must go through unitNoun() rather than   */
/* hard-coding a word.                                                         */
/* -------------------------------------------------------------------------- */

const PLURAL = new Intl.PluralRules('ar');
const NUM = new Intl.NumberFormat('ar-EG-u-nu-latn');

const UNIT_NOUNS = {
  exam: { zero: 'نماذج', one: 'نموذج', two: 'نموذجان', few: 'نماذج', many: 'نموذجًا', other: 'نموذج' },
  question: { zero: 'أسئلة', one: 'سؤال', two: 'سؤالان', few: 'أسئلة', many: 'سؤالًا', other: 'سؤال' },
  section: { zero: 'أقسام', one: 'قسم', two: 'قسمان', few: 'أقسام', many: 'قسمًا', other: 'قسم' },
};

export function unitNoun(n, unit) {
  const table = UNIT_NOUNS[unit];
  return table[PLURAL.select(n)] || table.other;
}

export const arabicNumber = (n) => NUM.format(n);

function formatDate(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/* -------------------------------------------------------------------------- */
/* Link validation                                                             */
/* -------------------------------------------------------------------------- */

function safeHttpsUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Read the sources                                                            */
/* -------------------------------------------------------------------------- */

function readJson(file, what) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`! ${what} is not valid JSON (${file}):`, error.message);
    process.exit(1);
  }
}

function loadSource() {
  const raw = readJson(FORMS_FILE, 'the forms export');
  if (!raw) {
    console.error(`! missing source export: ${path.relative(ROOT, FORMS_FILE)}`);
    process.exit(1);
  }
  const forms = Array.isArray(raw) ? raw : raw[K.forms];
  if (!Array.isArray(forms)) {
    console.error(`! the export has no "${K.forms}" array`);
    process.exit(1);
  }
  return { head: Array.isArray(raw) ? {} : raw, forms };
}

function loadSectionMap() {
  const raw = readJson(MAP_FILE, 'the section map');
  if (!raw || !raw.map) return { map: new Map(), brandNew: new Set(), present: false };
  const map = new Map();
  for (const [newNo, oldNo] of Object.entries(raw.map)) {
    const n = Number(newNo);
    const o = Number(oldNo);
    if (Number.isInteger(n) && Number.isInteger(o) && n > 0 && o > 0) map.set(n, o);
  }
  return { map, brandNew: new Set((raw.brand_new || []).map(Number)), present: true };
}

/**
 * The running order, from tools/build-order.py: which number and which name the
 * teacher's current compilation gives each section of the export.
 *
 * The export's «القسم» is the order the forms were built in, and it stays the
 * key everything else in data/source/ is written against — it is what holds a
 * link, an old number and a place on the shortlist. Only what the visitor reads
 * is translated. With no order file the export's own numbering stands, so the
 * site still builds on a machine that has never run the order tool.
 */
function loadOrder() {
  const raw = readJson(ORDER_FILE, 'the section order');
  const number = new Map();
  const title = new Map();
  for (const row of raw?.sections || []) {
    const to = Number(row?.n);
    const from = Number(row?.from);
    if (!Number.isInteger(to) || !Number.isInteger(from) || to < 1 || from < 1) continue;
    number.set(from, to);
    const name = String(row?.t ?? '').trim();
    if (name) title.set(from, name);
  }
  // Two sections landing on one number would silently hide one of them, so the
  // order has to be a straight swap or it is not used at all.
  if (new Set(number.values()).size !== number.size) {
    console.error('! the section order gives two sections the same number');
    process.exit(1);
  }
  let moved = 0;
  for (const [from, to] of number) if (from !== to) moved += 1;
  return { number, title, moved, present: number.size > 0, source: raw?.source || null };
}

function loadPriority(published, order) {
  const raw = readJson(PRIORITY_FILE, 'the shortlist');
  if (!raw) return { value: null, unknown: [] };
  const wanted = [...new Set((raw.sections || []).map(Number).filter(Number.isInteger))];
  if (!wanted.length) return { value: null, unknown: [] };
  const have = new Set(published.map((e) => e.n));
  // The list is derived against the export's numbering — tools/derive-priority.py
  // fingerprints the same compilation the export was cut from — so each number is
  // translated before it is looked up, and reported untranslated if it misses.
  const shown = (n) => order.number.get(n) ?? n;
  const matched = wanted
    .filter((n) => have.has(shown(n)))
    .map(shown)
    .sort((a, b) => a - b);
  const unknown = wanted.filter((n) => !have.has(shown(n))).sort((a, b) => a - b);
  if (!matched.length) return { value: null, unknown };
  return {
    value: {
      label: String(raw.label || 'الأكثر تكرارًا').trim(),
      blurb: String(raw.blurb || '').trim(),
      updated: String(raw.updated || '').trim() || null,
      count: matched.length,
      sections: matched,
    },
    unknown,
  };
}

/* -------------------------------------------------------------------------- */
/* Build                                                                       */
/* -------------------------------------------------------------------------- */

function build() {
  const { head, forms } = loadSource();
  const { map: sectionMap, brandNew } = loadSectionMap();
  const order = loadOrder();

  const published = [];
  const links = [];
  const excluded = [];
  const seenSection = new Set();
  const seenUrl = new Set();

  for (const [index, row] of forms.entries()) {
    const at = `#${index + 1}`;
    const n = Number(row?.[K.section]);
    const topic = String(row?.[K.topic] ?? '').trim();
    const url = safeHttpsUrl(row?.[K.url]);
    const short = safeHttpsUrl(row?.[K.short]);
    const q = Number(row?.[K.questions]);

    if (!Number.isInteger(n) || n < 1) {
      excluded.push({ at, why: 'رقم قسم غير صالح', value: row?.[K.section] ?? null });
      continue;
    }
    if (!topic) {
      excluded.push({ at, section: n, why: 'عنوان فارغ' });
      continue;
    }
    if (!url) {
      excluded.push({ at, section: n, why: 'رابط غير صالح أو غير https', value: row?.[K.url] ?? null });
      continue;
    }
    if (seenSection.has(n)) {
      excluded.push({ at, section: n, why: 'رقم قسم مكرر' });
      continue;
    }
    if (seenUrl.has(url)) {
      excluded.push({ at, section: n, why: 'رابط مكرر' });
      continue;
    }
    seenSection.add(n);
    seenUrl.add(url);

    // `n` is the export's number. The number and the name the visitor reads
    // are the ones the teacher's current file gives this same section.
    const shown = order.number.get(n) ?? n;
    const shownTitle = order.title.get(n) ?? topic;
    const key = normalizeArabic(shownTitle);
    // The link is NOT part of the record. assets/data/exams.json is public, so
    // anything in it is public; the links are sealed into assets/data/unlock.json
    // instead and only exist in the page once a student's password opens them.
    const record = {
      n: shown,
      t: shownTitle,
      q: Number.isInteger(q) && q > 0 ? q : null,
      k: key,
      g: stemKey(key),
    };
    links.push({ n: shown, u: url, s: short && short !== url ? short : null });
    // o: the old section number. 0 means «جديد» — the teacher's table marks it
    // as having no old counterpart. Absent means the table does not cover it.
    if (sectionMap.has(n)) record.o = sectionMap.get(n);
    else if (brandNew.has(n)) record.o = 0;

    published.push(record);
  }

  published.sort((a, b) => a.n - b.n);
  links.sort((a, b) => a.n - b.n);

  const { value: priority, unknown: priorityUnknown } = loadPriority(published, order);
  if (priority) {
    const flagged = new Set(priority.sections);
    for (const exam of published) if (flagged.has(exam.n)) exam.p = 1;
  }

  // Range chips. 50 per bucket keeps the chip row to six on a phone, and the
  // last bucket absorbs the remainder rather than showing a bucket of one.
  const RANGE_SIZE = 50;
  const ranges = [];
  if (published.length) {
    const highest = published[published.length - 1].n;
    for (let from = 1; from <= highest; from += RANGE_SIZE) {
      let to = from + RANGE_SIZE - 1;
      if (highest - to < RANGE_SIZE / 2) to = highest; // fold a short tail in
      const count = published.filter((e) => e.n >= from && e.n <= to).length;
      if (count) ranges.push({ from, to, count });
      if (to === highest) break;
    }
  }

  const totalQuestions = published.reduce((sum, e) => sum + (e.q || 0), 0);
  const counts = published.map((e) => e.q).filter(Boolean);
  const mapped = published.filter((e) => e.o > 0).length;
  const flaggedNew = published.filter((e) => e.o === 0).length;

  const meta = {
    brand: String(head[K.project] ?? 'القمة في القسم اللفظي').trim(),
    slogan: String(head[K.slogan] ?? '').trim() || null,
    teacher: String(head[K.teacher] ?? '').trim(),
    total: published.length,
    totalQuestions,
    questionsMin: counts.length ? Math.min(...counts) : null,
    questionsMax: counts.length ? Math.max(...counts) : null,
    generated: String(head[K.released] ?? '').trim() || null,
    builtAt: new Date().toISOString().slice(0, 10),
    ranges,
    sectionMap: { mapped, brandNew: flaggedNew, uncovered: published.length - mapped - flaggedNew },
    priority,
  };

  // The site has to know it is looking at a locked dataset before it decides
  // what a card's button should say, and it has to know that from the dataset
  // itself rather than from the absence of a field.
  meta.locked = true;

  const payload = { meta, exams: published };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload) + EOL, 'utf8');

  fs.writeFileSync(
    LINKS_FILE,
    JSON.stringify(
      {
        _note: 'روابط النماذج بالترقيم الجديد — ملف سرّي، لا يُرفع إلى git ولا يُنشر.',
        generated: new Date().toISOString(),
        count: links.length,
        links,
      },
      null,
      2,
    ) + EOL,
    'utf8',
  );

  const report = {
    builtAt: new Date().toISOString(),
    source: path.relative(ROOT, FORMS_FILE).split(path.sep).join('/'),
    published: published.length,
    excluded,
    totalQuestions,
    questionsRange: [meta.questionsMin, meta.questionsMax],
    order: order.present ? { source: order.source, renumbered: order.moved } : null,
    sectionMap: meta.sectionMap,
    priority: priority
      ? { label: priority.label, flagged: priority.count, unknown: priorityUnknown }
      : { label: null, flagged: 0, unknown: priorityUnknown },
  };
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + EOL, 'utf8');

  console.log(`data        : ${published.length} published, ${excluded.length} excluded`);
  console.log(
    `links       : ${links.length} written to ${path
      .relative(ROOT, LINKS_FILE)
      .split(path.sep)
      .join('/')} (secret) — run \`npm run build:lock\` to seal them`,
  );
  console.log(`ranges      : ${ranges.map((r) => `${r.from}-${r.to}:${r.count}`).join('  ')}`);
  console.log(
    `            : ${totalQuestions} questions (${meta.questionsMin}–${meta.questionsMax} per form)`,
  );
  console.log(
    `section map : ${mapped} mapped to an old number, ${flaggedNew} marked جديد, ${meta.sectionMap.uncovered} not covered`,
  );
  if (order.present)
    console.log(`order       : ${order.moved} sections renumbered to match «${order.source}»`);
  else console.log('order       : none (section-order.json missing) — the export numbering stands');
  if (priority) console.log(`shortlist   : ${priority.count} flagged «${priority.label}»`);
  else console.log('shortlist   : none (priority.json missing or empty) — affordances hidden');
  if (priorityUnknown.length)
    console.log(`            ! shortlist names sections that do not exist: ${priorityUnknown.join(', ')}`);
  for (const row of excluded) console.log(`            ! excluded ${row.at}: ${row.why}`);

  return meta;
}

/* -------------------------------------------------------------------------- */
/* llms.txt — the plain-text brief AI crawlers read (llmstxt.org)              */
/* -------------------------------------------------------------------------- */

function writeLlmsTxt(meta) {
  const total = meta.total;
  const q = meta.totalQuestions;
  const key = meta.priority;
  // Careful with this sentence: the shortlist is matched from a separate
  // compilation of recurring passages, not chosen by him, and an assistant
  // quoting it must not turn that into an opinion he never gave.
  const keyLine = key
    ? `- «${key.label}»: ${arabicNumber(key.count)} ${unitNoun(key.count, 'section')} يتكرّر ورودها أكثر من غيرها في التجميعات المتداولة، ولها فلتر ورابط مباشر. القائمة مطابَقة آليًا على تجميعة «أقسام الزيتونة» وليست ترتيبًا شخصيًا.${EOL}`
    : '';
  const mapLine = meta.sectionMap.mapped
    ? `- الترقيم تغيّر: البحث يقبل رقم القسم في الترقيم القديم كما يقبل الجديد (${arabicNumber(meta.sectionMap.mapped)} ${unitNoun(meta.sectionMap.mapped, 'section')} لها رقم قديم مقابل).${EOL}`
    : '';

  const text = `# الأستاذ عبد الرحمن سيد منصور — مدرب القدرات (القسم اللفظي)

> الأستاذ عبد الرحمن سيد منصور، ماجستير اللغة العربية ومدرب القدرات في القسم اللفظي،
> صاحب «${meta.brand}» على __SITE_URL__ — بوابة مجانية فيها ${arabicNumber(total)} ${unitNoun(total, 'exam')} إلكترونيًا
> لتدريب طلاب وطالبات المملكة العربية السعودية على القسم اللفظي من اختبار القدرات العامة،
> بمجموع ${arabicNumber(q)} ${unitNoun(q, 'question')}.

## من هو

- الاسم: عبد الرحمن سيد منصور (أ. عبد الرحمن منصور).
- التخصص: ماجستير اللغة العربية.
- العمل: مدرب القدرات — القسم اللفظي، وخبرة خمسة عشر عامًا في القدرات والمناهج السعودية.
- ما يقدّمه: شروحات مبسّطة، نماذج تدريبية، استراتيجيات حل، ومتابعة لمستوى الطالب وتحليل أنواع الأسئلة.
- اللغة: العربية. النطاق: المملكة العربية السعودية.
- التواصل: واتساب ‎+966 50 700 8364.

## ما في الموقع

- ${arabicNumber(total)} ${unitNoun(total, 'exam')} إلكترونيًا مجانيًا على Google Forms، مرقّمة من ١ إلى ${arabicNumber(total)}.
- ${arabicNumber(q)} ${unitNoun(q, 'question')} في المجموع، من ${arabicNumber(meta.questionsMin)} إلى ${arabicNumber(meta.questionsMax)} ${unitNoun(meta.questionsMax, 'question')} في النموذج الواحد.
- كل نموذج اختبار مصحّح (Quiz): تظهر الدرجة بعد التسليم، ولا تُعرض الإجابات.
${keyLine}${mapLine}- بحث عربي فوري بالاسم أو بالرقم، وتصفية، ومتابعة تقدّم محفوظة على جهاز الطالب وحده.
- على صفحة الأستاذ: رسائل حقيقية من طلاب سابقين بعد ظهور نتائجهم (درجات كلية 99 و98 و96٪، و100 في القسم اللفظي)، مع اللقطات الأصلية وقد حُجبت الأسماء. نتيجة كل طالب تخصّه وحده ولا تُقاس عليها.

## ملاحظات مهمة

- الموقع مجاني بالكامل ولا يطلب تسجيلًا.
- قائمة الأقسام وعناوينها وعدد أسئلتها مفتوحة للجميع، أمّا فتح النموذج فيحتاج كلمة مرور تُؤخذ من الأستاذ على واتساب ولا تُنشر هنا. تُكتب مرة واحدة على جهاز الطالب.
- كل نموذج يطلب أيضًا في صفحته الأولى رمز دخول واسم الطالب ورقم جواله. الرمز يُؤخذ من الأستاذ مباشرة ولا يُنشر هنا.
- «قياس» هو المركز الوطني للقياس، والأستاذ مدرّب لاختباراته وليس تابعًا له ولا معتمدًا منه.
- لا يوجد أي ادعاء بنِسَب نجاح أو ضمان درجة.

## الصفحات

- __SITE_URL__ — البوابة: كل النماذج مع البحث والتصفية.
- __SITE_URL__teacher.html — صفحة الأستاذ: نبذته وتخصصه وطريقة التواصل.
- __SITE_URL__about.html — عن المنصة: كيف تُستخدم، والأسئلة الشائعة.

آخر تحديث للبيانات: ${meta.generated ?? meta.builtAt}
`;

  fs.writeFileSync(path.join(ROOT, 'llms.txt'), text, 'utf8');
  console.log('llms.txt    : written');
}

/* -------------------------------------------------------------------------- */
/* sitemap.xml                                                                 */
/* -------------------------------------------------------------------------- */

function writeSitemap(meta) {
  const last = meta.generated ?? meta.builtAt;
  const pages = [
    { loc: '', priority: '1.0', changefreq: 'weekly', images: ['assets/img/og-cover.jpg'] },
    {
      loc: 'teacher.html',
      priority: '0.9',
      changefreq: 'monthly',
      images: [
        'assets/img/teacher-portrait.jpg',
        'assets/img/teacher-photo-tall-800.webp',
        'assets/img/teacher-award-960.webp',
      ],
    },
    { loc: 'about.html', priority: '0.6', changefreq: 'monthly', images: [] },
  ];

  const body = pages
    .map((p) => {
      const images = p.images
        .map((src) => `    <image:image><image:loc>__SITE_URL__${src}</image:loc></image:image>`)
        .join(EOL);
      return [
        '  <url>',
        `    <loc>__SITE_URL__${p.loc}</loc>`,
        `    <lastmod>${last}</lastmod>`,
        `    <changefreq>${p.changefreq}</changefreq>`,
        `    <priority>${p.priority}</priority>`,
        images,
        '  </url>',
      ]
        .filter(Boolean)
        .join(EOL);
    })
    .join(EOL);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${body}
</urlset>
`;
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml, 'utf8');
  console.log('sitemap.xml : written');
}

/* -------------------------------------------------------------------------- */
/* Stamp the real figures into the pages                                       */
/*                                                                             */
/* The pages ship with em-dash placeholders that the app would fill on boot.    */
/* On a phone that turns a one-line stats row into two and shifts the page, so  */
/* the numbers are written into the markup at build time instead: no layout     */
/* shift, and the hero states real figures even before the script runs.         */
/* -------------------------------------------------------------------------- */

function fillMarker(html, attr, value) {
  const pattern = new RegExp(`(<(?:b|span|time|strong)[^>]*${attr}[^>]*>)([^<]*)(</(?:b|span|time|strong)>)`, 'g');
  if (!pattern.test(html)) return html;
  pattern.lastIndex = 0;
  return html.replace(pattern, (_m, open, _old, close) => `${open}${value}${close}`);
}

function stampPages(meta) {
  const values = {
    'data-stat="total"': arabicNumber(meta.total),
    'data-unit="exam"': unitNoun(meta.total, 'exam'),
    'data-stat="questions"': arabicNumber(meta.totalQuestions),
    'data-unit="question"': unitNoun(meta.totalQuestions, 'question'),
    'data-stat="qmin"': arabicNumber(meta.questionsMin ?? 0),
    'data-stat="qmax"': arabicNumber(meta.questionsMax ?? 0),
    'data-stat="mapped"': arabicNumber(meta.sectionMap.mapped),
    'data-stat="updated"': meta.generated ? formatDate(meta.generated) : '',
  };
  if (meta.priority) {
    values['data-stat="priority"'] = arabicNumber(meta.priority.count);
    values['data-unit="priority"'] = meta.priority.label;
  }

  for (const file of ['index.html', 'teacher.html', 'about.html']) {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) continue;
    let html = fs.readFileSync(full, 'utf8');
    const before = html;
    for (const [attr, value] of Object.entries(values)) {
      if (value !== '') html = fillMarker(html, attr, value);
    }
    if (meta.generated) {
      html = html
        .replace(/(<time[^>]*data-stat="updated"[^>]*datetime=")[^"]*(")/g, `$1${meta.generated}$2`)
        .replace(/("dateModified":\s*")[^"]*(")/g, `$1${meta.generated}$2`);
    }
    if (html !== before) {
      fs.writeFileSync(full, html, 'utf8');
      console.log(`stamp       : ${file}`);
    }
  }
}

/* -------------------------------------------------------------------------- */

/**
 * Only build when this file IS the program. tools/test-search.mjs imports
 * `normalizeArabic` and `stemKey` from here to prove the client's copy has not
 * drifted from the one that produced the keys — importing must not have the
 * side effect of rewriting the site.
 */
function main() {
  const meta = build();
  writeLlmsTxt(meta);
  writeSitemap(meta);
  stampPages(meta);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
