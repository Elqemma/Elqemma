/**
 * Shared chrome: theme toggle and the mobile navigation menu.
 * Loaded by every page. The initial theme is applied by a tiny blocking script
 * in <head> so the page never flashes the wrong palette.
 */

const THEME_KEY = 'qimma:theme';

// Lets the stylesheet know scripts are running: the scroll-reveal styles hide
// nothing unless this class is present, so a page without JS is never blank.
document.documentElement.classList.add('js');

/** Light unless the visitor has explicitly switched to dark. The OS setting is ignored. */
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** Point the toggle at whatever switching would do next. Never writes state. */
function syncThemeButton(button) {
  if (!button) return;
  const toDark = currentTheme() === 'light';
  button.setAttribute('aria-label', toDark ? 'تفعيل الوضع الداكن' : 'تفعيل الوضع الفاتح');
  button.setAttribute('title', toDark ? 'الوضع الداكن' : 'الوضع الفاتح');
  button.querySelector('use')?.setAttribute('href', toDark ? '#i-moon' : '#i-sun');
}

/** Only ever called from the toggle: this is the one place that persists. */
function setTheme(theme, button) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage unavailable - the choice simply will not persist */
  }
  syncThemeButton(button);
}

function initTheme() {
  const button = document.getElementById('themeToggle');
  if (!button) return;

  syncThemeButton(button);

  button.addEventListener('click', () => {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark', button);
  });
}

function initNav() {
  const toggle = document.getElementById('navToggle');
  const nav = document.getElementById('primaryNav');
  if (!toggle || !nav) return;

  const desktop = window.matchMedia('(min-width: 720px)');

  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'إغلاق قائمة التنقل' : 'فتح قائمة التنقل');
    nav.classList.toggle('nav--open', open);
    toggle.querySelector('use')?.setAttribute('href', open ? '#i-close' : '#i-menu');
  };

  setOpen(false);

  toggle.addEventListener('click', () => {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });

  nav.addEventListener('click', (event) => {
    if (event.target.closest('a') && !desktop.matches) setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });

  document.addEventListener('click', (event) => {
    if (desktop.matches || toggle.getAttribute('aria-expanded') !== 'true') return;
    if (!nav.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
  });

  desktop.addEventListener('change', () => setOpen(false));
}

/**
 * Scroll reveal. Anything carrying data-reveal fades and lifts into place the
 * first time it enters the viewport (CSS does the motion, and the reduced-motion
 * rule in base.css zeroes it). Without IntersectionObserver everything is simply
 * shown.
 */
function initReveal() {
  const targets = document.querySelectorAll('[data-reveal]');
  if (!targets.length) return;
  if (!('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.06 },
  );
  targets.forEach((el) => io.observe(el));
}

/**
 * The proof lightbox: a student's original screenshot, opened from the
 * transcribed card. One <dialog> per page; the trigger carries the image's
 * path, size and alt in data attributes, so the markup stays static.
 */
function initLightbox() {
  const dialog = document.getElementById('proofDialog');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  const img = dialog.querySelector('img');
  const caption = dialog.querySelector('[data-caption]');
  let opener = null;

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-proof]');
    if (!trigger) return;
    img.src = trigger.dataset.proof;
    img.width = Number(trigger.dataset.w) || 720;
    img.height = Number(trigger.dataset.h) || 900;
    img.alt = trigger.dataset.alt || '';
    if (caption) caption.textContent = trigger.dataset.caption || '';
    opener = trigger;
    dialog.showModal();
  });

  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    img.removeAttribute('src');
    opener?.focus();
    opener = null;
  });
}

/**
 * The about page explains «الأكثر تكرارًا» only while the teacher has it
 * switched on. The page ships an empty marker; the module and its two small
 * files are fetched on that page alone, and with the switch off nothing is
 * added.
 */
function initShortlistAbout() {
  const marker = document.getElementById('shortlistAbout');
  if (!marker) return;
  import('./shortlist.js')
    .then(async ({ loadShortlist, renderAbout }) => {
      const shortlist = await loadShortlist();
      if (shortlist) renderAbout(marker, shortlist);
    })
    .catch(() => {
      /* off is the safe answer to any failure */
    });
}

initTheme();
initNav();
initReveal();
initLightbox();
initShortlistAbout();
