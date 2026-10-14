"""
Generates a seamless Calacatta-Gold marble PBR set (white stone, bold grey veins, thin gold inlays):
  marble_gold_diffuse / _normal / _roughness / _metalness  (.webp)
Usage: python3 scripts/gen-marble-textures.py [outDir] [seed]   (default apps/showcases/27/assets, seed 7)
Needs numpy, Pillow and `cwebp` on PATH. Everything is built from integer-frequency sines, so it tiles seamlessly.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

SIZE = 1024
out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "apps/showcases/27/assets")
rng = np.random.default_rng(int(sys.argv[2]) if len(sys.argv) > 2 else 7)
out_dir.mkdir(parents=True, exist_ok=True)

coords = np.arange(SIZE) / SIZE
X, Y = np.meshgrid(coords, coords)


def fbm(octaves: int, base_freq: int, gain: float = 0.55, waves: int = 5) -> np.ndarray:
    """Periodic fractal noise in [-1, 1]: random integer-frequency sine waves per octave."""
    total = np.zeros_like(X)
    amp = 1.0
    for o in range(octaves):
        for _ in range(waves):
            f = base_freq * 2**o
            kx, ky = rng.integers(-f, f + 1, size=2)
            total += amp * np.sin(2 * np.pi * (kx * X + ky * Y) + rng.uniform(0, 2 * np.pi))
        amp *= gain
    return total / np.abs(total).max()


def ridge(field: np.ndarray, sharpness: float) -> np.ndarray:
    """1 on the zero crossings of `field`, falling off quickly: thin vein lines."""
    return np.clip(1.0 - np.abs(np.sin(field)), 0, 1) ** sharpness


def turbulence(octaves: int, base_freq: int) -> np.ndarray:
    """Creased noise: |noise| per octave gives the angular kinks of real marble veins."""
    total = np.zeros_like(X)
    amp = 1.0
    for o in range(octaves):
        total += amp * np.abs(fbm(1, base_freq * 2**o, waves=6))
        amp *= 0.5
    return total


turb = turbulence(5, 2)
feather = fbm(2, 12)  # fine jitter along the vein edges

# Veins are zero crossings of a diagonal stripe field distorted by the turbulence.
stripes = 2 * np.pi * (1 * X + 2 * Y)
field_a = stripes + 3.2 * turb + 0.6 * feather
field_b = 2 * np.pi * (2 * X + 3 * Y) + 2.2 * turb + 0.8 * feather
field_g = field_a + 0.35  # gold runs beside the main veins, like mineral seeping along a crack

# Low-frequency masks so veins swell and fade like in real stone.
mask_main = np.clip(0.35 + 1.4 * fbm(2, 1), 0, 1)
mask_gold = np.clip(0.60 + 1.4 * fbm(2, 1), 0, 1)

main = ridge(field_a, 16) + 0.5 * ridge(field_a, 4)  # sharp core plus soft shadowy halo
main = np.clip(main, 0, 1) * mask_main
cross = ridge(field_b, 24) * 0.7 * np.clip(0.4 + fbm(2, 2), 0, 1)

# Richer gold inlays: bold seam adjacent to grey veins, plus secondary branch and shimmering filigree
gold_a = ridge(field_g, 6) * 1.0 + 0.6 * ridge(field_g, 2.5) * 0.7
gold_b = ridge(field_b + 0.35, 8) * 0.8 + 0.5 * ridge(field_a - 0.3, 5) * 0.6
gold = np.clip((gold_a + gold_b) * mask_gold, 0, 1)

# Soft translucent clouds inside the stone.
cloud = 0.5 + 0.5 * fbm(5, 1, gain=0.6)
base = np.array([0.94, 0.93, 0.91])[None, None, :] * (0.94 + 0.06 * cloud[..., None])
base = base * (1 - 0.05 * cloud[..., None] * np.array([0.0, 0.2, 0.4]))  # faint cool haze

grey_vein = np.array([0.34, 0.35, 0.38])
gold_color = np.array([1.0, 0.78, 0.26])  # Vibrant 24K radiant gold
vein = np.clip(main + 0.5 * cross, 0, 1)[..., None]
color = base * (1 - vein) + grey_vein * vein
color = color * (1 - gold[..., None]) + gold_color * gold[..., None]

# Polished stone: low roughness, slightly rougher in stone veins, highly reflective for gold
roughness = np.clip(0.18 + 0.10 * vein[..., 0] + 0.06 * cloud - 0.12 * gold, 0.06, 1)
metalness = np.clip(gold * 1.4, 0, 1)

# Normal map: veins sit slightly lower; gold has subtle beveled micro-relief
height = -0.012 * (main + 0.5 * cross) + 0.005 * gold
dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * SIZE * 0.5
dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * SIZE * 0.5
normal = np.stack([-dx, dy, np.ones_like(dx)], axis=-1)  # GL convention (+Y up)
normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
normal = normal * 0.5 + 0.5


def save(name: str, data: np.ndarray) -> None:
    rgb = (np.clip(data, 0, 1) * 255).astype(np.uint8)
    img = Image.fromarray(rgb if rgb.ndim == 3 else rgb, mode="RGB" if rgb.ndim == 3 else "L")
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / f"{name}.png"
        img.save(png)
        subprocess.run(["cwebp", "-q", "90", "-quiet", str(png), "-o", str(out_dir / f"{name}.webp")], check=True)
    print("wrote", out_dir / f"{name}.webp")


save("marble_gold_diffuse", color)
save("marble_gold_normal", normal)
save("marble_gold_roughness", roughness)
save("marble_gold_metalness", metalness)
