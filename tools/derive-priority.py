#!/usr/bin/env python3
"""
derive-priority.py — «زبدة الأقسام», derived rather than asserted.

    python tools/derive-priority.py            # report only
    python tools/derive-priority.py --write    # also update data/source/priority.json

Needs nothing but the standard library.

WHY THIS EXISTS
---------------
«زبدة الأقسام» — the sections that recur most — is a real, checkable claim, and a site that makes it
should be able to show its work. The claim does not come from either teacher's
opinion: it comes from a separate reference compilation that collects the
passages recurring most in the real exam.

That compilation is never named — not in this script, not in the data it
writes, not on the site. The teacher asked (2026-09-24) that the platform not
state its source, which is why its path comes from the environment.

Both this site and الأستاذ أحمد طلعت's site index the SAME 301-section
compilation — 300 of the 301 topics are identical, the odd one out being a
spelling variant of المدرسة المونتيسورية. So «which of the 301 are the recurring
ones» is a property of the content, not of either teacher, and the same answer
holds for both sites.

HOW THE MATCH IS MADE
---------------------
Not by section title. The two compilations pair their passages differently —
the reference compilation joins passages that the 301 file keeps in separate
sections — so titles disagree even when the content is identical.
Matching on titles produced obvious nonsense («العصافير» → «الدعاء»).

The questions themselves are the stable unit. Every six-word window of a
section's text is a fingerprint; a window that appears in more than two of the
301 sections is boilerplate («اختر المفردة الشاذة») and is discarded. What is
left identifies a section almost uniquely, and survives the light editing the
reference compilation applied to the text it borrowed.

The evidence then comes out cleanly bimodal — 125 of the 301 sections share
90%+ of a reference section's distinctive text, 159 share none at all, and only
a handful sit in between — which is what a real correspondence looks like and a
coincidence does not.

SOURCES (not in this repository)
--------------------------------
    QIMMA_SOURCES         the folder holding
                          تجميعات اللفظي - الأقسام 1 إلى 301 - بدون حل.docx
                          (or edit BASE below)
    QIMMA_PRIORITY_DOCX   the reference compilation itself, a .docx. Required,
                          and deliberately not written down anywhere here.
The derived list is committed, so this script only needs to run when one of
those documents changes.
"""

import argparse
import json
import os
import re
import sys
import unicodedata
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_FILE = ROOT / "data" / "source" / "priority.json"

BASE = Path(
    os.environ.get(
        "QIMMA_SOURCES",
        r"D:\study\0000-project\الاستاذ  أحمد طلعت\تجميعات اللفظي\الملف الكبير\new",
    )
)
DOC_301 = BASE / "تجميعات اللفظي - الأقسام 1 إلى 301 - بدون حل.docx"
# No default on purpose: the file's name would name the compilation.
DOC_REFERENCE = os.environ.get("QIMMA_PRIORITY_DOCX")

# A window has to carry a real share of a reference section's distinctive text,
# and a real number of windows, before it counts as the source of it. Both sit
# in the empty middle of the bimodal distribution, so neither is delicate.
MIN_SHARE = 0.30
MIN_WINDOWS = 20
WINDOW = 6

DIACRITICS = re.compile(r"[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]")
SECTION_HEADING = re.compile(r"^\s*القسم\s*[\(（]?\s*([0-9\u0660-\u0669]+)\s*[\)）]?\s*$")


def arabic_int(text):
    return int(re.sub(r"[\u0660-\u0669]", lambda m: str(ord(m.group()) - 0x0660), text))


def fold(text):
    """The same folding the site's search uses, so 'the same words' means the same thing."""
    text = unicodedata.normalize("NFKC", str(text))
    text = DIACRITICS.sub("", text)
    for a, b in (("آ", "ا"), ("أ", "ا"), ("إ", "ا"), ("ٱ", "ا"),
                 ("ة", "ه"), ("ى", "ي"), ("ؤ", "و"), ("ئ", "ي")):
        text = text.replace(a, b)
    text = re.sub(r"[\u0660-\u0669]", lambda m: str(ord(m.group()) - 0x0660), text)
    text = re.sub(r"[^\w\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def paragraphs(path):
    if not path.exists():
        sys.exit(f"! missing source document: {path}\n  see SOURCES at the top of this script")
    xml = zipfile.ZipFile(path).read("word/document.xml").decode("utf-8")
    out = []
    for block in re.findall(r"<w:p\b.*?</w:p>", xml, re.S):
        text = "".join(re.findall(r"<w:t[^>]*>(.*?)</w:t>", block, re.S))
        text = re.sub(r"<[^>]+>", "", text)
        text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").strip()
        if text:
            out.append(text)
    return out


def split_sections(paras):
    sections, current = defaultdict(list), None
    for para in paras:
        heading = SECTION_HEADING.match(para)
        if heading:
            current = arabic_int(heading.group(1))
            continue
        if current is not None:
            sections[current].append(para)
    return dict(sections)


def windows(paras):
    words = fold(" ".join(paras)).split()
    return {" ".join(words[i:i + WINDOW]) for i in range(max(0, len(words) - WINDOW + 1))}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="update data/source/priority.json")
    args = parser.parse_args()

    if not DOC_REFERENCE:
        sys.exit("! set QIMMA_PRIORITY_DOCX to the reference compilation (.docx)")

    catalogue = split_sections(paragraphs(DOC_301))
    reference = split_sections(paragraphs(Path(DOC_REFERENCE)))
    print(f"the 301 compilation       : {len(catalogue)} sections")
    print(f"the reference compilation : {len(reference)} sections")
    if len(catalogue) != 301:
        sys.exit(f"! expected 301 sections in the catalogue, found {len(catalogue)}")

    fp_catalogue = {n: windows(p) for n, p in catalogue.items()}
    fp_reference = {n: windows(p) for n, p in reference.items()}

    seen = Counter()
    for fingerprints in fp_catalogue.values():
        seen.update(fingerprints)
    distinctive = {w for w, count in seen.items() if count <= 2}
    print(f"windows: {len(seen)} total, {len(distinctive)} distinctive enough to identify a section")

    # For each of the 301, the strongest correspondence with any reference section.
    evidence = {}
    for n, fingerprints in fp_catalogue.items():
        best = (0.0, 0, None)
        for rn, rf in fp_reference.items():
            r = rf & distinctive
            if not r:
                continue
            shared = len(r & fingerprints)
            share = shared / len(r)
            if share > best[0]:
                best = (share, shared, rn)
        evidence[n] = best

    bands = Counter()
    for share, _, _ in evidence.values():
        bands["none" if share == 0 else f"{int(share * 10) / 10:.1f}"] += 1
    print("\nevidence, over all 301 sections:")
    for key in sorted(bands, key=lambda k: (k == "none", k)):
        print(f"  {key:>5}  {'#' * min(60, bands[key])} {bands[key]}")

    middle = [n for n, (s, w, _) in evidence.items() if 0 < s < MIN_SHARE or (s >= MIN_SHARE and w < MIN_WINDOWS)]
    print(f"\nsections in the ambiguous middle (neither clearly in nor out): {len(middle)}")

    selected = sorted(n for n, (s, w, _) in evidence.items() if s >= MIN_SHARE and w >= MIN_WINDOWS)
    print(f"selected: {len(selected)} sections")

    if not 100 <= len(selected) <= 180:
        sys.exit(f"! {len(selected)} is far from the size of the reference compilation — check the sources")

    if not args.write:
        print("\n(report only — pass --write to update data/source/priority.json)")
        return

    existing = json.loads(OUT_FILE.read_text(encoding="utf-8")) if OUT_FILE.exists() else {}
    existing.update({
        "_note": (
            "قائمة مشتقّة، لا مُدخلة يدويًا. تُعاد بـ: python tools/derive-priority.py --write. "
            "يطابق السكربت نص أسئلة الأقسام على تجميعة مرجعية للقطع الأكثر تكرارًا ويأخذ أرقام "
            "الأقسام المطابقة. "
            "لتعديلها يدويًا: اكتب الأرقام في sections مباشرة، والسكربت لن يعترض — لكن اذكر السبب هنا."
        ),
        "label": "زبدة الأقسام",
        "blurb": "أقسام يتكرّر ورودها أكثر من غيرها في التجميعات المتداولة — ابدأ بها إذا كان وقتك ضيقًا.",
        "method": {
            "matched_on": "نص الأسئلة، بنوافذ من ست كلمات، بعد استبعاد النص المتكرّر في أكثر من قسمين",
            "min_share": MIN_SHARE,
            "min_windows": MIN_WINDOWS,
        },
        "sections": selected,
    })
    OUT_FILE.write_text(json.dumps(existing, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {OUT_FILE.relative_to(ROOT)} — {len(selected)} sections")
    print("now run: npm run build:data")


if __name__ == "__main__":
    main()
