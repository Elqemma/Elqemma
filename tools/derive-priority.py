#!/usr/bin/env python3
"""
derive-priority.py — «زبدة الأقسام», derived rather than asserted.

    python tools/derive-priority.py            # report only
    python tools/derive-priority.py --write    # also update data/source/priority.json

Needs nothing but the standard library.

WHAT IT PRODUCES
----------------
«زبدة الأقسام» is a ranked list: a reference compilation numbers the sections
that recur most from 1 to N, most recurring first, and the site shows them in
that order and with those numbers. This script reads that compilation, finds
which of the 301 sections each entry IS, and writes the list in its own order —
each entry as the export's section number, or, for an entry the 301 do not
hold, as a placeholder that keeps its place until a form is made for it.

The reference compilation is never named — not in this script, not in the data
it writes, not on the site. The teacher asked (2026-09-24) that the platform
not state its source, which is why its path comes from the environment.

HOW THE MATCH IS MADE
---------------------
Not by section title. The reference compilation names its sections after
different passages than the 301 file does — «الرشاشات وعمالة الأطفال» there is
«التدرج والتغيير في خصائص المجتمعات» here, question for question — so titles
disagree even when the content is identical.

The questions themselves are the stable unit. Question numbers and option
letters are stripped (the two files mark them differently), and every six-word
window of what is left is a fingerprint; a window that appears in more than two
of the 301 sections is boilerplate («اختر المفردة الشاذة») and is discarded.

An entry IS a section of the 301 when the match holds both ways: nearly all of
the entry's distinctive text is in that section, and most of the section's is
in the entry. One way only is not enough — an entry that re-pairs two passages
the 301 keep in separate sections is found inside both, and is neither.

The evidence comes out cleanly bimodal: in the current compilation every
matched entry shares 99%+ of its text one way and 88%+ the other, and every
unmatched one falls far short on at least one side.

SOURCES (not in this repository)
--------------------------------
    QIMMA_SOURCES         the folder holding
                          تجميعات اللفظي - الأقسام 1 إلى 301 - بدون حل.docx
                          (or edit BASE below)
    QIMMA_PRIORITY_DOCX   the ranked reference compilation, a .docx. Required,
                          and deliberately not written down anywhere here.
The derived list is committed, so this script only needs to run when one of
those documents changes.
"""

import argparse
import datetime
import json
import os
import re
import sys
import unicodedata
import zipfile
from collections import Counter
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

# Both shares sit in the empty middle of the bimodal distribution, so neither
# is delicate. MIN_WINDOWS keeps a two-line entry from matching on a phrase.
MIN_SHARE_OF_ENTRY = 0.80
MIN_SHARE_OF_SECTION = 0.50
MIN_WINDOWS = 20
WINDOW = 6

DIACRITICS = re.compile(r"[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]")
DIGITS = r"[0-9\u0660-\u0669]+"
CATALOGUE_HEADING = re.compile(rf"^\s*القسم\s*[\(（]?\s*({DIGITS})\s*[\)）]?\s*$")
# «◄ 3- …» in the 301 file, «3 ▸ …» in the reference; «أ) …» and «أ …» for options.
QUESTION_MARK = re.compile(rf"^\s*◄?\s*{DIGITS}\s*[-▸]\s*")
OPTION_MARK = re.compile(r"^\s*[أبجد]\s*[)\s]\s*")
QUESTION = re.compile(rf"^\s*{DIGITS}\s*▸")


def arabic_int(text):
    return int(re.sub(r"[\u0660-\u0669]", lambda m: str(ord(m.group()) - 0x0660), text.strip()))


def fold(text):
    """The site search's folding, minus every digit: numbering is not content."""
    text = unicodedata.normalize("NFKC", str(text))
    text = DIACRITICS.sub("", text)
    for a, b in (("آ", "ا"), ("أ", "ا"), ("إ", "ا"), ("ٱ", "ا"),
                 ("ة", "ه"), ("ى", "ي"), ("ؤ", "و"), ("ئ", "ي")):
        text = text.replace(a, b)
    text = re.sub(r"[^\w\s]|\d", " ", text)
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


def body(para):
    return OPTION_MARK.sub("", QUESTION_MARK.sub("", para))


def split_catalogue(paras):
    """The 301 file: «القسم ( n )» on a line of its own, its title on the next."""
    sections, titles, current = {}, {}, None
    for i, para in enumerate(paras):
        heading = CATALOGUE_HEADING.match(para)
        if heading:
            current = arabic_int(heading.group(1))
            sections[current], titles[current] = [], paras[i + 1] if i + 1 < len(paras) else ""
            continue
        if current is not None:
            sections[current].append(body(para))
    return sections, titles


def split_reference(paras):
    """
    The reference: «القسم», its rank and its title on three lines. Its table of
    contents comes first and has no «القسم» line, so it is never read as a section.
    """
    entries, i = [], 0
    while i < len(paras):
        if paras[i].strip() == "القسم" and i + 2 < len(paras) and re.fullmatch(DIGITS, paras[i + 1].strip()):
            entries.append({"rank": arabic_int(paras[i + 1]), "title": paras[i + 2].strip(), "paras": [], "q": 0})
            i += 3
            continue
        if entries:
            entries[-1]["paras"].append(body(paras[i]))
            if QUESTION.match(paras[i]):
                entries[-1]["q"] += 1
        i += 1
    return entries


def windows(paras):
    words = fold(" ".join(paras)).split()
    return {" ".join(words[i:i + WINDOW]) for i in range(max(0, len(words) - WINDOW + 1))}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="update data/source/priority.json")
    args = parser.parse_args()

    if not DOC_REFERENCE:
        sys.exit("! set QIMMA_PRIORITY_DOCX to the ranked reference compilation (.docx)")

    catalogue, titles = split_catalogue(paragraphs(DOC_301))
    entries = split_reference(paragraphs(Path(DOC_REFERENCE)))
    print(f"the 301 compilation       : {len(catalogue)} sections")
    print(f"the reference compilation : {len(entries)} ranked entries")
    if len(catalogue) != 301:
        sys.exit(f"! expected 301 sections in the catalogue, found {len(catalogue)}")
    ranks = [e["rank"] for e in entries]
    if ranks != list(range(1, len(entries) + 1)):
        sys.exit("! the reference's ranks do not run 1, 2, 3 … without a gap — check the document")
    if not 100 <= len(entries) <= 200:
        sys.exit(f"! {len(entries)} entries is far from a shortlist — check the sources")

    fp_catalogue = {n: windows(p) for n, p in catalogue.items()}
    seen = Counter()
    for fingerprints in fp_catalogue.values():
        seen.update(fingerprints)
    distinctive = {w for w, count in seen.items() if count <= 2}
    own = {n: f & distinctive for n, f in fp_catalogue.items()}

    rows, claimed = [], {}
    for entry in entries:
        mine = windows(entry["paras"]) & distinctive
        candidates = []
        for n, theirs in own.items():
            shared = len(mine & theirs)
            if shared:
                candidates.append((shared / len(mine), shared / max(1, len(theirs)), shared, n))
        candidates.sort(reverse=True)
        best = candidates[0] if candidates else None
        is_section = bool(
            best
            and best[0] >= MIN_SHARE_OF_ENTRY
            and best[1] >= MIN_SHARE_OF_SECTION
            and best[2] >= MIN_WINDOWS
        )
        if is_section:
            if best[3] in claimed:
                sys.exit(f"! entries {claimed[best[3]]} and {entry['rank']} both match section {best[3]}")
            claimed[best[3]] = entry["rank"]
        rows.append({**entry, "windows": len(mine), "best": best, "match": best[3] if is_section else None,
                     "near": [c for c in candidates[:2] if c[0] >= 0.1]})

    matched = [r for r in rows if r["match"]]
    missing = [r for r in rows if not r["match"]]
    if matched:
        print(f"\nmatched: {len(matched)} — weakest shares "
              f"{min(r['best'][0] for r in matched):.2f} of the entry, "
              f"{min(r['best'][1] for r in matched):.2f} of the section")
    print(f"not among the 301: {len(missing)}")
    for r in missing:
        near = ", ".join(f"#{c[3]} «{titles[c[3]]}» {c[0]:.2f}/{c[1]:.2f}" for c in r["near"]) or "nothing"
        print(f"  {r['rank']:>3}  {r['title']}  ({r['q']} questions) — closest: {near}")

    if not args.write:
        print("\n(report only — pass --write to update data/source/priority.json)")
        return

    existing = json.loads(OUT_FILE.read_text(encoding="utf-8")) if OUT_FILE.exists() else {}
    # The visitor-facing words are the teacher's to change in the file itself;
    # a re-run keeps them.
    existing.setdefault("label", "زبدة الأقسام")
    existing.setdefault("short", "الزبدة")
    existing.setdefault("blurb", "أقسام يتكرّر ورودها أكثر من غيرها في التجميعات المتداولة، مرقّمة بالترتيب — ابدأ من أولها إذا كان وقتك ضيقًا.")
    existing.update({
        "_note": (
            "قائمة مشتقّة، لا مُدخلة يدويًا. تُعاد بـ: python tools/derive-priority.py --write. "
            "الترتيب هو ترتيب التجميعة المرجعية من 1 إلى آخرها، ويطابق السكربت نص أسئلة كل قسم فيها "
            "على الأقسام الـ301. n رقم القسم في التصدير الأصلي (forms.json)، وt اسمه في التجميعة. "
            "قسم بلا n ليس بين الـ301 ولا نموذج له بعد: يظهر في مكانه بعلامة «قريبًا»، "
            "وحين يُصنع نموذجه ويُضاف إلى forms.json يُكتب رقمه في n."
        ),
        "updated": datetime.date.today().isoformat(),
        "method": {
            "matched_on": "نص الأسئلة بلا أرقامها ولا حروف خياراتها، بنوافذ من ست كلمات، بعد استبعاد النص المتكرّر في أكثر من قسمين",
            "min_share_of_entry": MIN_SHARE_OF_ENTRY,
            "min_share_of_section": MIN_SHARE_OF_SECTION,
            "min_windows": MIN_WINDOWS,
        },
        "sections": [
            {"n": r["match"], "t": r["title"]} if r["match"] else {"t": r["title"], "q": r["q"]}
            for r in rows
        ],
    })
    OUT_FILE.write_text(json.dumps(existing, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {OUT_FILE.relative_to(ROOT)} — {len(rows)} entries, {len(missing)} waiting for a form")
    print("now run: npm run build:data")


if __name__ == "__main__":
    main()
