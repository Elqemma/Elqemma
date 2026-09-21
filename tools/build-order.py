#!/usr/bin/env python3
"""
build-order.py — the running order and the names of the 301 sections, read off
the teacher's own compiled document.

    python tools/build-order.py             # report only
    python tools/build-order.py --write     # update data/source/section-order.json

Why this file exists
--------------------
`data/source/forms.json` is the Google Forms export, and its «القسم» numbers are
the order the forms were built in: the compilation that ran to 262 sections,
plus 39 added after it. The teacher has since re-ordered the compilation his
students actually read — the last 20 sections of the 262 moved to the front —
and the site has to agree with that file, in the numbers and in the names.

The export is never edited (it is the single source of truth for the links), so
the new order lives in a small derived file instead, which
`tools/build-data.mjs` applies while it builds `assets/data/exams.json`.

The rule, as the teacher stated it
----------------------------------
    export 243..262  ->  1..20      the last 20 of the 262, moved to the front
    export   1..242  ->  21..262    everything before them, pushed down by 20
    export 263..301  ->  263..301   the 39 added later, untouched

Nothing here takes that rule on trust. The script reads the document's own
index, applies the rule, and then checks all 301 pairs **by name**: the name the
document gives to a number has to be the name the export gives to the number the
rule paired it with. It refuses to write unless every pair agrees, which is what
makes the file safe to regenerate when the document changes.

Two kinds of name are tidied before the comparison, both agreed with the teacher:
a conjunction written as a separate word («مالك و الحياة» -> «مالك والحياة»),
and one spelling of Montessori. Everything else is the document's wording,
character for character.

The document is the teacher's working file and is not in this repository. Set
QIMMA_ORDER_DOCX to it, or edit DOCX below.
"""

import json
import os
import re
import sys
import unicodedata
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FORMS = ROOT / "data" / "source" / "forms.json"
OUT = ROOT / "data" / "source" / "section-order.json"

DOCX = Path(
    os.environ.get(
        "QIMMA_ORDER_DOCX",
        r"D:/study/0000-project/الاستاذ  أحمد طلعت/استاذ عبدالرحمن/الملف الكبير/new"
        r"/تجميعات اللفظي - الأقسام 1 إلى 301 - محلول.docx",
    )
)

TOTAL = 301
MOVED = 20  # how many sections came off the end of the 262 and went to the front
PIVOT = 262  # the last section of the old compilation

# A conjunction is a letter, not a word: the document sometimes types it with a
# space after it, which breaks both the look of the line and a search for the
# joined form.
CONJUNCTION = re.compile(r"(?<![\u0600-\u06FF])و\s+(?=[\u0600-\u06FF])")

# Corrections applied to the document's wording, keyed by the tidied name.
SPELLING = {
    "المدرسة المونتيسيرية والموضوعية": "المدرسة المونتيسورية والموضوعية",
}

DIACRITICS = re.compile(r"[\u064B-\u0652\u0640\u0670]")


def new_number(src):
    """The section's number in the teacher's re-ordered document."""
    if src > PIVOT:
        return src
    if src > PIVOT - MOVED:
        return src - (PIVOT - MOVED)
    return src + MOVED


def tidy(title):
    t = re.sub(r"\s+", " ", title).strip()
    t = CONJUNCTION.sub("و", t)
    return SPELLING.get(t, t)


def compare(text):
    """Fold a name down to what two spellings of it have in common."""
    s = unicodedata.normalize("NFKC", str(text))
    s = DIACRITICS.sub("", s)
    s = re.sub(r"[\u0622\u0623\u0625\u0671]", "\u0627", s)
    s = s.replace("\u0649", "\u064a").replace("\u0629", "\u0647")
    s = re.sub(r"[^\w\u0600-\u06FF]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def paragraphs(path):
    """Every non-empty paragraph of a .docx, in document order."""
    xml = zipfile.ZipFile(path).read("word/document.xml").decode("utf-8")
    out = []
    for block in re.findall(r"<w:p[ >].*?</w:p>", xml, re.S):
        text = "".join(re.findall(r"<w:t[^>]*>(.*?)</w:t>", block, re.S))
        text = re.sub(r"<[^>]+>", "", text)
        text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").strip()
        if text:
            out.append(text)
    return out


def read_index(path):
    """
    The document's own «فهرس الأقسام», as {number: name}.

    The index is set in two columns, so the paragraphs arrive interleaved
    (1, 23, 2, 24, …); the number is printed in each line, so the order they are
    read in does not matter. Reading stops at the first body heading, so a
    «(3)» inside a passage further down cannot be mistaken for an index line.
    """
    entry = re.compile(r"^\((\d{1,3})\)\s*(.+)$")
    body = re.compile(r"^\s*القسم\s*\(")
    index = {}
    for text in paragraphs(path):
        if body.match(text):
            break
        found = entry.match(text)
        if found:
            index.setdefault(int(found.group(1)), found.group(2).strip())
    return index


def main(write):
    if not DOCX.exists():
        sys.exit(f"the document is not where this script expects it:\n  {DOCX}\n"
                 "set QIMMA_ORDER_DOCX to it.")

    index = read_index(DOCX)
    print(f"document : {DOCX.name}")
    print(f"index    : {len(index)} sections, {min(index)}..{max(index)}")
    gaps = [n for n in range(1, TOTAL + 1) if n not in index]
    if gaps or len(index) != TOTAL:
        sys.exit(f"the index does not cover 1..{TOTAL} — missing {gaps[:20]}")

    export = {
        int(form["القسم"]): str(form["الموضوع"]).strip()
        for form in json.loads(FORMS.read_text(encoding="utf-8"))["النماذج"]
    }
    print(f"export   : {len(export)} forms, {min(export)}..{max(export)}")

    sections, disagree, tidied = [], [], 0
    for src in sorted(export):
        n = new_number(src)
        raw = index.get(n)
        if raw is None:
            disagree.append((n, src, "—", export[src]))
            continue
        title = tidy(raw)
        if title != raw:
            tidied += 1
        if compare(title) != compare(export[src]):
            disagree.append((n, src, title, export[src]))
        sections.append({"n": n, "from": src, "t": title})

    sections.sort(key=lambda s: s["n"])
    print(f"tidied   : {tidied} names (a conjunction joined, or a spelling fixed)")
    print(f"agree    : {len(sections) - len(disagree)} of {len(sections)} names match the export")

    if disagree:
        print("\nthese pairs do not agree, so nothing was written:")
        for n, src, doc_title, export_title in disagree[:25]:
            print(f"  new {n:>3} (export {src:>3})")
            print(f"    document: {doc_title}")
            print(f"    export  : {export_title}")
        sys.exit(1)

    moved = [s for s in sections if s["n"] != s["from"]]
    print(f"moved    : {len(moved)} sections change number, "
          f"{len(sections) - len(moved)} keep theirs")

    if not write:
        print("\nreport only — pass --write to update data/source/section-order.json")
        return

    payload = {
        "_note": (
            "ترتيب الأقسام وأسماؤها كما في ملف الأستاذ «تجميعات اللفظي — الأقسام 1 إلى 301». "
            "مشتق آليًا، لا مُدخل يدويًا: يُعاد بـ python tools/build-order.py --write. "
            "«from» هو رقم القسم في التصدير الأصلي data/source/forms.json، وهو الذي يحمل الرابط؛ "
            "«n» هو رقمه في الملف الجديد. آخر عشرين قسمًا من الـ262 انتقلت إلى المقدمة."
        ),
        "source": DOCX.name,
        "generated": date.today().isoformat(),
        "count": len(sections),
        "moved": len(moved),
        "rule": f"{PIVOT - MOVED + 1}..{PIVOT} -> 1..{MOVED}; 1..{PIVOT - MOVED} -> "
                f"{MOVED + 1}..{PIVOT}; {PIVOT + 1}..{TOTAL} unchanged",
        "verified": "every name matched the same section's name in forms.json",
        "sections": sections,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"\nwritten  : {OUT.relative_to(ROOT).as_posix()}")


if __name__ == "__main__":
    main(write="--write" in sys.argv[1:])
