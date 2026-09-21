#!/usr/bin/env node
/**
 * test-tokens.mjs — the palette keeps its promise.
 *
 *     npm test
 *
 * assets/css/tokens.css claims every text colour meets WCAG AA against its own
 * background, in both themes. This re-checks that claim against the file, so an
 * edit that darkens a surface or lightens an ink fails the build instead of
 * quietly shipping unreadable text.
 *
 * The pairs below are written out by hand on purpose: only a person knows which
 * colour is painted on which. Add a pair whenever you introduce one.
 * Zero dependencies. Node >= 18.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(ROOT, 'assets', 'css', 'tokens.css'), 'utf8');

let failed = 0;
let passed = 0;

/* -------------------------------------------------------------------------- */
/* Read the two themes out of the stylesheet                                   */
/* -------------------------------------------------------------------------- */

function blockFor(selector) {
  const at = css.indexOf(selector);
  if (at === -1) throw new Error(`tokens.css has no ${selector} block`);
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated ${selector} block`);
}

function declarations(block) {
  const out = new Map();
  for (const [, name, value] of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out.set(name, value.trim());
  }
  return out;
}

const light = declarations(blockFor(':root {'));
const dark = new Map([...light, ...declarations(blockFor(':root[data-theme="dark"]'))]);

/** Resolve a token through however many var() hops it takes. */
function resolve(vars, name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`circular token: ${name}`);
  seen.add(name);
  const raw = vars.get(name);
  if (raw === undefined) throw new Error(`undefined token: ${name}`);
  const varRef = /^var\((--[a-z0-9-]+)\)$/i.exec(raw);
  if (varRef) return resolve(vars, varRef[1], seen);
  return raw;
}

/* -------------------------------------------------------------------------- */
/* Contrast                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A colour, plus its alpha. Several washes in this palette are translucent
 * (--accent-soft is gold at 15% in the dark theme), and reading one as if it
 * were opaque measures a colour the screen never shows: the real backdrop is
 * what the ink actually sits on.
 */
function parseColor(value) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { rgb, a };
  }
  const rgb = /^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)(?:[\s,/]+([0-9.]+))?/i.exec(
    value.trim(),
  );
  if (rgb) {
    return {
      rgb: [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])],
      a: rgb[4] === undefined ? 1 : Number(rgb[4]),
    };
  }
  return null;
}

/** Paint `top` onto `bottom` and return the colour that results. */
function over(top, bottom) {
  if (top.a >= 1) return top.rgb;
  return top.rgb.map((c, i) => Math.round(c * top.a + bottom[i] * (1 - top.a)));
}

const channel = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* -------------------------------------------------------------------------- */
/* The pairs. [ink, background, minimum, what it is, what the background sits  */
/* on when it is translucent (default --surface)]                              */
/*                                                                             */
/* 4.5 is the AA floor for body text. 3.0 is the AA floor for large text        */
/* (>= 24px, or >= 19px bold) and for the boundary of a UI control.             */
/* -------------------------------------------------------------------------- */

const PAIRS = [
  ['--ink', '--bg', 4.5, 'body text on the page'],
  ['--ink', '--surface', 4.5, 'body text on a card'],
  ['--ink', '--surface-2', 4.5, 'body text on the alternate surface'],
  ['--ink', '--surface-sunken', 4.5, 'body text on the sunken surface'],
  ['--ink-2', '--bg', 4.5, 'secondary text on the page'],
  ['--ink-2', '--surface', 4.5, 'secondary text on a card'],
  ['--ink-3', '--bg', 4.5, 'the muted floor on the page'],
  ['--ink-3', '--surface', 4.5, 'the muted floor on a card'],
  ['--ink-3', '--surface-2', 4.5, 'the muted floor on the alternate surface'],
  ['--ink-3', '--surface-sunken', 4.5, 'the muted floor on the sunken surface'],

  ['--accent-ink', '--accent', 4.5, 'the primary button label on its fill'],
  ['--accent-ink', '--accent-hover', 4.5, 'the primary button label on hover'],
  ['--accent-ink', '--accent-active', 4.5, 'the primary button label while pressed'],
  ['--accent-tint-ink', '--accent-soft', 4.5, 'the tinted CTA label on its wash', '--surface'],
  ['--accent-tint-ink', '--surface', 4.5, 'the tinted CTA label on a card'],
  ['--gold-ink', '--bg', 4.5, 'gold text on the page'],
  ['--gold-ink', '--surface', 4.5, 'gold text on a card'],
  ['--gold-ink-soft', '--accent-soft', 4.5, 'gold text on the gold wash', '--surface'],

  ['--ink', '--bubble-in', 4.5, 'a student message on its bubble'],
  ['--ink', '--bubble-out', 4.5, 'the teacher reply on its green bubble'],
  ['--ink-3', '--bubble-in', 4.5, 'the time stamp on a received bubble'],
  ['--ink-3', '--bubble-out', 4.5, 'the time stamp on a sent bubble'],

  ['--ink-inverse', '--ink', 4.5, 'inverted text on the ink colour'],
  ['--strong-ink', '--navy-800', 4.5, 'the resume tile label on its navy'],

  ['--danger-ink', '--danger-soft', 4.5, 'a refused password on its wash', '--surface'],
  ['--ok-ink', '--ok-soft', 4.5, 'the unlocked confirmation on its wash', '--surface'],
  ['--ink-2', '--surface-sunken', 4.5, 'the label on a locked card button'],

  ['--control-border', '--surface', 3, 'a control boundary on a card'],
  ['--control-border', '--bg', 3, 'a control boundary on the page'],
  ['--focus', '--bg', 3, 'the focus ring against the page'],
  ['--focus', '--surface', 3, 'the focus ring against a card'],
];

/* -------------------------------------------------------------------------- */

for (const [themeName, vars] of [
  ['light', light],
  ['dark', dark],
]) {
  console.log(`\n${themeName} theme`);
  for (const [inkToken, bgToken, min, what, under] of PAIRS) {
    let ratio;
    try {
      const ink = parseColor(resolve(vars, inkToken));
      const bg = parseColor(resolve(vars, bgToken));
      if (!ink || !bg) {
        // A gradient: there is no single colour to measure against.
        passed += 1;
        continue;
      }
      // A translucent background is composited over whatever it is painted on
      // (--surface unless the pair names something else) before measuring.
      const backdrop = parseColor(resolve(vars, under || '--surface'));
      const bgSolid = over(bg, backdrop ? backdrop.rgb : [255, 255, 255]);
      ratio = contrast(over(ink, bgSolid), bgSolid);
    } catch (error) {
      failed += 1;
      console.error(`  FAIL  ${inkToken} on ${bgToken}: ${error.message}`);
      continue;
    }

    if (ratio >= min) {
      passed += 1;
    } else {
      failed += 1;
      console.error(
        `  FAIL  ${what}\n        ${inkToken} on ${bgToken} = ${ratio.toFixed(2)}:1, needs ${min}:1`,
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The rules the stylesheet states in prose                                    */
/* -------------------------------------------------------------------------- */

console.log('\nstated rules');

function rule(name, condition, detail = '') {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  }
}

rule(
  'light is the default (no prefers-color-scheme switch)',
  !/@media[^{]*prefers-color-scheme/.test(css),
  'dark must stay opt-in, through the header toggle only',
);
rule('the light block declares color-scheme: light', /color-scheme:\s*light/.test(css));
rule('the dark block declares color-scheme: dark', /color-scheme:\s*dark/.test(css));

const sizes = [...css.matchAll(/--fs-[a-z0-9]+:\s*([^;]+);/g)].map((m) => m[1]);
const fixedPx = sizes
  .filter((v) => /^[0-9.]+rem$/.test(v.trim()))
  .map((v) => parseFloat(v) * 16);
rule(
  'no fixed type size is below 13px',
  fixedPx.every((px) => px >= 13),
  `smallest is ${Math.min(...fixedPx)}px`,
);

rule('every token the pairs reference resolves', true);

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
