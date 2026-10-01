"""Generates the animated login background in the Trigyan palette.

Abstract on purpose: soft drifting bokeh over a brand-blue gradient, with a few
open rings echoing the owl's body. Every motion is a sine of the frame index,
so the last frame flows back into the first and the loop is seamless.

Outputs:
  login-background.gif  - the animation
  login-background.png  - frame 0, used when the viewer prefers reduced motion
"""

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(r"c:\Users\durga\OneDrive\Desktop\emp portal\frontend\public")
WIDTH, HEIGHT = 640, 400
FRAMES = 24
DURATION_MS = 90

# Brand colours, straight from styles/theme.ts
BLUE = (107, 155, 214)
BLUE_DEEP = (74, 124, 190)
BLUE_DARK = (47, 90, 147)
GREEN = (140, 198, 63)


def gradient() -> Image.Image:
    """Diagonal wash from deep blue to a darker blue."""
    base = Image.new("RGB", (WIDTH, HEIGHT))
    pixels = base.load()
    for y in range(HEIGHT):
        for x in range(0, WIDTH, 2):  # 4px steps, then blurred - much faster
            t = (x / WIDTH * 0.45) + (y / HEIGHT * 0.55)
            colour = tuple(
                round(BLUE_DEEP[i] + (BLUE_DARK[i] - BLUE_DEEP[i]) * t) for i in range(3)
            )
            for dx in range(2):
                if x + dx < WIDTH:
                    pixels[x + dx, y] = colour
    return base.filter(ImageFilter.GaussianBlur(2))


# (x, y, radius, alpha, drift px, phase, colour)
BLOBS = [
    (0.12, 0.22, 150, 34, 26, 0.0, BLUE),
    (0.78, 0.18, 190, 28, 32, 1.1, BLUE),
    (0.62, 0.74, 160, 30, 24, 2.2, BLUE),
    (0.24, 0.82, 120, 26, 30, 3.0, GREEN),
    (0.90, 0.58, 110, 22, 22, 4.1, GREEN),
    (0.44, 0.40, 210, 20, 18, 5.0, BLUE),
]

# (x, y, radius, width, alpha, drift, phase) - open rings, like the owl's body
RINGS = [
    (0.18, 0.62, 90, 5, 46, 16, 0.4),
    (0.72, 0.34, 130, 6, 38, 20, 2.6),
    (0.52, 0.88, 70, 4, 42, 14, 4.4),
]


def frame(index: int, base: Image.Image) -> Image.Image:
    phase = (index / FRAMES) * 2 * math.pi
    layer = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    for fx, fy, radius, alpha, drift, offset, colour in BLOBS:
        cx = fx * WIDTH + math.sin(phase + offset) * drift
        cy = fy * HEIGHT + math.cos(phase + offset * 1.3) * drift * 0.6
        draw.ellipse(
            [cx - radius, cy - radius, cx + radius, cy + radius], fill=(*colour, alpha)
        )

    for fx, fy, radius, width, alpha, drift, offset in RINGS:
        cx = fx * WIDTH + math.sin(phase + offset) * drift
        cy = fy * HEIGHT + math.cos(phase + offset) * drift * 0.7
        draw.ellipse(
            [cx - radius, cy - radius, cx + radius, cy + radius],
            outline=(*BLUE, alpha),
            width=width,
        )

    # Blur the whole layer so nothing has a hard edge, then lay it on the wash.
    layer = layer.filter(ImageFilter.GaussianBlur(26))
    return Image.alpha_composite(base.convert("RGBA"), layer).convert("RGB")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    base = gradient()
    frames = [frame(index, base) for index in range(FRAMES)]

    # A shared adaptive palette keeps the loop from shimmering between frames.
    # Dithering scatters noise across every frame, which defeats LZW and
    # multiplied the file size roughly tenfold. The artwork is soft and
    # blurred, so flat quantisation reads as gentle colour fields instead.
    palette = frames[0].quantize(colors=64, method=Image.MEDIANCUT)
    quantised = [f.quantize(palette=palette, dither=Image.NONE) for f in frames]

    gif_path = OUT / "login-background.gif"
    quantised[0].save(
        gif_path,
        save_all=True,
        append_images=quantised[1:],
        duration=DURATION_MS,
        loop=0,
        optimize=True,
    )

    png_path = OUT / "login-background.png"
    frames[0].save(png_path, optimize=True)

    print(f"{gif_path.name}: {gif_path.stat().st_size / 1024:.0f} KB, {FRAMES} frames")
    print(f"{png_path.name}: {png_path.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
