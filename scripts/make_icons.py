"""Generate PWA icons: slate ground, serif italic 's', teal accent dot.

Run once:  venv/Scripts/python.exe scripts/make_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[1] / "frontend" / "public"
OUT.mkdir(parents=True, exist_ok=True)

SLATE = (2, 6, 23)  # #020617
AMBER = (255, 251, 235)  # amber-50
TEAL = (45, 212, 191)  # teal-400

FONT_CANDIDATES = [
    "C:/Windows/Fonts/georgiai.ttf",  # Georgia italic
    "C:/Windows/Fonts/timesi.ttf",
    "C:/Windows/Fonts/georgia.ttf",
]


def font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def icon(size: int, pad_frac: float = 0.0) -> Image.Image:
    img = Image.new("RGB", (size, size), SLATE)
    draw = ImageDraw.Draw(img)
    # glyph area shrinks for maskable safe zone
    glyph_size = int(size * (0.62 - pad_frac))
    f = font(glyph_size)
    bbox = draw.textbbox((0, 0), "s", font=f)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - w) / 2 - bbox[0] - size * 0.03
    y = (size - h) / 2 - bbox[1]
    draw.text((x, y), "s", font=f, fill=AMBER)
    # teal reading-lamp dot, top right of the glyph
    r = size * 0.055
    cx, cy = x + w + size * 0.10, y + size * 0.06
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=TEAL)
    return img


def main() -> None:
    icon(512).save(OUT / "icon-512.png")
    icon(192).save(OUT / "icon-192.png")
    icon(512, pad_frac=0.14).save(OUT / "icon-512-maskable.png")
    icon(180).save(OUT / "apple-touch-icon.png")
    icon(48).save(OUT / "favicon.png")
    print(f"icons written to {OUT}")


if __name__ == "__main__":
    main()
