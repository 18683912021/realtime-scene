#!/usr/bin/env python3
"""Generate transparent animated WebP loops for Mira's interaction states.

The loops are deliberately drawn at 2x and downsampled with Lanczos so edges,
ring highlights and small sparkles stay clean on retina displays. Each state
uses its own palette:

- listening: mint / aqua sonar rings and a live waveform
- thinking: warm cream thought-bubble with orbiting sparkles
- speaking: amber / coral equalizer ring and rising sound ripples
"""
from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "public" / "assets" / "state"
SS = 2  # supersampling factor


MINT = (126, 244, 224)
AQUA = (104, 218, 238)
GOLD = (255, 214, 152)
CREAM = (255, 248, 232)
CORAL = (255, 158, 120)
AMBER = (255, 188, 104)


def canvas(w: int, h: int) -> Image.Image:
    return Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))


def down(image: Image.Image, w: int, h: int) -> Image.Image:
    return image.resize((w, h), Image.LANCZOS)


def rgba(color: tuple[int, int, int], alpha: int) -> tuple[int, int, int, int]:
    return color[0], color[1], color[2], max(0, min(255, int(alpha)))


def glow_layer(layer: Image.Image, radius: float) -> Image.Image:
    return layer.filter(ImageFilter.GaussianBlur(radius * SS))


def ease_out(value: float) -> float:
    return 1 - (1 - value) ** 3


def ease_in_out(value: float) -> float:
    return 0.5 - 0.5 * math.cos(math.pi * value)


def sparkle(draw: ImageDraw.ImageDraw, x: float, y: float, size: float, color, alpha: float) -> None:
    """A four-point star with a soft round core."""
    if size <= 0:
        return
    draw.ellipse(
        [x - size * 0.42, y - size * 0.42, x + size * 0.42, y + size * 0.42],
        fill=rgba(color, 255 * alpha * 0.18),
    )
    draw.polygon(
        [
            (x, y - size),
            (x + size * 0.18, y - size * 0.18),
            (x + size, y),
            (x + size * 0.18, y + size * 0.18),
            (x, y + size),
            (x - size * 0.18, y + size * 0.18),
            (x - size, y),
            (x - size * 0.18, y - size * 0.18),
        ],
        fill=rgba(color, 255 * alpha),
    )


def arc_ring(
    draw: ImageDraw.ImageDraw,
    center: tuple[float, float],
    radius: float,
    start: float,
    end: float,
    color,
    alpha: float,
    width: float,
) -> None:
    cx, cy, rr = center[0] * SS, center[1] * SS, radius * SS
    box = [cx - rr, cy - rr, cx + rr, cy + rr]
    draw.arc(box, start=start, end=end, fill=rgba(color, 255 * alpha), width=max(1, int(width * SS)))


def listening_frames() -> list[Image.Image]:
    w, h = 720, 720
    cx, cy = 360, 382
    frames: list[Image.Image] = []
    total = 30
    for index in range(total):
        t = index / total
        image = canvas(w, h)
        draw = ImageDraw.Draw(image)
        crisp = ImageDraw.Draw(image)

        # Soft breathing aura behind everything.
        pulse = 0.5 + 0.5 * math.sin(t * math.tau)
        aura = Image.new("RGBA", image.size, (0, 0, 0, 0))
        adraw = ImageDraw.Draw(aura)
        for i in range(18, 0, -1):
            rr = (190 + i * 8) * SS
            adraw.ellipse(
                [cx * SS - rr, cy * SS - rr * 0.92, cx * SS + rr, cy * SS + rr * 0.92],
                fill=rgba(AQUA, 3.2),
            )
        image.alpha_composite(glow_layer(aura, 18))

        # Three expanding sonar rings.
        for ring in range(3):
            phase = (t + ring / 3) % 1.0
            radius = (118 + 246 * ease_out(phase)) * SS
            alpha = (1 - phase) ** 1.6 * 0.85
            if alpha <= 0.01:
                continue
            ring_layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
            rdraw = ImageDraw.Draw(ring_layer)
            box = [cx * SS - radius, cy * SS - radius * 0.94, cx * SS + radius, cy * SS + radius * 0.94]
            rdraw.ellipse(box, outline=rgba(MINT, 255 * alpha), width=int(3 * SS))
            image.alpha_composite(glow_layer(ring_layer, 12))
            arc_ring(crisp, (cx, cy), radius / SS, 0, 360, MINT, alpha, 1.6)

            # A few bright beads travel with each wave.
            for bead in range(3):
                angle = (t * 0.8 + bead / 3 + ring * 0.18) * math.tau
                bx = cx * SS + math.cos(angle) * radius
                by = cy * SS + math.sin(angle) * radius * 0.94
                sparkle(crisp, bx, by, (4.2 + 2.2 * (1 - phase)) * SS, CREAM, alpha * 0.8)

        # Slow counter-rotating dashed orbits.
        for orbit, direction in ((248, 1), (274, -1)):
            base = t * math.tau * 0.34 * direction
            for dot in range(22):
                angle = base + dot / 22 * math.tau
                alpha = 0.12 + 0.5 * (0.5 + 0.5 * math.sin(angle * 3 - t * math.tau)) ** 2
                x = cx + math.cos(angle) * orbit
                y = cy + math.sin(angle) * orbit * 0.9
                dot_r = 1.5 + 1.4 * (0.5 + 0.5 * math.sin(angle * 2 + t * math.tau))
                crisp.ellipse(
                    [(x - dot_r) * SS, (y - dot_r) * SS, (x + dot_r) * SS, (y + dot_r) * SS],
                    fill=rgba(GOLD if orbit == 274 else MINT, 255 * alpha),
                )

        # Grounding waveform: 13 rounded bars along a shallow arc.
        bar_layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
        bdraw = ImageDraw.Draw(bar_layer)
        count = 13
        for i in range(count):
            u = i / (count - 1)
            x = cx + (u - 0.5) * 360
            baseline = 626 + math.sin((u - 0.5) * math.pi) * 12
            envelope = math.sin(u * math.pi) ** 0.65
            wave = 0.5 + 0.5 * math.sin(t * math.tau * 2.1 + i * 0.62)
            height = (12 + 54 * wave * envelope + 8 * math.sin(t * math.tau + i)) * (0.7 + 0.3 * pulse)
            color = MINT if i % 3 else GOLD
            alpha = 0.45 + 0.5 * envelope
            bdraw.rounded_rectangle(
                [(x - 2.6) * SS, (baseline - height) * SS, (x + 2.6) * SS, baseline * SS],
                radius=2.6 * SS,
                fill=rgba(color, 255 * alpha),
            )
            bdraw.rounded_rectangle(
                [(x - 0.8) * SS, (baseline - height) * SS, (x + 0.8) * SS, baseline * SS],
                radius=0.8 * SS,
                fill=rgba(CREAM, 255 * alpha * 0.8),
            )
        image.alpha_composite(glow_layer(bar_layer, 7))
        image.alpha_composite(bar_layer)

        # Two thin floor arcs anchor the bars in the scene.
        for rr, alpha in ((188, 0.5), (226, 0.24)):
            arc_ring(crisp, (cx, 626), rr, 18, 162, GOLD, alpha, 1.1)

        # Twinkles around the field.
        for i in range(7):
            angle = t * math.tau * 0.5 + i / 7 * math.tau
            radius = 210 + 58 * math.sin(t * math.tau + i * 1.7)
            x = cx + math.cos(angle) * radius
            y = cy + math.sin(angle) * radius * 0.72
            twinkle = 0.2 + 0.8 * (0.5 + 0.5 * math.sin(t * math.tau * 2 + i * 1.3)) ** 3
            sparkle(crisp, x, y, (3.4 + 3.6 * twinkle) * SS, CREAM if i % 2 else GOLD, 0.75 * twinkle)

        frames.append(down(image, w, h))
    return frames


def thinking_frames() -> list[Image.Image]:
    w, h = 600, 480
    frames: list[Image.Image] = []
    total = 26
    for index in range(total):
        t = index / total
        image = canvas(w, h)
        draw = ImageDraw.Draw(image)
        crisp = ImageDraw.Draw(image)

        bob = math.sin(t * math.tau) * 7
        tilt = math.sin(t * math.tau + 0.6) * 1.4
        bubble = Image.new("RGBA", image.size, (0, 0, 0, 0))
        bdraw = ImageDraw.Draw(bubble)

        # Soft halo behind the bubble.
        halo = Image.new("RGBA", image.size, (0, 0, 0, 0))
        hdraw = ImageDraw.Draw(halo)
        hdraw.ellipse([330 * SS, (120 + bob) * SS, 590 * SS, (300 + bob) * SS], fill=rgba(AMBER, 26))
        image.alpha_composite(glow_layer(halo, 26))

        # Main glass capsule.
        box = [318 * SS, (92 + bob) * SS, 566 * SS, (234 + bob) * SS]
        shadow = Image.new("RGBA", image.size, (0, 0, 0, 0))
        sdraw = ImageDraw.Draw(shadow)
        sdraw.rounded_rectangle(
            [box[0] + 8 * SS, box[1] + 13 * SS, box[2] + 8 * SS, box[3] + 15 * SS],
            radius=68 * SS,
            fill=rgba((84, 44, 18), 95),
        )
        image.alpha_composite(glow_layer(shadow, 18))
        bdraw.rounded_rectangle(box, radius=68 * SS, fill=rgba(CREAM, 238))
        inner = [box[0] + 6 * SS, box[1] + 6 * SS, box[2] - 6 * SS, box[3] - 7 * SS]
        bdraw.rounded_rectangle(inner, radius=62 * SS, fill=rgba((255, 241, 214), 235))
        # Warm lower half.
        lower = [inner[0], (inner[1] + inner[3]) / 2, inner[2], inner[3]]
        bdraw.rounded_rectangle(lower, radius=52 * SS, fill=rgba((255, 218, 168), 150))
        # Glass border and top highlight.
        bdraw.rounded_rectangle(
            box, radius=68 * SS, outline=rgba((255, 252, 242), 245), width=int(2.2 * SS)
        )
        bdraw.arc(
            [box[0] + 18 * SS, box[1] + 15 * SS, box[2] - 18 * SS, box[1] + 95 * SS],
            200,
            340,
            fill=rgba((255, 255, 255), 150),
            width=int(2 * SS),
        )

        image.alpha_composite(bubble.rotate(tilt, resample=Image.BICUBIC, center=(442 * SS, 163 * SS)))

        # Three breathing dots.
        for dot in range(3):
            phase = (t - dot * 0.14) % 1.0
            scale = 0.72 + 0.4 * max(0.0, math.sin(phase * math.tau)) ** 2
            x = 388 + dot * 54
            y = 164 + bob
            r = 11 * scale
            glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
            gdraw = ImageDraw.Draw(glow)
            gdraw.ellipse(
                [(x - r * 2.1) * SS, (y - r * 2.1) * SS, (x + r * 2.1) * SS, (y + r * 2.1) * SS],
                fill=rgba(AMBER, 120),
            )
            image.alpha_composite(glow_layer(glow, 10))
            crisp.ellipse(
                [(x - r) * SS, (y - r) * SS, (x + r) * SS, (y + r) * SS],
                fill=rgba((214, 133, 62), 255),
            )
            crisp.ellipse(
                [(x - r * 0.34) * SS, (y - r * 0.5) * SS, (x + r * 0.16) * SS, (y - r * 0.08) * SS],
                fill=rgba(CREAM, 210),
            )

        # Trailing thought bubbles toward Mira.
        for number, (bx, by, radius, alpha) in enumerate(
            ((286, 288, 15, 0.9), (253, 329, 9.5, 0.75), (231, 357, 5.8, 0.6))
        ):
            yy = by + bob * (0.5 + number * 0.16)
            glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
            gdraw = ImageDraw.Draw(glow)
            gdraw.ellipse(
                [(bx - radius * 2) * SS, (yy - radius * 2) * SS, (bx + radius * 2) * SS, (yy + radius * 2) * SS],
                fill=rgba(GOLD, 80),
            )
            image.alpha_composite(glow_layer(glow, 8))
            crisp.ellipse(
                [(bx - radius) * SS, (yy - radius) * SS, (bx + radius) * SS, (yy + radius) * SS],
                fill=rgba(CREAM, 230 * alpha),
                outline=rgba((255, 247, 230), 240),
                width=max(1, int(1.4 * SS)),
            )
            crisp.ellipse(
                [(bx - radius * 0.55) * SS, (yy - radius * 0.62) * SS, (bx - radius * 0.02) * SS, (yy - radius * 0.12) * SS],
                fill=rgba((255, 255, 255), 170 * alpha),
            )

        # Orbit of tiny sparkles around the capsule.
        orbit_cx, orbit_cy = 442, 163 + bob
        for i in range(9):
            angle = t * math.tau * 0.42 + i / 9 * math.tau
            rx, ry = 188, 112
            x = orbit_cx + math.cos(angle) * rx
            y = orbit_cy + math.sin(angle) * ry
            twinkle = (0.5 + 0.5 * math.sin(angle * 2 + t * math.tau * 2)) ** 2
            sparkle(crisp, x, y, (2.6 + 4.8 * twinkle) * SS, GOLD if i % 3 else CREAM, 0.8 * twinkle)
        # A slow satellite star.
        sat = t * math.tau * 0.5
        sparkle(
            crisp,
            orbit_cx + math.cos(sat) * 208,
            orbit_cy + math.sin(sat) * 128,
            6.5 * SS,
            AMBER,
            0.75,
        )

        # Dash orbit line.
        dash_layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
        ddraw = ImageDraw.Draw(dash_layer)
        for i in range(30):
            angle = t * math.tau * 0.3 + i / 30 * math.tau
            x = orbit_cx + math.cos(angle) * 206
            y = orbit_cy + math.sin(angle) * 126
            ddraw.ellipse(
                [(x - 1.1) * SS, (y - 1.1) * SS, (x + 1.1) * SS, (y + 1.1) * SS],
                fill=rgba(GOLD, 90),
            )
        image.alpha_composite(dash_layer)

        frames.append(down(image, w, h))
    return frames


def speaking_frames() -> list[Image.Image]:
    w, h = 720, 420
    cx, cy = 360, 318
    frames: list[Image.Image] = []
    total = 20
    for index in range(total):
        t = index / total
        image = canvas(w, h)
        draw = ImageDraw.Draw(image)
        crisp = ImageDraw.Draw(image)

        pulse = 0.5 + 0.5 * math.sin(t * math.tau)
        aura = Image.new("RGBA", image.size, (0, 0, 0, 0))
        adraw = ImageDraw.Draw(aura)
        adraw.ellipse([80 * SS, 210 * SS, 640 * SS, 400 * SS], fill=rgba(CORAL, 18))
        image.alpha_composite(glow_layer(aura, 30))

        # Two rising/expanding ellipse ripples.
        for ripple in range(2):
            phase = (t + ripple * 0.5) % 1.0
            rx = (154 + 176 * ease_out(phase)) * SS
            ry = (40 + 44 * ease_out(phase)) * SS
            alpha = (1 - phase) ** 1.4 * 0.55
            layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
            ldraw = ImageDraw.Draw(layer)
            ldraw.ellipse(
                [cx * SS - rx, cy * SS - ry, cx * SS + rx, cy * SS + ry],
                outline=rgba(CORAL if ripple else GOLD, 255 * alpha),
                width=int(2.2 * SS),
            )
            image.alpha_composite(glow_layer(layer, 10))

        # Solid stage ring.
        arc_ring(crisp, (cx, cy), 232, 0, 180, GOLD, 0.34, 1.4)
        arc_ring(crisp, (cx, cy), 250, 0, 180, CREAM, 0.18, 1.0)

        # Equalizer bars standing on the front half of the ellipse.
        bar_layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
        bdraw = ImageDraw.Draw(bar_layer)
        count = 19
        for i in range(count):
            u = i / (count - 1)
            angle = math.pi * (1 - u)
            base_x = cx + math.cos(angle) * 218
            base_y = cy + math.sin(angle) * 54
            envelope = math.sin(u * math.pi) ** 0.5
            wave = 0.5 + 0.5 * math.sin(t * math.tau * 2.4 + i * 0.7)
            flutter = 0.5 + 0.5 * math.sin(t * math.tau * 1.3 + i * 1.9)
            height = (10 + 74 * (0.62 * wave + 0.38 * flutter) * envelope) * (0.82 + 0.18 * pulse)
            # Bars lean outward slightly, following the ring.
            lean = math.cos(angle) * 7
            top_x = base_x + lean
            color = CORAL if i % 4 == 0 else GOLD
            alpha = 0.46 + 0.5 * envelope
            bdraw.rounded_rectangle(
                [(top_x - 3.1) * SS, (base_y - height) * SS, (top_x + 3.1) * SS, base_y * SS],
                radius=3.1 * SS,
                fill=rgba(color, 255 * alpha),
            )
            bdraw.rounded_rectangle(
                [(top_x - 1.0) * SS, (base_y - height) * SS, (top_x + 1.0) * SS, base_y * SS],
                radius=1.0 * SS,
                fill=rgba(CREAM, 255 * alpha * 0.9),
            )
            if height > 44:
                sparkle(crisp, top_x, base_y - height - 7, (2.2 + 2.4 * envelope) * SS, CREAM, 0.6 * envelope)
        image.alpha_composite(glow_layer(bar_layer, 8))
        image.alpha_composite(bar_layer)

        # Little sound arcs rising from the centre.
        for band in range(3):
            phase = (t * 1.7 + band * 0.3) % 1.0
            radius = (36 + 104 * phase) * SS
            alpha = (1 - phase) ** 1.8 * 0.7
            arc_ring(
                crisp,
                (cx, cy - 16),
                radius / SS,
                205,
                335,
                CREAM if band % 2 else GOLD,
                alpha,
                1.5,
            )

        # Rising embers / notes.
        for i in range(6):
            phase = (t * 1.2 + i / 6) % 1.0
            x = cx + math.sin(phase * math.tau + i * 2.1) * (92 + i * 13)
            y = cy - 48 - phase * 160
            alpha = math.sin(phase * math.pi) ** 1.2 * 0.7
            sparkle(crisp, x, y, (2.4 + 3.8 * (1 - phase)) * SS, GOLD if i % 2 else CORAL, alpha)

        frames.append(down(image, w, h))
    return frames


def save(name: str, frames: list[Image.Image], duration: int) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.webp"
    frames[0].save(
        path,
        "WEBP",
        save_all=True,
        append_images=frames[1:],
        duration=duration,
        loop=0,
        quality=78,
        method=6,
        minimize_size=True,
    )
    print(f"{path.relative_to(ROOT)}  {path.stat().st_size / 1024:.0f} KB  {len(frames)}f")


def main() -> None:
    random.seed(5)
    save("listening", listening_frames(), 75)
    save("thinking", thinking_frames(), 80)
    save("speaking", speaking_frames(), 60)


if __name__ == "__main__":
    main()
