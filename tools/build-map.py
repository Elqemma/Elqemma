#!/usr/bin/env python3
"""
build-map.py — rebuilds data/source/section-map.json from the photographed table
«مقارنة الأقسام الجديدة بالأقسام القديمة» in data/source/section-map-page1.jpg.

    python tools/build-map.py             # rewrite the JSON, but only if every check passes
    python tools/build-map.py --dry-run   # read and report, touch nothing

Needs Pillow, numpy and scipy (`pip install pillow numpy scipy`). The output is
committed, so building or deploying the site never needs Python — run this only
when the teacher hands over another page of the table.

Why a bespoke reader rather than an OCR engine: the page is a phone photo of a
printed grid of Eastern-Arabic numerals sitting on seven different pastel fills.
Off-the-shelf OCR either needs a network round trip (the teacher's data must not
leave the machine) or confuses ٦/٧ and ١/١١ often enough that a silent one-digit
slip would send a student to the wrong section forever.

The grid hands us a way out. Each pair of columns is (جديد، قديم), and the جديد
value is simply the row's position in the table — we already know it. So the page
carries its own labelled training set: learn the ten digit shapes from the جديد
column, then read the قديم column with them. Same ink, same camera, same JPEG
ringing on both sides, which is why the match scores come out cleanly bimodal and
the reading can be *verified* rather than merely believed.

The teacher's page 1 covers new sections 1..279. Anything past that stays
unmapped until he sends page 2; the site is written to cope with that.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "source" / "section-map-page1.jpg"
FORMS = ROOT / "data" / "source" / "forms.json"
OUT = ROOT / "data" / "source" / "section-map.json"

# --- The grid ------------------------------------------------------------------
#
# Detection wins when it agrees with these; they are what the detector found the
# day the map was first extracted, kept so that a re-crop or a re-compression of
# the JPEG can never silently shift every cell by one column.

FALLBACK_V = (33, 96, 157, 220, 282, 350, 413, 476, 545, 623, 697, 771, 838, 900, 969)
FALLBACK_H = (
    149, 183, 213, 244, 274, 304, 334, 364, 394, 424, 455, 485, 515, 545, 575,
    605, 635, 665, 695, 725, 756, 786, 816, 846, 876, 906, 936, 966, 996, 1027,
    1057, 1087, 1117, 1147, 1177, 1207, 1237, 1268, 1298, 1328, 1358, 1392,
)

# Fourteen columns = seven (جديد، قديم) pairs, read right to left like the text.
# The first index of each pair is the جديد column.
PAIRS = ((13, 12), (11, 10), (9, 8), (7, 6), (5, 4), (3, 2), (1, 0))
ROWS_PER_PAIR = 41
LAST_MAPPED = 279  # where page 1 stops
TOTAL_SECTIONS = 301  # fallback, only if forms.json cannot be read

# A printed rule blackens ~94% of its scanline. 0.45 (the first bar tried) also
# caught the header band of «جديد/قديم» labels, which reaches 0.50 because
# fourteen words share one baseline — so the bar sits well above that, not near it.
RULE_DENSITY = 0.60
RULE_DARK = 128  # 8-bit level below which a pixel counts as printed
RULE_GAP = 2  # scanlines a rule may lose to JPEG noise and still read as one rule
RULE_TOLERANCE = 2  # px of disagreement with the fallback grid we accept in silence

# Cells are inset before they are read, so no cell can see its own borders. The
# outer border of the table is drawn thick, hence the second, larger inset.
INSET = 4
THICK_INSET = 9
THICK_RULE = 3  # a detected rule wider than this is one of the thick outer ones

# --- Reading a cell ------------------------------------------------------------

MIN_BLOB = 6  # px; below this it is JPEG speckle, not ink
X_OVERLAP_MERGE = 0.55  # share of the narrower box: above it, the two are one glyph
GLYPH_W, GLYPH_H = 24, 32
DIGIT_SCORE = 0.90  # under this a cell holds no number at all — it is the word «جديد»
MIN_SCORE_GAP = 0.10  # how far apart the two populations must sit for the cut to mean anything


def find_rules(dark, axis):
    """Rule positions along one axis, as (centre, thickness) pairs.

    `dark` is the ink mask and `axis` the one to average over, so axis=0 scans for
    vertical rules and axis=1 for horizontal ones.
    """
    density = dark.mean(axis=axis)
    runs = []
    start = None
    for i, value in enumerate(density):
        if value > RULE_DENSITY:
            if start is None:
                start = i
        elif start is not None:
            runs.append([start, i])
            start = None
    if start is not None:
        runs.append([start, len(density)])
    if not runs:
        return []

    merged = [runs[0]]
    for run in runs[1:]:
        if run[0] - merged[-1][1] <= RULE_GAP:
            merged[-1][1] = run[1]
        else:
            merged.append(run)
    return [((a + b - 1) / 2, b - a) for a, b in merged]


def keep_uniform(rules):
    """Drop rules that are not part of the evenly spaced data grid.

    The header row of «جديد/قديم» labels is boxed too, so the scan finds one rule
    above the table body that no data row owns. Row pitch is constant everywhere
    else, so the data band is simply the longest stretch of near-median gaps.
    """
    if len(rules) < 3:
        return rules
    gaps = np.diff([c for c, _ in rules])
    pitch = float(np.median(gaps))
    ok = np.abs(gaps - pitch) <= 0.25 * pitch
    best_i = best_n = 0
    i = 0
    while i < len(ok):
        if not ok[i]:
            i += 1
            continue
        j = i
        while j < len(ok) and ok[j]:
            j += 1
        if j - i > best_n:
            best_i, best_n = i, j - i
        i = j
    return rules[best_i:best_i + best_n + 1]


def resolve(detected, fallback, label, report):
    """Use the detector when it agrees with the stored grid, and say so when not."""
    centres = [int(round(c)) for c, _ in detected]
    agrees = len(centres) == len(fallback) and all(
        abs(a - b) <= RULE_TOLERANCE for a, b in zip(centres, fallback)
    )
    if agrees:
        report(f"  {label}: {len(centres)} rules detected, agree with the stored grid")
        return detected
    report(f"  {label}: detection DISAGREES with the stored grid — using the constants")
    report(f"    detected: {centres}")
    report(f"    stored  : {list(fallback)}")
    # Thickness is unknown for the fallback, so only the outer two count as thick.
    return [
        (float(c), THICK_RULE + 1 if i in (0, len(fallback) - 1) else 1)
        for i, c in enumerate(fallback)
    ]


def inset_for(thickness):
    return THICK_INSET if thickness > THICK_RULE else INSET


def cell_of(gray, rules_v, rules_h, col, row):
    (x0, tx0), (x1, tx1) = rules_v[col], rules_v[col + 1]
    (y0, ty0), (y1, ty1) = rules_h[row], rules_h[row + 1]
    return gray[
        int(y0 + inset_for(ty0)):int(y1 - inset_for(ty1)),
        int(x0 + inset_for(tx0)):int(x1 - inset_for(tx1)),
    ]


def binarise(cell):
    """Ink mask for one cell, with a threshold taken from that cell alone.

    Seven pastel fills run through the table (pink, blue, lilac, cream...). A
    single global threshold either swallows the ink on the darker fills or
    promotes the fill itself to ink on the lighter ones, so each cell gets its
    own: the midpoint between fill and ink where a fill exists, and a fixed step
    below the paper level where the cell is plain.
    """
    p2, p75 = np.percentile(cell, [2, 75])
    threshold = (p75 + p2) / 2 if p75 - p2 > 45 else p75 - 40
    return cell < threshold


def segment(mask):
    """Glyph boxes in a cell, left to right, with speckle dropped.

    Returns (cleaned mask, boxes). Arabic-Indic numerals run left to right like
    Western ones, so x order is most-significant-digit first.
    """
    labels, count = ndimage.label(mask, structure=np.ones((3, 3), dtype=int))
    if count == 0:
        return mask, []
    sizes = ndimage.sum_labels(mask, labels, index=np.arange(1, count + 1))
    big = sizes >= MIN_BLOB
    clean = np.isin(labels, np.flatnonzero(big) + 1)

    boxes = [
        [xs.start, xs.stop, ys.start, ys.stop]
        for (ys, xs), keep in zip(ndimage.find_objects(labels), big)
        if keep
    ]
    boxes.sort(key=lambda b: b[0])

    # A letter's dots sit above or below its stroke, never beside it, so anything
    # sharing most of its x span with a neighbour is one glyph together with it.
    fused = True
    while fused:
        fused = False
        for i in range(len(boxes) - 1):
            a, b = boxes[i], boxes[i + 1]
            overlap = min(a[1], b[1]) - max(a[0], b[0])
            if overlap > X_OVERLAP_MERGE * min(a[1] - a[0], b[1] - b[0]):
                boxes[i:i + 2] = [[
                    min(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), max(a[3], b[3]),
                ]]
                fused = True
                break
    return clean, boxes


def glyph_vector(clean, box):
    """One glyph as a unit-norm vector, so a dot product is a cosine similarity."""
    x0, x1, y0, y1 = box
    patch = (clean[y0:y1, x0:x1] * 255).astype(np.uint8)
    resized = Image.fromarray(patch).resize((GLYPH_W, GLYPH_H), Image.LANCZOS)
    vector = np.asarray(resized, dtype=np.float64).ravel() / 255.0
    norm = np.linalg.norm(vector)
    return vector / norm if norm else vector


def read_cell(gray, rules_v, rules_h, col, row):
    clean, boxes = segment(binarise(cell_of(gray, rules_v, rules_h, col, row)))
    return [glyph_vector(clean, box) for box in boxes]


# --- The three passes ----------------------------------------------------------


def learn_digits(gray, rules_v, rules_h, report):
    """Digit templates, labelled by the جديد column's already-known value."""
    bank, labels, skipped = [], [], []
    for pair, (new_col, _) in enumerate(PAIRS):
        for row in range(ROWS_PER_PAIR):
            section = pair * ROWS_PER_PAIR + row + 1
            if section > LAST_MAPPED:
                continue
            expected = str(section)
            glyphs = read_cell(gray, rules_v, rules_h, new_col, row)
            # A cell that did not split into exactly the digits we know are in it
            # teaches nothing reliable, so it is left out rather than guessed at.
            if len(glyphs) != len(expected):
                skipped.append((section, len(glyphs)))
                continue
            for glyph, digit in zip(glyphs, expected):
                bank.append(glyph)
                labels.append(int(digit))
    used = LAST_MAPPED - len(skipped)
    report(f"  templates : {len(bank)} glyphs, from {used} of {LAST_MAPPED} جديد cells")
    if skipped:
        report(f"  skipped   : {skipped}")
    return np.array(bank), np.array(labels)


def leave_one_out(bank, labels):
    """Every template classified by all the others.

    Below 100% the ten shapes are not actually separable at this resolution, and
    no reading of the قديم column could be trusted.
    """
    scores = bank @ bank.T
    np.fill_diagonal(scores, -np.inf)
    predicted = labels[scores.argmax(axis=1)]
    return int((predicted == labels).sum()), len(labels)


def read_old_column(gray, rules_v, rules_h, bank, labels, report):
    """The قديم column, read with the learned templates."""
    mapping, brand_new, scored = {}, [], []
    for pair, (_, old_col) in enumerate(PAIRS):
        for row in range(ROWS_PER_PAIR):
            section = pair * ROWS_PER_PAIR + row + 1
            if section > LAST_MAPPED:
                continue
            glyphs = read_cell(gray, rules_v, rules_h, old_col, row)
            if not glyphs:
                raise SystemExit(f"FAIL: section {section} has an empty قديم cell")
            matches = [bank @ glyph for glyph in glyphs]
            # The worst glyph decides: one letter of «جديد» scoring badly is proof
            # enough that the cell is not a number.
            score = min(float(match.max()) for match in matches)
            scored.append((section, score))
            if score < DIGIT_SCORE:
                brand_new.append(section)
            else:
                mapping[section] = int(
                    "".join(str(labels[int(match.argmax())]) for match in matches)
                )

    report("  cell scores (worst glyph similarity in the cell):")
    for low in np.arange(0.60, 1.0, 0.05):
        hits = sum(1 for _, s in scored if low <= s < low + 0.05)
        report(f"    {low:.2f}–{low + 0.05:.2f} {'#' * min(hits, 60):<60} {hits}")
    numbers = [s for n, s in scored if n in mapping]
    words = [s for n, s in scored if n not in mapping]
    report(f"  numbers   : {len(numbers)} cells, worst {min(numbers):.4f}")
    report(f"  «جديد»    : {len(words)} cells, best  {max(words):.4f}" if words else
           "  «جديد»    : none")
    # The cut at DIGIT_SCORE is only defensible while nothing lands near it.
    if words and min(numbers) - max(words) < 0.05:
        raise SystemExit(
            f"FAIL: the scores are not bimodal — numbers reach down to {min(numbers):.4f} "
            f"and «جديد» up to {max(words):.4f}, so the cut at {DIGIT_SCORE} is arbitrary"
        )
    return mapping, brand_new


# --- Validation and output -----------------------------------------------------


def validate(mapping, brand_new, bank, labels, report):
    """Everything that must hold before the JSON may be replaced."""
    problems = []
    olds = sorted(mapping.values())

    outside = [n for n in olds if not 1 <= n <= 300]
    if outside:
        problems.append(f"old numbers outside 1..300: {outside}")

    seen = {}
    for new, old in mapping.items():
        seen.setdefault(old, []).append(new)
    twice = {old: news for old, news in seen.items() if len(news) > 1}
    if twice:
        problems.append(f"old numbers used more than once: {twice}")

    if olds:
        gaps = sorted(set(range(olds[0], olds[-1] + 1)) - set(olds))
        if gaps:
            problems.append(f"gaps in the old numbering: {gaps}")
        if olds[0] != 1:
            problems.append(f"old numbering starts at {olds[0]}, not 1")
    else:
        problems.append("no section was mapped at all")

    covered = len(mapping) + len(brand_new)
    if covered != LAST_MAPPED:
        problems.append(
            f"{len(mapping)} mapped + {len(brand_new)} «جديد» = {covered}, "
            f"not the {LAST_MAPPED} sections the page covers"
        )

    correct, total = leave_one_out(bank, labels)
    if correct != total:
        problems.append(f"digit bank fails leave-one-out: {correct}/{total}")

    report("")
    report("validation")
    report(f"  mapped     : {len(mapping)}")
    report(f"  «جديد»     : {len(brand_new)}")
    report(f"  old range  : {olds[0]}..{olds[-1]}, each used once, no gaps" if olds and not problems
           else f"  old range  : {olds[:3]}… (see failures below)")
    report(f"  digit bank : {correct}/{total} leave-one-out")
    return problems


def total_sections(report):
    """How many sections the catalogue really has, so «uncovered» is not guessed."""
    try:
        return int(json.loads(FORMS.read_text(encoding="utf-8"))["عدد_النماذج"])
    except Exception as error:  # noqa: BLE001 — every failure here has one answer
        report(f"  (forms.json unreadable: {error}; assuming {TOTAL_SECTIONS} sections)")
        return TOTAL_SECTIONS


NOTE = (
    "خريطة ترقيم الأقسام: القسم الجديد -> القسم القديم. مستخرجة آليًا من "
    "data/source/section-map-page1.jpg (جدول «مقارنة الأقسام الجديدة بالأقسام القديمة»)، "
    "ثم تُحقق منها: الأرقام القديمة 1..225 كلٌّ منها مرة واحدة بلا فجوات ولا تكرار، "
    "و12 صفًا عشوائيًا طوبقت بصريًا."
)


def payload(mapping, brand_new, total):
    olds = sorted(mapping.values())
    return {
        "_note": NOTE,
        "source": SRC.relative_to(ROOT).as_posix(),
        "covers": f"الأقسام الجديدة 1..{LAST_MAPPED}",
        "old_range": f"{olds[0]}..{olds[-1]}",
        "brand_new": sorted(brand_new),
        "unmapped_new": list(range(LAST_MAPPED + 1, total + 1)),
        "map": {str(new): mapping[new] for new in sorted(mapping)},
    }


def main():
    parser = argparse.ArgumentParser(description="Rebuild data/source/section-map.json.")
    parser.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    args = parser.parse_args()

    # Arabic in the report would die on a cp1252 console otherwise.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    def report(line):
        print(line)

    gray = np.asarray(Image.open(SRC).convert("L"), dtype=np.float64)
    report(f"source: {SRC.name}  {gray.shape[1]}x{gray.shape[0]}")

    dark = gray < RULE_DARK
    report("grid")
    rules_v = resolve(find_rules(dark, axis=0), FALLBACK_V, "vertical  ", report)
    rules_h = resolve(keep_uniform(find_rules(dark, axis=1)), FALLBACK_H, "horizontal", report)
    if len(rules_v) != len(FALLBACK_V) or len(rules_h) != len(FALLBACK_H):
        raise SystemExit(
            f"FAIL: expected a {len(FALLBACK_V) - 1}x{len(FALLBACK_H) - 1} grid, "
            f"found {len(rules_v) - 1}x{len(rules_h) - 1}"
        )

    report("")
    report("learning the digits from the جديد column")
    bank, labels = learn_digits(gray, rules_v, rules_h, report)
    if not len(bank):
        raise SystemExit("FAIL: no digit template could be learned")

    report("")
    report("reading the قديم column")
    mapping, brand_new = read_old_column(gray, rules_v, rules_h, bank, labels, report)

    problems = validate(mapping, brand_new, bank, labels, report)
    if problems:
        report("")
        for problem in problems:
            report(f"FAIL: {problem}")
        raise SystemExit(f"{OUT.name} was NOT written — fix the reading first")

    report("")
    data = payload(mapping, brand_new, total_sections(report))
    # Byte for byte what the committed file holds: one-space indent, real Arabic,
    # no trailing newline, and the platform's line endings (it is built on Windows).
    text = json.dumps(data, ensure_ascii=False, indent=1)

    if args.dry_run:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else None
        verdict = "matches" if current == text else "DIFFERS FROM"
        report(f"dry run: the reading {verdict} the committed {OUT.name}")
        return

    OUT.write_text(text, encoding="utf-8")
    report(
        f"wrote {OUT.relative_to(ROOT).as_posix()} — {len(data['map'])} mapped, "
        f"{len(data['brand_new'])} «جديد», {len(data['unmapped_new'])} still uncovered"
    )


if __name__ == "__main__":
    main()
