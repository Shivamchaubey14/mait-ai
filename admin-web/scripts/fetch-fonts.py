"""
Download the latin subset of Quicksand and Nunito Sans as woff2, self-hosted.

Google's CSS emits several unicode-range slices per weight. Only the `latin` slice is taken:
the portal is English-only (Devanagari lives in the mobile app), and shipping Cyrillic and
Vietnamese slices nobody renders is bytes on a back-office connection for nothing.
"""

from __future__ import annotations

import pathlib
import re
import urllib.request

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)
CSS_URL = (
    "https://fonts.googleapis.com/css2"
    "?family=Quicksand:wght@600;700&family=Nunito+Sans:wght@400;600&display=swap"
)
OUT = pathlib.Path(r"D:\mait-ai\admin-web\assets\fonts")


def get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


css = get(CSS_URL).decode("utf8")

# Each @font-face block carries its family, weight and unicode-range together, so parse
# blocks rather than pairing loose regex matches and hoping the order holds.
blocks = re.findall(r"/\*\s*(\S+)\s*\*/\s*@font-face\s*\{(.*?)\}", css, re.S)

wanted = {("Quicksand", "600"), ("Quicksand", "700"), ("Nunito Sans", "400"), ("Nunito Sans", "600")}
faces = []

for subset, body in blocks:
    if subset != "latin":
        continue
    family = re.search(r"font-family:\s*'([^']+)'", body)
    weight = re.search(r"font-weight:\s*(\d+)", body)
    url = re.search(r"url\((https://[^)]+\.woff2)\)", body)
    if not (family and weight and url):
        continue
    key = (family.group(1), weight.group(1))
    if key not in wanted:
        continue

    slug = family.group(1).replace(" ", "") + "-" + weight.group(1)
    path = OUT / f"{slug}.woff2"
    path.write_bytes(get(url.group(1)))
    faces.append((family.group(1), weight.group(1), path.name, path.stat().st_size))
    print(f"  {path.name:<24} {path.stat().st_size / 1024:.1f} KB")

missing = wanted - {(f, w) for f, w, _, _ in faces}
if missing:
    raise SystemExit(f"missing faces: {missing}")

css_out = ['/**', ' * Self-hosted webfonts.', ' *', ]
css_out += [
    " * Served from this origin rather than a CDN. This portal renders member PII, and every",
    " * third-party request from it leaks a referrer and an IP whether or not the response is",
    " * a script — see README.md.",
    " *",
    " * Latin subset only; the portal is English. `font-display: swap` so text is readable in a",
    " * fallback face immediately rather than invisible while the font arrives.",
    " *",
    " * Regenerate with scripts/fetch-fonts.py.",
    " */",
    "",
]
for family, weight, filename, _ in sorted(faces):
    css_out += [
        "@font-face {",
        f"  font-family: '{family}';",
        "  font-style: normal;",
        f"  font-weight: {weight};",
        "  font-display: swap;",
        f"  src: url('../fonts/{filename}') format('woff2');",
        "}",
        "",
    ]

(OUT.parent / "css" / "fonts.css").write_text("\n".join(css_out), encoding="utf8")
print(f"\nwrote assets/css/fonts.css with {len(faces)} faces")
