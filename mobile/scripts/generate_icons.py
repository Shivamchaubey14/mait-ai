"""
Generate the app icon, adaptive icon, splash and favicon.

These are placeholders drawn from the design-system palette, not a designed brand mark. They
exist so the app stops shipping Expo's default icon; replace the PNGs with a designer's files
and nothing in the code needs to change.

The mark is a semen straw — the single unit the entire platform is built around. It reads as
one bold shape at 48px, which a cow silhouette or a wordmark would not.

Run:  python scripts/generate_icons.py
"""

from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw

# docs/DESIGN_SYSTEM.md
PRIMARY_DARK = (0x32, 0x5E, 0x6A)
PRIMARY = (0x43, 0x63, 0x7E)
ACCENT = (0xE9, 0x8B, 0x50)
SUCCESS_ALT = (0x24, 0x9D, 0x8F)
SURFACE = (0xFF, 0xFF, 0xFF)

ASSETS = pathlib.Path(__file__).resolve().parent.parent / "assets"

# Everything is drawn at 4x and downsampled — PIL has no anti-aliasing of its own, and the
# curves look ragged at 1x without it.
SS = 4


def _rounded_rect(draw: ImageDraw.ImageDraw, box, radius, fill) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def draw_mark(size: int, *, with_ground: bool, ground_radius_ratio: float = 0.22) -> Image.Image:
    """
    The straw mark, optionally on its brand-coloured ground.

    ``with_ground=False`` is for the Android adaptive icon, where the launcher supplies the
    background and masks the foreground to whatever shape the device uses.
    """
    canvas = size * SS
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    if with_ground:
        radius = int(canvas * ground_radius_ratio)

        # The ground and its band are composed on their own layer and masked to the rounded
        # shape. Drawing the band straight onto the canvas lets it spill past the corner
        # radius, which reads as a rendering bug rather than a design.
        ground = Image.new("RGBA", (canvas, canvas), PRIMARY_DARK)
        ImageDraw.Draw(ground).polygon(
            [(0, canvas), (canvas, canvas * 0.45), (canvas, canvas), (0, canvas)],
            fill=PRIMARY,
        )

        mask = Image.new("L", (canvas, canvas), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, canvas, canvas), radius=radius, fill=255)

        image.paste(ground, (0, 0), mask)
        draw = ImageDraw.Draw(image)

    # The straw: a tall capsule, held to the middle third so it survives the adaptive-icon
    # safe zone (the launcher may crop to a circle).
    straw_w = canvas * 0.16
    straw_h = canvas * 0.52
    cx = canvas / 2
    cy = canvas / 2
    left = cx - straw_w / 2
    top = cy - straw_h / 2

    _rounded_rect(
        draw,
        (left, top, left + straw_w, top + straw_h),
        radius=int(straw_w / 2),
        fill=SURFACE,
    )

    # Accent cap — the sealed end, and the one spot of warm colour.
    cap_h = straw_h * 0.26
    _rounded_rect(
        draw,
        (left, top, left + straw_w, top + cap_h),
        radius=int(straw_w / 2),
        fill=ACCENT,
    )
    # Square off the cap's lower edge so it reads as a cap rather than a floating pill.
    draw.rectangle((left, top + cap_h - straw_w / 2, left + straw_w, top + cap_h), fill=ACCENT)

    # A droplet below, teal — the same colour the app uses for "inventory OK".
    drop_r = canvas * 0.052
    drop_cy = top + straw_h + drop_r * 1.9
    draw.ellipse(
        (cx - drop_r, drop_cy - drop_r, cx + drop_r, drop_cy + drop_r),
        fill=SUCCESS_ALT,
    )
    draw.polygon(
        [(cx, drop_cy - drop_r * 2.0), (cx - drop_r * 0.92, drop_cy), (cx + drop_r * 0.92, drop_cy)],
        fill=SUCCESS_ALT,
    )

    return image.resize((size, size), Image.LANCZOS)


def make_splash(width: int, height: int) -> Image.Image:
    image = Image.new("RGBA", (width, height), PRIMARY_DARK)
    mark = draw_mark(int(min(width, height) * 0.34), with_ground=False)
    image.alpha_composite(
        mark, ((width - mark.width) // 2, (height - mark.height) // 2 - int(height * 0.04))
    )
    return image


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)

    outputs = {
        "icon.png": draw_mark(1024, with_ground=True),
        # Adaptive icons are masked to an arbitrary shape, so the mark is drawn smaller on a
        # transparent field and the launcher fills the background from app.json.
        "adaptive-icon.png": draw_mark(1024, with_ground=False),
        "splash.png": make_splash(1284, 2778),
        "favicon.png": draw_mark(48, with_ground=True, ground_radius_ratio=0.18),
    }

    for name, image in outputs.items():
        path = ASSETS / name
        image.save(path, "PNG")
        print(f"  {name:<20} {image.width}x{image.height}  {path.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
