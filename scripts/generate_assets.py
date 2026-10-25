#!/usr/bin/env python3
"""Generate original prototype assets for the Mira scene.

Images are drawn locally with Pillow; voice lines use macOS `say` + `afconvert`.
No external API or third-party asset is required.
"""
from __future__ import annotations

import json
import math
import random
import subprocess
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
FRONTEND_ASSETS = ROOT / "frontend" / "public" / "assets"
AUDIO_DIR = FRONTEND_ASSETS / "audio"
MEDIA_DIR = FRONTEND_ASSETS / "media"
AMBIENCE_DIR = FRONTEND_ASSETS / "ambience"
BACKEND_ASSETS = ROOT / "backend" / "app" / "assets_manifest.json"

VOICE = "Tingting"
RATE = 168
SAMPLE_RATE = 22050

LINES = {
    "greeting": "你来了。雨刚停，先坐吧。",
    "waiting": "我在等一个人。也许他会来，也许不会。",
    "camera": "相机陪我走了很多地方。镜头有点雾，我习惯自己擦。",
    "photo": "你看这张。雨后的城市，比平时亮。",
    "lightning": "刚才那道闪电……你看到了吗？",
    "stars": "这个发夹？很久以前买的。星星在雨里也会亮。",
    "ending": "天快晴了。我该走了。谢谢你陪我坐一会儿。",
    "fallback": "嗯……你继续说，我在听。",
}


def ensure_dirs() -> None:
    for path in (AUDIO_DIR, MEDIA_DIR, AMBIENCE_DIR):
        path.mkdir(parents=True, exist_ok=True)


def say_line(key: str, text: str) -> dict:
    aiff = Path("/tmp") / f"mira_{key}.aiff"
    wav = AUDIO_DIR / f"{key}.wav"
    subprocess.run(["say", "-v", VOICE, "-r", str(RATE), "-o", str(aiff), text], check=True)
    subprocess.run(
        ["afconvert", "-f", "WAVE", "-d", f"LEI16@{SAMPLE_RATE}", str(aiff), str(wav)],
        check=True,
    )
    with wave.open(str(wav), "rb") as handle:
        duration = handle.getnframes() / handle.getframerate()
    return {
        "key": key,
        "text": text,
        "url": f"/assets/audio/{key}.wav",
        "durationMs": int(duration * 1000),
        "voice": VOICE,
    }


def write_wav(path: Path, samples: list[float], rate: int = SAMPLE_RATE) -> None:
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        frames = bytearray()
        for value in samples:
            clamped = max(-1.0, min(1.0, value))
            frames += int(clamped * 32767).to_bytes(2, "little", signed=True)
        handle.writeframes(bytes(frames))


def silence() -> dict:
    path = AUDIO_DIR / 'silence.wav'
    write_wav(path, [0.0] * int(SAMPLE_RATE * 0.12))
    return {'key': 'silence', 'url': '/assets/audio/silence.wav', 'durationMs': 120}


def thunder() -> dict:
    random.seed(11)
    seconds = 3.2
    count = int(SAMPLE_RATE * seconds)
    samples: list[float] = []
    low = 0.0
    for i in range(count):
        t = i / SAMPLE_RATE
        white = random.uniform(-1, 1)
        low = low * 0.97 + white * 0.03
        envelope = math.exp(-t * 1.8) * min(1.0, t * 7)
        rumble = math.sin(2 * math.pi * (48 - t * 7) * t) * 0.4
        samples.append((low * 2.2 + rumble) * envelope * 0.7)
    path = AMBIENCE_DIR / "thunder.wav"
    write_wav(path, samples)
    return {"key": "thunder", "url": "/assets/ambience/thunder.wav", "durationMs": int(seconds * 1000)}


def photo() -> dict:
    """A warm Polaroid-like café photograph for the media event."""
    import random as _random
    from PIL import ImageEnhance
    source = FRONTEND_ASSETS / "backgrounds" / "cafe_urban.webp"
    if not source.exists():
        raise FileNotFoundError(f"café background missing: {source}")
    image = Image.open(source).convert("RGB")
    w, h = image.size
    # Portrait crop around the arched window, city street and café tables.
    crop_w = int(w * 0.37)
    crop_h = int(crop_w * 4 / 3)
    left = int(w * 0.285)
    top = int(h * 0.07)
    image = image.crop((left, top, left + crop_w, min(h, top + crop_h)))
    image = image.resize((900, 1200), Image.LANCZOS)
    image = ImageEnhance.Color(image).enhance(1.06)
    image = ImageEnhance.Contrast(image).enhance(0.96)
    image = image.filter(ImageFilter.GaussianBlur(0.35))
    warm = Image.new("RGB", image.size, (255, 214, 160))
    image = Image.blend(image, warm, 0.055)
    overlay = Image.new("L", image.size, 0)
    odraw = ImageDraw.Draw(overlay)
    for i in range(55):
        inset = i * 7
        odraw.rectangle([inset, inset, image.size[0] - inset, image.size[1] - inset], outline=255 - i * 3)
    overlay = overlay.filter(ImageFilter.GaussianBlur(80))
    black = Image.new("RGB", image.size, (35, 20, 10))
    image = Image.composite(image, black, overlay.point(lambda p: 255 - p // 2))
    pixels = image.load()
    _random.seed(12)
    for _ in range(22000):
        x, y = _random.randrange(900), _random.randrange(1200)
        r, g, b = pixels[x, y]
        noise = _random.randint(-7, 7)
        pixels[x, y] = (max(0, min(255, r + noise)), max(0, min(255, g + noise)), max(0, min(255, b + noise)))
    path = MEDIA_DIR / "photo_star.png"
    image.save(path, optimize=True)
    return {"key": "photo_star", "url": "/assets/media/photo_star.png", "width": 900, "height": 1200}


def main() -> None:
    ensure_dirs()
    voices = [say_line(key, text) for key, text in LINES.items()]
    ambience = [thunder()]
    silence()
    media = [photo()]
    manifest = {
        "voice": voices,
        "ambience": ambience,
        "media": media,
        "generator": "scripts/generate_assets.py",
        "notes": "Original procedural prototype assets; macOS Tingting voice; no external API.",
    }
    (FRONTEND_ASSETS / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    BACKEND_ASSETS.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(json.dumps({"voice": len(voices), "ambience": len(ambience), "media": len(media)}, ensure_ascii=False))
    for item in voices:
        print(f"{item['key']}: {item['durationMs']}ms")


if __name__ == "__main__":
    main()
