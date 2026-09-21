/**
 * lock-admin.js — the teacher's console.
 *
 * Changing the password on a site with no server is one problem in two parts,
 * and this file solves the first: produce a new assets/data/unlock.json. The
 * second — getting that file onto GitHub — it can do for him, or hand to him as
 * a download to commit himself.
 *
 * How it can re-seal without knowing the current student password: the lock
 * file carries a second sealed section, the keyring, holding that password
 * under the ADMIN password. So the sequence is
 *
 *   admin password -> keyring -> student password -> the 301 links
 *                                                 -> re-seal under a new one
 *
 * which is also why the console can show the teacher the current password when
 * a student asks for it, instead of forcing a change he did not want.
 *
 * Nothing here is stored. The admin password lives in a variable for as long as
 * the tab is open and is never written to disk, never put in a URL, never sent
 * anywhere. The one thing this page does persist is the GitHub publishing
 * settings, and only because retyping a token every day would guarantee it ends
 * up written on something.
 */

import {
  DEFAULT_ITERATIONS,
  buildLockFile,
  normalizePassword,
  openKeyring,
  openLinks,
  validateLockFile,
} from './lock-crypto.js';

const LOCK_PATH = 'assets/data/unlock.json';
const GH_KEY = 'qimma.admin.github';
const PHONE = '966507008364';

const $ = (id) => document.getElementById(id);

const el = {
  signInPanel: $('signInPanel'),
  signInForm: $('signInForm'),
  adminPw: $('adminPw'),
  signInBtn: $('signInBtn'),
  signInSay: $('signInSay'),

  statusPanel: $('statusPanel'),
  facts: $('facts'),
  currentPw: $('currentPw'),
  showPwBtn: $('showPwBtn'),
  copyPwBtn: $('copyPwBtn'),
  sharePwBtn: $('sharePwBtn'),
  statusSay: $('statusSay'),

  changePanel: $('changePanel'),
  changeForm: $('changeForm'),
  newPw: $('newPw'),
  newPw2: $('newPw2'),
  strengthSay: $('strengthSay'),
  changeBtn: $('changeBtn'),
  suggestBtn: $('suggestBtn'),
  changeSay: $('changeSay'),

  publishPanel: $('publishPanel'),
  downloadBtn: $('downloadBtn'),
  ghBtn: $('ghBtn'),
  ghSetup: $('ghSetup'),
  ghOwner: $('ghOwner'),
  ghRepo: $('ghRepo'),
  ghBranch: $('ghBranch'),
  ghToken: $('ghToken'),
  ghSaveBtn: $('ghSaveBtn'),
  ghSaveCfgBtn: $('ghSaveCfgBtn'),
  ghForgetBtn: $('ghForgetBtn'),
  publishSay: $('publishSay'),

  morePanel: $('morePanel'),
  adminChangeForm: $('adminChangeForm'),
  newAdminPw: $('newAdminPw'),
  newAdminPw2: $('newAdminPw2'),
  adminChangeSay: $('adminChangeSay'),
  exportLinksBtn: $('exportLinksBtn'),
  exportSay: $('exportSay'),
  signOutBtn: $('signOutBtn'),
};

/** Open for as long as this tab is. Never written anywhere. */
let session = null;
/** A freshly sealed file that has not reached the site yet. */
let pending = null;

/* -------------------------------------------------------------------------- */
/* Saying things                                                               */
/* -------------------------------------------------------------------------- */

function say(node, state, message) {
  if (!node) return;
  if (!message) {
    node.removeAttribute('data-state');
    node.textContent = '';
    return;
  }
  node.dataset.state = state;
  node.textContent = message;
}

function busy(button, on, label) {
  if (!button) return;
  button.disabled = on;
  const span = button.querySelector('span');
  if (!span) return;
  if (on) {
    span.dataset.was = span.dataset.was ?? span.textContent;
    span.textContent = label ?? '…';
  } else if (span.dataset.was) {
    span.textContent = span.dataset.was;
    delete span.dataset.was;
  }
}

const arabicDate = (iso) => {
  try {
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
};

/* -------------------------------------------------------------------------- */
/* Reading what is published                                                   */
/* -------------------------------------------------------------------------- */

async function fetchLockFile() {
  const url = new URL(LOCK_PATH, location.href);
  url.searchParams.set('t', String(Date.now()));
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`تعذّر تحميل ملف القفل (HTTP ${response.status})`);
  const file = await response.json();
  const problems = validateLockFile(file);
  if (problems.length) throw new Error(`ملف القفل غير صالح: ${problems.join('، ')}`);
  return file;
}

function renderStatus() {
  const { file, studentPw } = session;
  el.facts.replaceChildren();
  const rows = [
    ['عدد الأقسام المقفولة', String(file.count)],
    ['نسخة الملف', file.v],
    ['آخر تغيير', arabicDate(file.updated)],
    ['قوة التشفير', `PBKDF2 · ${file.kdf.iterations.toLocaleString('en-US')} دورة`],
  ];
  for (const [label, value] of rows) {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.dir = 'auto';
    dd.textContent = value;
    div.append(dt, dd);
    el.facts.append(div);
  }

  el.currentPw.textContent = '•'.repeat(Math.max(4, studentPw.length));
  el.currentPw.dataset.shown = 'false';
  busy(el.showPwBtn, false);
  el.showPwBtn.querySelector('span').textContent = 'أظهرها';

  const text = `كلمة المرور لفتح نماذج القسم اللفظي: ${studentPw}`;
  el.sharePwBtn.href = `https://wa.me/${PHONE}?text=${encodeURIComponent(text)}`;
}

function showConsole() {
  el.signInPanel.hidden = true;
  el.statusPanel.hidden = false;
  el.changePanel.hidden = false;
  el.morePanel.hidden = false;
  renderStatus();
}

/* -------------------------------------------------------------------------- */
/* Sign in                                                                     */
/* -------------------------------------------------------------------------- */

el.signInForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const typed = el.adminPw.value;
  if (!typed.trim()) return say(el.signInSay, 'wrong', 'اكتب كلمة مرور المشرف.');

  busy(el.signInBtn, true, 'جارٍ الفتح…');
  say(el.signInSay, 'note', 'جارٍ التحقق…');

  try {
    const file = await fetchLockFile();
    const ring = await openKeyring(file, typed);
    const links = await openLinks(file, ring.student);

    session = { file, adminPw: normalizePassword(typed), studentPw: ring.student, links };
    el.adminPw.value = '';
    say(el.signInSay, null, '');
    showConsole();
  } catch (error) {
    say(
      el.signInSay,
      'wrong',
      error?.name === 'WrongPassword'
        ? 'كلمة مرور المشرف غير صحيحة.'
        : error.message || 'تعذّر الفتح.',
    );
  } finally {
    busy(el.signInBtn, false);
  }
});

/* -------------------------------------------------------------------------- */
/* The current password                                                        */
/* -------------------------------------------------------------------------- */

el.showPwBtn.addEventListener('click', () => {
  const shown = el.currentPw.dataset.shown === 'true';
  el.currentPw.dataset.shown = String(!shown);
  el.currentPw.textContent = shown ? '•'.repeat(Math.max(4, session.studentPw.length)) : session.studentPw;
  el.showPwBtn.querySelector('span').textContent = shown ? 'أظهرها' : 'أخفِها';
});

el.copyPwBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(session.studentPw);
    say(el.statusSay, 'ok', 'نُسخت كلمة المرور.');
  } catch {
    window.prompt('انسخ كلمة المرور:', session.studentPw);
  }
});

/* -------------------------------------------------------------------------- */
/* Strength                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The ciphertext is public, so a guessable password is a published one. This
 * counts the real search space rather than nagging about symbols.
 *
 * The rate below is an order-of-magnitude estimate for one high-end GPU against
 * 600,000 rounds of PBKDF2-SHA-256. It is used only to sort passwords into
 * "hopeless", "weak" and "not worth attacking", which is all the advice a
 * strength meter can honestly give.
 */
function judge(raw) {
  const pw = normalizePassword(raw);
  if (!pw) return null;

  let alphabet = 0;
  if (/[0-9]/.test(pw)) alphabet += 10;
  if (/[a-z]/.test(pw)) alphabet += 26;
  if (/[A-Z]/.test(pw)) alphabet += 26;
  if (/[؀-ۿ]/.test(pw)) alphabet += 36;
  if (/[^0-9a-zA-Z؀-ۿ]/.test(pw)) alphabet += 12;

  const guesses = alphabet ** pw.length;
  const seconds = guesses / 2 / 16000; // one GPU, on average

  if (PHONE.includes(pw) || '0507008364'.includes(pw)) {
    return { state: 'wrong', text: 'هذه جزء من رقم جوال الأستاذ المنشور في كل صفحة — أول ما سيجرّبه أي شخص.' };
  }
  if (pw.length < 6) {
    return { state: 'wrong', text: `${pw.length} خانات فقط. اجعلها 8 أو أكثر.` };
  }
  if (seconds < 86400) {
    return { state: 'warn', text: 'قصيرة نسبيًا — تُكسر في أقل من يوم بجهاز قوي. أضف حروفًا أو خانات.' };
  }
  if (seconds < 86400 * 365) {
    return { state: 'warn', text: 'مقبولة. إضافة خانة واحدة تجعلها أقوى بكثير.' };
  }
  return { state: 'ok', text: 'قوية — كسرها غير عملي.' };
}

el.newPw.addEventListener('input', () => {
  const verdict = judge(el.newPw.value);
  if (!verdict) return say(el.strengthSay, null, '');
  say(el.strengthSay, verdict.state, verdict.text);
});

const SUGGEST_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1
el.suggestBtn.addEventListener('click', () => {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const pw = [...bytes].map((b) => SUGGEST_ALPHABET[b % SUGGEST_ALPHABET.length]).join('');
  el.newPw.value = pw;
  el.newPw2.value = pw;
  el.newPw.dispatchEvent(new Event('input'));
});

/* -------------------------------------------------------------------------- */
/* Sealing a new file                                                          */
/* -------------------------------------------------------------------------- */

function linkRows() {
  return [...session.links].map(([n, { u, s }]) => ({ n, u, s }));
}

async function reseal({ studentPassword, adminPassword }, button, node) {
  busy(button, true, 'جارٍ التشفير…');
  say(node, 'note', 'جارٍ إعادة تشفير الروابط… (ثانية تقريبًا)');
  try {
    const file = await buildLockFile({
      links: linkRows(),
      studentPassword,
      adminPassword,
      iterations: session.file.kdf.iterations || DEFAULT_ITERATIONS,
    });

    // Never hand over a file without checking it opens. A lock nobody can
    // unlock would take all 301 forms off the site until it was noticed.
    const back = await openLinks(file, studentPassword);
    if (back.size !== session.links.size) throw new Error('فشل التحقق بعد التشفير.');
    await openKeyring(file, adminPassword);

    pending = { file, studentPassword: normalizePassword(studentPassword), adminPassword: normalizePassword(adminPassword) };
    el.publishPanel.hidden = false;
    say(node, 'ok', 'الملف جاهز. انشره من القسم التالي حتى تصل الكلمة الجديدة للطلاب.');
    say(el.publishSay, null, '');
    el.publishPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  } catch (error) {
    say(node, 'wrong', error.message || 'تعذّر تجهيز الملف.');
    return false;
  } finally {
    busy(button, false);
  }
}

el.changeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const a = el.newPw.value;
  const b = el.newPw2.value;

  if (!a.trim()) return say(el.changeSay, 'wrong', 'اكتب الكلمة الجديدة.');
  if (normalizePassword(a) !== normalizePassword(b)) {
    return say(el.changeSay, 'wrong', 'الكلمتان غير متطابقتين.');
  }
  if (normalizePassword(a) === session.adminPw) {
    return say(el.changeSay, 'wrong', 'لا تجعل كلمة الطلاب هي نفسها كلمة المشرف.');
  }
  if (normalizePassword(a) === session.studentPw) {
    return say(el.changeSay, 'wrong', 'هذه هي الكلمة الحالية بالفعل.');
  }

  await reseal({ studentPassword: a, adminPassword: session.adminPw }, el.changeBtn, el.changeSay);
});

el.adminChangeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const a = el.newAdminPw.value;
  const b = el.newAdminPw2.value;
  const button = el.adminChangeForm.querySelector('button[type="submit"]');

  if (!a.trim()) return say(el.adminChangeSay, 'wrong', 'اكتب كلمة المشرف الجديدة.');
  if (normalizePassword(a) !== normalizePassword(b)) {
    return say(el.adminChangeSay, 'wrong', 'الكلمتان غير متطابقتين.');
  }
  if (normalizePassword(a) === session.studentPw) {
    return say(el.adminChangeSay, 'wrong', 'لا تجعل كلمة المشرف هي نفسها كلمة الطلاب.');
  }

  const ok = await reseal(
    { studentPassword: session.studentPw, adminPassword: a },
    button,
    el.adminChangeSay,
  );
  if (ok) {
    say(
      el.adminChangeSay,
      'warn',
      'الملف جاهز بكلمة مشرف جديدة. انشره الآن، واحفظ الكلمة الجديدة — لا توجد طريقة لاستعادتها.',
    );
  }
});

/* -------------------------------------------------------------------------- */
/* Publishing                                                                  */
/*                                                                             */
/* "Automatic" on a site with no server means: this page commits the file to   */
/* GitHub itself, and GitHub Pages redeploys. The teacher never opens a file.  */
/*                                                                             */
/* The one thing it needs is permission to write to that repository — a        */
/* fine-grained token, scoped to Contents on this one repo, pasted once and    */
/* kept in his browser. Everything else is worked out: the repository from the */
/* site's own address, the branch from GitHub. After the commit the page       */
/* watches the live site until it is serving the version it just sent, so      */
/* "published" here means a student would see it, not that a request was made. */
/* -------------------------------------------------------------------------- */

function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

el.downloadBtn.addEventListener('click', () => {
  if (!pending) return;
  download('unlock.json', `${JSON.stringify(pending.file)}\n`);
  say(
    el.publishSay,
    'warn',
    'نُزّل الملف. لسه محتاج ترفعه على GitHub مكان assets/data/unlock.json — الخطوات في الإعدادات المتقدمة.',
  );
});

/* ---- where the site lives -------------------------------------------------- */

/**
 * owner and repo, read off a *.github.io address. A project site lives at
 * owner.github.io/repo/, a user site at owner.github.io/ (whose repo is named
 * owner.github.io). Null on a custom domain or on a local preview, where the
 * fields in the advanced section take over.
 */
function detectRepo() {
  const m = /^([a-z0-9-]+)\.github\.io$/i.exec(location.hostname);
  if (!m) return null;
  const owner = m[1];
  const first = location.pathname.split('/').filter(Boolean)[0] || '';
  const repo = first && !first.includes('.') ? first : `${owner}.github.io`;
  return { owner, repo };
}

function readGh() {
  try {
    return JSON.parse(localStorage.getItem(GH_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function writeGh(patch) {
  try {
    localStorage.setItem(GH_KEY, JSON.stringify({ ...readGh(), ...patch }));
    return true;
  } catch {
    return false;
  }
}

/** Typed beats saved beats detected, field by field. */
function ghConfig() {
  const saved = readGh();
  const detected = detectRepo();
  return {
    owner: el.ghOwner.value.trim() || saved.owner || detected?.owner || '',
    repo: el.ghRepo.value.trim() || saved.repo || detected?.repo || '',
    branch: el.ghBranch.value.trim() || saved.branch || '',
    token: el.ghToken.value.trim() || saved.token || '',
  };
}

function loadGh() {
  const saved = readGh();
  el.ghOwner.value = saved.owner || '';
  el.ghRepo.value = saved.repo || '';
  el.ghBranch.value = saved.branch || '';
  el.ghToken.value = saved.token || '';
}

el.ghSaveCfgBtn.addEventListener('click', () => {
  const ok = writeGh({
    owner: el.ghOwner.value.trim(),
    repo: el.ghRepo.value.trim(),
    branch: el.ghBranch.value.trim(),
  });
  say(el.publishSay, ok ? 'ok' : 'wrong', ok ? 'حُفظت الحقول في هذا المتصفح.' : 'تعذّر الحفظ — المتصفح يمنع التخزين.');
});

el.ghSaveBtn.addEventListener('click', () => {
  const token = el.ghToken.value.trim();
  if (!token) return say(el.publishSay, 'wrong', 'الصق التوكن أولًا.');
  if (!writeGh({ token })) {
    say(el.publishSay, 'warn', 'المتصفح يمنع الحفظ، فسيُستخدم التوكن لهذه المرة فقط.');
  }
  el.ghSetup.hidden = true;
  publish();
});

el.ghForgetBtn.addEventListener('click', () => {
  writeGh({ token: '' });
  el.ghToken.value = '';
  say(el.publishSay, 'ok', 'مُسح التوكن من هذا المتصفح.');
});

/* ---- GitHub ---------------------------------------------------------------- */

const GH = 'https://api.github.com';

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** A GitHub call whose failures are sentences the teacher can act on. */
async function ghJson(url, init, what) {
  const response = await fetch(url, { cache: 'no-store', ...init });
  if (response.ok) return response.json();

  let detail = '';
  try {
    detail = (await response.json()).message || '';
  } catch {
    /* no body */
  }
  const error = new Error(
    response.status === 401
      ? 'التوكن غير صالح أو انتهت مدته. أنشئ توكن جديدًا من الخطوات بالأسفل.'
      : response.status === 403
        ? 'التوكن لا يملك صلاحية Contents: Read and write على هذا المستودع.'
        : response.status === 404
          ? `${what} غير موجود، أو التوكن لا يراه.`
          : response.status === 409 || response.status === 422
            ? 'تعارض: الملف تغيّر على GitHub أثناء العمل. حدّث الصفحة وأعد المحاولة.'
            : `رفض GitHub الطلب (HTTP ${response.status}${detail ? `: ${detail}` : ''}).`,
  );
  error.status = response.status;
  throw error;
}

async function ghCommit(cfg, text) {
  const headers = ghHeaders(cfg.token);

  // One call that checks the token, the repository and the branch together,
  // and says which of them is the problem.
  const repo = await ghJson(`${GH}/repos/${cfg.owner}/${cfg.repo}`, { headers }, `المستودع ${cfg.owner}/${cfg.repo}`);
  const branch = cfg.branch || repo.default_branch;

  // GitHub refuses a blind overwrite, which is exactly what we want: two people
  // cannot silently clobber each other's password change. A 404 here just
  // means the file does not exist yet on that branch.
  const api = `${GH}/repos/${cfg.owner}/${cfg.repo}/contents/${LOCK_PATH}`;
  let sha;
  try {
    ({ sha } = await ghJson(`${api}?ref=${encodeURIComponent(branch)}`, { headers }, 'الملف'));
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  return ghJson(
    api,
    {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'تغيير كلمة مرور فتح النماذج',
        content: utf8ToBase64(text),
        branch,
        ...(sha ? { sha } : {}),
      }),
    },
    'الملف',
  );
}

/* ---- watching it go live --------------------------------------------------- */

/**
 * Pages redeploys after the commit, usually within a minute or two. Poll the
 * live file — this page is served from the same place, so the fetch below hits
 * the real site — until it carries the version that was just sent.
 */
async function waitForLive(version, { every = 12000, upTo = 6 * 60 * 1000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < upTo) {
    await new Promise((r) => setTimeout(r, every));
    try {
      const file = await fetchLockFile();
      if (file.v === version) return true;
    } catch {
      /* mid-deploy; keep waiting */
    }
    const seconds = Math.round((Date.now() - t0) / 1000);
    say(el.publishSay, 'note', `تم الرفع إلى GitHub. جارٍ انتظار تحديث الموقع… (${seconds} ثانية)`);
  }
  return false;
}

/* ---- publish ---------------------------------------------------------------- */

async function publish() {
  if (!pending) return;
  const cfg = ghConfig();

  if (!cfg.token) {
    el.ghSetup.hidden = false;
    el.ghToken.focus();
    say(el.publishSay, 'note', 'أول مرة فقط: الصفحة تحتاج توكن من GitHub لتنشر بدلًا عنك. الخطوات بالأسفل.');
    return;
  }
  if (!cfg.owner || !cfg.repo) {
    document.querySelector('#publishPanel details').open = true;
    say(el.publishSay, 'wrong', 'تعذّر اكتشاف المستودع من عنوان الموقع. اكتب المالك والمستودع في الإعدادات المتقدمة ثم احفظ.');
    return;
  }

  busy(el.ghBtn, true, 'جارٍ النشر…');
  say(el.publishSay, 'note', 'جارٍ الاتصال بـ GitHub…');
  try {
    const text = `${JSON.stringify(pending.file)}\n`;
    const version = pending.file.v;
    await ghCommit(cfg, text);

    // From here the file is on GitHub. What the console describes as current
    // is what it just sent; what remains is Pages catching up.
    const published = pending;
    pending = null;
    session.file = published.file;
    session.studentPw = published.studentPassword;
    session.adminPw = published.adminPassword;
    el.changeForm.reset();
    say(el.strengthSay, null, '');
    renderStatus();

    say(el.publishSay, 'note', 'تم الرفع إلى GitHub. جارٍ انتظار تحديث الموقع… (عادةً دقيقة أو دقيقتان)');
    const live = await waitForLive(version);
    if (live) {
      el.publishPanel.hidden = true;
      say(
        el.statusSay,
        'ok',
        'الموقع يعمل الآن بكلمة المرور الجديدة. كل طالب سيُطلب منه الكلمة الجديدة عند أول فتح للموقع.',
      );
      el.statusPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      say(
        el.publishSay,
        'warn',
        'الملف على GitHub لكن الموقع لم يتحدّث بعد. غالبًا يكفي الانتظار قليلًا؛ وإن طال، راجع تبويب Actions في المستودع.',
      );
    }
  } catch (error) {
    if (error.status === 401) el.ghSetup.hidden = false;
    say(el.publishSay, 'wrong', `${error.message}
يمكنك دائمًا التنزيل والرفع اليدوي من الإعدادات المتقدمة.`);
  } finally {
    busy(el.ghBtn, false);
  }
}

el.ghBtn.addEventListener('click', publish);

/* -------------------------------------------------------------------------- */
/* Backup and sign out                                                         */
/* -------------------------------------------------------------------------- */

el.exportLinksBtn.addEventListener('click', () => {
  const rows = linkRows();
  download(
    `qimma-links-${new Date().toISOString().slice(0, 10)}.json`,
    `${JSON.stringify({ _note: 'سرّي — لا يُرفع على GitHub', count: rows.length, links: rows }, null, 2)}\n`,
  );
  say(el.exportSay, 'warn', `نُزّل ${rows.length} رابطًا. احفظه في مكان آمن ولا ترفعه على GitHub.`);
});

el.signOutBtn.addEventListener('click', () => {
  session = null;
  pending = null;
  el.statusPanel.hidden = true;
  el.changePanel.hidden = true;
  el.publishPanel.hidden = true;
  el.morePanel.hidden = true;
  el.signInPanel.hidden = false;
  el.changeForm.reset();
  el.adminChangeForm.reset();
  say(el.strengthSay, null, '');
  say(el.signInSay, 'ok', 'خرجتَ من اللوحة.');
  el.adminPw.focus();
});

/* -------------------------------------------------------------------------- */

loadGh();
el.adminPw.focus();

// A tab left open on a shared laptop is the one way this page could leak. The
// session lives in memory only, so closing or reloading the tab ends it — this
// just makes that explicit rather than leaving it to chance.
window.addEventListener('pagehide', () => {
  session = null;
  pending = null;
});
