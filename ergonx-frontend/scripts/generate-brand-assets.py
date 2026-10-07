"""Derive the ErgonX brand asset set from the approved high-resolution logo.

Source: public/ergonx-logo.png (approved primary lockup on an off-white field).
Every derivative preserves the approved geometry exactly. The only operations
are background removal (colour-to-alpha against the measured field colour),
cropping, compositing, and solid fills for the monochrome/reversed variants.
No glyph is redrawn, distorted, or gradient-recoloured.

Run: python scripts/generate-brand-assets.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "ergonx-logo.png"
OUT = ROOT / "public" / "brand"
WORDMARK_END, MARK_START = 1047, 1050  # column gap between "n" and the X
NAVY = (15, 35, 69)  # --brand-navy #0F2345
PAD = 24


def colour_to_alpha(rgb: np.ndarray, bg: np.ndarray, noise: float = 4.0) -> np.ndarray:
    """GIMP-style colour-to-alpha against a light field.

    The artwork contains no colour lighter than the field, so only darker
    deviations carry coverage; a small noise floor removes field grain.
    """
    rgb = rgb.astype(np.float64)
    deviation = np.clip(bg - rgb, 0, None).max(axis=2)
    alpha = np.clip((deviation - noise) / (bg.max() - noise), 0, 1)
    safe = np.where(alpha > 0, alpha, 1)[..., None]
    colour = np.clip((rgb - bg) / safe + bg, 0, 255)
    return np.dstack([colour, alpha * 255]).astype(np.uint8)


def crop(rgba: np.ndarray, pad: int = PAD) -> np.ndarray:
    ys, xs = np.where(rgba[..., 3] > 8)
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, rgba.shape[0])
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, rgba.shape[1])
    return rgba[y0:y1, x0:x1]


def fill(rgba: np.ndarray, colour) -> np.ndarray:
    out = rgba.copy()
    out[..., :3] = colour
    return out


def save(array: np.ndarray, name: str) -> None:
    Image.fromarray(array, "RGBA").save(OUT / name, optimize=True)
    print("wrote", name, array.shape[1], "x", array.shape[0])


def app_icon(mark: Image.Image, size: int, rounded: bool) -> Image.Image:
    """Approved app-icon layout: X mark centred on a navy gradient tile."""
    top, bottom = np.array((1, 66, 153)), np.array((1, 28, 72))  # sampled from the supplied icon
    t = np.linspace(0, 1, size)[:, None, None]
    gradient = (top * (1 - t) + bottom * t).repeat(size, axis=1).astype(np.uint8)
    tile = Image.fromarray(np.dstack([gradient, np.full((size, size), 255, np.uint8)]), "RGBA")
    if rounded:
        m = Image.new("L", (size, size), 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * 0.22), fill=255)
        tile.putalpha(m)
    target_h = int(size * 0.58)
    scaled = mark.resize((round(mark.width * target_h / mark.height), target_h), Image.LANCZOS)
    tile.alpha_composite(scaled, ((size - scaled.width) // 2, (size - scaled.height) // 2))
    return tile


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rgb = np.asarray(Image.open(SOURCE).convert("RGB"))
    field = np.median(np.concatenate([rgb[:40].reshape(-1, 3), rgb[-40:].reshape(-1, 3)]), axis=0)
    rgba = colour_to_alpha(rgb, field)

    wordmark = rgba.copy(); wordmark[:, WORDMARK_END:, 3] = 0
    mark = rgba.copy(); mark[:, :MARK_START, 3] = 0

    primary = crop(rgba)
    save(primary, "ergonx-logo-primary.png")
    reversed_ = fill(wordmark, (255, 255, 255)); reversed_[:, MARK_START:] = mark[:, MARK_START:]
    save(crop(reversed_), "ergonx-logo-primary-reversed.png")
    mark_img = crop(mark, pad=4)
    save(mark_img, "ergonx-mark.png")
    save(crop(fill(rgba, NAVY)), "ergonx-logo-mono.png")
    save(crop(fill(rgba, (255, 255, 255))), "ergonx-logo-mono-white.png")

    mark_pil = Image.fromarray(mark_img, "RGBA")
    for size, rounded, name in [(512, False, "icon-512-maskable.png"), (512, True, "icon-512.png"), (192, True, "icon-192.png"), (180, False, "apple-touch-icon.png"), (48, True, "favicon-48.png"), (32, True, "favicon-32.png")]:
        app_icon(mark_pil, size, rounded).save(OUT / name, optimize=True)
        print("wrote", name)


if __name__ == "__main__":
    main()
