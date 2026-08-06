"""
Download the latin subset of Quicksand and Nunito Sans as woff2, self-hosted.

Google's CSS emits several unicode-range slices per weight. Only the `latin` slice is taken:
the portal is English-only (Devanagari lives in the mobile app), and shipping Cyrillic and
Vietnamese slices nobody renders is bytes on a back-office connection for nothing.

Both families are served as **variable** fonts: one woff2 covers every weight, and Google
lists it once per weight requested. So the faces are grouped by family and declared with a
weight *range*. Writing one `@font-face` per weight pointing at the same file would tell the
browser the file is a single static weight — it would then synthesise bold by smearing the
600, which is what made the portal's headings look nothing like the design.
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

WANTED = {"Quicksand": ("600", "700"), "Nunito Sans": ("400", "600")}

# family -> {"url": ..., "weights": {...}}
found: dict[str, dict] = {}

for subset, body in blocks:
    if subset != "latin":
        continue
    family = re.search(r"font-family:\s*'([^']+)'", body)
    weight = re.search(r"font-weight:\s*(\d+)", body)
    url = re.search(r"url\((https://[^)]+\.woff2)\)", body)
    if not (family and weight and url) or family.group(1) not in WANTED:
        continue

    entry = found.setdefault(family.group(1), {"url": url.group(1), "weights": set()})
    entry["weights"].add(weight.group(1))
    # One variable file per family. If Google ever goes back to static per-weight files this
    # assertion is what will catch it, rather than the portal silently losing its bold.
    if entry["url"] != url.group(1):
        raise SystemExit(f"{family.group(1)} is served as separate files per weight — regroup")

missing = set(WANTED) - set(found)
if missing:
    raise SystemExit(f"missing families: {missing}")

faces = []
for family, entry in found.items():
    slug = family.replace(" ", "")
    path = OUT / f"{slug}.woff2"
    path.write_bytes(get(entry["url"]))
    weights = sorted(entry["weights"] | set(WANTED[family]), key=int)
    faces.append((family, f"{weights[0]} {weights[-1]}", path.name))
    print(f"  {path.name:<24} {path.stat().st_size / 1024:.1f} KB  weights {weights[0]}–{weights[-1]}")

# Old per-weight downloads, left behind by the previous version of this script.
for stale in OUT.glob("*-[0-9][0-9][0-9].woff2"):
    stale.unlink()
    print(f"  removed stale {stale.name}")

css_out = ['/**', ' * Self-hosted webfonts.', ' *', ]
css_out += [
    " * Served from this origin rather than a CDN. This portal renders member PII, and every",
    " * third-party request from it leaks a referrer and an IP whether or not the response is",
    " * a script — see README.md.",
    " *",
    " * Latin subset only; the portal is English. `font-display: swap` so text is readable in a",
    " * fallback face immediately rather than invisible while the font arrives.",
    " *",
    " * Both families are variable: one file covers the whole weight range, declared here as a",
    " * range. Declaring a single weight would make the browser synthesise bold instead of using",
    " * the real one.",
    " *",
    " * Regenerate with scripts/fetch-fonts.py.",
    " */",
    "",
]
for family, weight, filename in sorted(faces):
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
