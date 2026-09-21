#!/usr/bin/env python3
"""
build-photos.py — brand mark, the teacher's photos and the students' chat
screenshots, from the untouched originals in data/source/ to the web-ready
files in assets/img/.

    python tools/build-photos.py            # everything
    python tools/build-photos.py proof      # only the chat screenshots (fast)

Needs Pillow + numpy + scipy, and rembg for the matte
(`pip install "rembg[cpu]"`; the model downloads once, ~180 MB).
Run it only when an original changes — the outputs are committed.

What it makes

1. mark-*.webp / logo-256.png / favicon-* / maskable-*   (the seal)
   Source: data/source/brand/logo-seal.jpg — the royal-blue and gold seal on
   white. It is trimmed to its own artwork, then centred on a white square so
   the mark reads identically in the light and the dark theme (only the rim
   and the shadow around it adapt in CSS).

2. teacher-photo-*.webp (4:5) / teacher-photo-tall-*.webp (2:3)
   Sources: data/source/photos/teacher-headshot.jpg (head and shoulders) and
   teacher-standing.jpg (standing, holding a certificate) — two photographs the
   teacher supplied, each already lit, graded and shot against its own
   shallow-focus background.

   **Nothing is cut out and no background is replaced.** An earlier version of
   this script matted him off a phone screenshot and painted a navy backdrop
   behind him; these photographs do not need it, and he asked for them to be
   left as they are. All that happens here is framing: each output is the
   largest window of the requested ratio that fits inside the photograph,
   centred on his head, plus a light unsharp mask. The matte is read only to
   find where his head is — it is never composited — so a replacement
   photograph reframes itself instead of needing new numbers.

   The 4:5 medium shot carries the hero and the home page's teacher band; the
   2:3 crop is the profile page, where his hands and the certificate stay in
   the frame.

3. teacher-portrait-*.webp / .jpg   (square, shown as a circle)
   The head-and-shoulders photograph again, framed tight. The .jpg copy is what
   structured data and the share card point at: Google asks that images used in
   structured data carry no text, and this one carries none.

4. teacher-award-*.webp   (4:5)
   Source: data/source/photos/teacher-award.jpg — a phone screenshot of him
   being handed a certificate at an event. The chat chrome above and below the
   photo is cropped away, then the photo is lightly sharpened and given a touch
   more contrast. It is the one documentary photograph on the site, which is
   why it is kept as it is rather than restaged.

5. proof/chat-*.webp   (the students' WhatsApp messages)
   Source: data/source/testimonials/chat-*.jpg — screenshots the students sent
   after their results, names already hidden by the teacher. Each is cropped to
   the conversation itself (no status bar, no contact header, no input bar).
   Two of them were redacted with an orange marker; that scribble is replaced
   by a flat patch of the surrounding bubble colour, so the redaction reads as
   deliberate rather than messy. Nothing else in the message is touched.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "source"
OUT = ROOT / "assets" / "img"
PROOF = OUT / "proof"

# Crop, in original pixels, measured once on the award screenshot.
AWARD_CONTENT = (0, 158, 579, 1172)  # between the chat header and the reply bar

# The chat screenshots: (output name, source, crop box or None, has orange marker)
# Boxes are in source pixels and keep only the conversation area.
CHATS = [
    ("chat-1", "chat-1.jpg", (0, 0, 1199, 1085), False),
    ("chat-2", "chat-2.jpg", (0, 385, 1141, 1435), False),
    ("chat-3", "chat-3.jpg", None, False),
    ("chat-4", "chat-4.jpg", (0, 278, 972, 1150), True),
    ("chat-5", "chat-5.jpg", None, False),
    ("chat-6", "chat-6.jpg", (0, 178, 579, 1195), True),
]


# --- helpers -------------------------------------------------------------------


def save_webp(img, name, width, quality=82, folder=OUT):
    h = round(img.height * width / img.width)
    out = img if img.width == width else img.resize((width, h), Image.LANCZOS)
    out.save(folder / name, "WEBP", quality=quality, method=6)
    print(f"  {name:<32} {width}x{h}")
    return width, h


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def trim_to_content(img, tol=735):
    """Bounding box of everything that is not near-white."""
    a = np.asarray(img.convert("RGB")).astype(int)
    mask = a.sum(axis=2) < tol
    ys, xs = np.where(mask)
    return img.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def matte(img):
    """Alpha matte of the person, 0..1, same size as `img`."""
    from rembg import new_session, remove

    cut = remove(img, session=new_session("isnet-general-use"), post_process_mask=True)
    return np.asarray(cut.convert("RGBA"))[:, :, 3].astype(np.float32) / 255.0


def head_centre(alpha, thr=0.5, band=0.22, min_run=0.012):
    """
    (x centre of the head, y of the top of the head).

    A row counts as part of him only once it is more than `min_run` of the frame
    wide, so a speck the matte picked out of a blurred bookshelf cannot be
    mistaken for the top of his hair.
    """
    solid = alpha > thr
    floor = max(2, round(alpha.shape[1] * min_run))
    rows = np.where(solid.sum(axis=1) > floor)[0]
    y0, y1 = int(rows.min()), int(rows.max())
    top_band = solid[y0 : y0 + max(1, round((y1 - y0) * band)), :]
    return int(np.median(np.where(top_band)[1])), y0


def polish(img, radius=1.2, percent=35, contrast=1.03):
    """A light pass only: these photographs arrive already lit and graded."""
    out = img.filter(ImageFilter.UnsharpMask(radius=radius, percent=percent, threshold=3))
    return ImageEnhance.Contrast(out).enhance(contrast)


def frame(img, alpha, ratio_w, ratio_h, headroom=0.06, height=1.0):
    """
    The largest ratio_w:ratio_h window that fits, centred on his head.

    `height` takes a fraction of the picture rather than all of it, which is how
    the square becomes a head-and-shoulders crop instead of the whole figure.
    `headroom` is the space left above the top of his hair, as a fraction of the
    window. Both are measured off the matte, so the framing follows the
    photograph rather than a number written down for one particular file.
    """
    W, H = img.size
    h = round(H * height)
    w = round(h * ratio_w / ratio_h)
    if w > W:
        w, h = W, round(W * ratio_h / ratio_w)
    cx, top = head_centre(alpha)
    x0 = clamp(cx - w // 2, 0, W - w)
    y0 = clamp(top - round(h * headroom), 0, H - h)
    return img.crop((x0, y0, x0 + w, y0 + h))


def clean_marker(img, hue=(12, 42), sat=0.5, val=0.6, grow=5):
    """
    Replace an orange marker scribble with the colour around it.

    Orange is nowhere in a WhatsApp conversation except the marker (the
    wallpaper's sand tones are too pale, the hearts are red, the emoji faces are
    yellow), so a hue window finds it. Each blob is grown a few pixels and filled
    with the median colour of the ring just outside it — white on a received
    bubble, pale green on a sent one — which is what a tidy redaction looks like.
    """
    from scipy.ndimage import binary_dilation, label

    a = np.asarray(img.convert("RGB")).astype(np.float32) / 255.0
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    mx, mn = a.max(2), a.min(2)
    chroma = mx - mn
    s = np.where(mx > 0, chroma / np.maximum(mx, 1e-6), 0)
    h = np.zeros_like(mx)
    m = (mx == r) & (chroma > 0)
    h[m] = (((g - b)[m] / chroma[m]) % 6) * 60
    mask = (s > sat) & (mx > val) & (h > hue[0]) & (h < hue[1]) & (r > 0.75)
    mask = binary_dilation(mask, iterations=grow)

    out = a.copy()
    blobs, n = label(mask)
    for i in range(1, n + 1):
        blob = blobs == i
        if blob.sum() < 60:
            continue
        ring = binary_dilation(blob, iterations=7) & ~binary_dilation(blob, iterations=2) & ~mask
        if not ring.any():
            continue
        out[blob] = np.median(a[ring], axis=0)
    return Image.fromarray((out * 255).astype(np.uint8), "RGB")


# --- 1. the seal ---------------------------------------------------------------


def build_mark():
    print("mark (brand seal)")
    seal = trim_to_content(Image.open(SRC / "brand" / "logo-seal.jpg").convert("RGB"))
    side = max(seal.size)
    pad = round(side * 0.06)
    canvas = Image.new("RGB", (side + pad * 2, side + pad * 2), "white")
    canvas.paste(seal, ((canvas.width - seal.width) // 2, (canvas.height - seal.height) // 2))

    for w in (144, 300, 560):
        save_webp(canvas, f"mark-{w}.webp", w, quality=88)

    canvas.resize((256, 256), Image.LANCZOS).save(OUT / "logo-256.png")
    canvas.resize((32, 32), Image.LANCZOS).save(OUT / "favicon-32.png")
    canvas.resize((180, 180), Image.LANCZOS).save(OUT / "apple-touch-icon.png")
    print("  logo-256.png / favicon-32.png / apple-touch-icon.png")

    # Maskable icons: Android crops to a circle inscribed in the middle 80%,
    # so the artwork is inset and the bleed is the brand navy.
    for size in (192, 512):
        m = Image.new("RGB", (size, size), "#0e214e")
        inner = round(size * 0.72)
        art = canvas.resize((inner, inner), Image.LANCZOS)
        disc = Image.new("L", (inner, inner), 0)
        ImageDraw.Draw(disc).ellipse((0, 0, inner - 1, inner - 1), fill=255)
        m.paste(art, ((size - inner) // 2, (size - inner) // 2), disc)
        m.save(OUT / f"maskable-{size}.png")
    print("  maskable-192.png / maskable-512.png")

    ico = canvas.resize((256, 256), Image.LANCZOS)
    ico.save(ROOT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print("  favicon.ico")


# --- 2 & 3. the teacher ---------------------------------------------------------


def build_teacher():
    print("teacher (his own photographs, backgrounds kept as shot)")

    # -- the head-and-shoulders photograph: the medium shot and the square
    head_photo = polish(Image.open(SRC / "photos" / "teacher-headshot.jpg").convert("RGB"))
    head_alpha = matte(head_photo)
    print(f"  headshot {head_photo.size}, head at {head_centre(head_alpha)}")

    medium = frame(head_photo, head_alpha, 4, 5, headroom=0.07)
    for s in (480, 800):
        save_webp(medium, f"teacher-photo-{s}.webp", s, quality=86)

    square = frame(head_photo, head_alpha, 1, 1, headroom=0.10, height=0.36)
    for s in (144, 360, 720):
        save_webp(square, f"teacher-portrait-{s}.webp", s, quality=88)
    square.resize((720, 720), Image.LANCZOS).save(OUT / "teacher-portrait.jpg", quality=90)
    print("  teacher-portrait.jpg              720x720")

    # -- the standing photograph: the profile page, hands and certificate in frame
    stand_photo = polish(Image.open(SRC / "photos" / "teacher-standing.jpg").convert("RGB"))
    stand_alpha = matte(stand_photo)
    print(f"  standing {stand_photo.size}, head at {head_centre(stand_alpha)}")

    tall = frame(stand_photo, stand_alpha, 2, 3, headroom=0.045)
    for s in (480, 800):
        save_webp(tall, f"teacher-photo-tall-{s}.webp", s, quality=86)


# --- 4. the award photo ---------------------------------------------------------


def build_award():
    print("award")
    img = Image.open(SRC / "photos" / "teacher-award.jpg").convert("RGB").crop(AWARD_CONTENT)
    # 4:5, high in the frame: a 4:3 window cannot hold both his face and the
    # certificate at this width, and a crop that keeps only the certificate
    # would not read as him receiving it.
    want_h = round(img.width * 5 / 4)
    y0 = 60
    img = img.crop((0, y0, img.width, min(img.height, y0 + want_h)))
    img = img.resize((img.width * 2, img.height * 2), Image.LANCZOS)
    img = img.filter(ImageFilter.UnsharpMask(radius=1.4, percent=60, threshold=2))
    img = ImageEnhance.Contrast(img).enhance(1.05)
    for w in (480, 960):
        save_webp(img, f"teacher-award-{w}.webp", w, quality=84)


# --- 5. the students' messages --------------------------------------------------


def build_proof():
    print("proof (the students' WhatsApp messages)")
    PROOF.mkdir(parents=True, exist_ok=True)
    sizes = {}
    for name, file, box, marker in CHATS:
        img = Image.open(SRC / "testimonials" / file).convert("RGB")
        if box:
            img = img.crop(box)
        if marker:
            img = clean_marker(img)
        sizes[name] = save_webp(img, f"{name}.webp", min(img.width, 720), quality=80, folder=PROOF)
    return sizes


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    only = sys.argv[1] if len(sys.argv) > 1 else None
    if only in (None, "mark"):
        build_mark()
    if only in (None, "teacher"):
        build_teacher()
    if only in (None, "award"):
        build_award()
    if only in (None, "proof"):
        print(build_proof())
    print("done.")
