"""
Generates a dark dusk-sky equirect panorama (PNG) for IBL baking: indigo zenith, ember glow at one horizon
sector, faint milky-way band (no stars: at cube resolution they blow up into soft dots). Feed it to `npm run ibl:bake -- --input <png> --linear`.
Usage: python3 scripts/gen-night-sky-panorama.py [out.png] [seed]
"""
import sys

import numpy as np
from PIL import Image

W, H = 2048, 1024
out = sys.argv[1] if len(sys.argv) > 1 else ".agents/scratches/night_sky.png"
rng = np.random.default_rng(int(sys.argv[2]) if len(sys.argv) > 2 else 5)

u = (np.arange(W) + 0.5) / W
v = (np.arange(H) + 0.5) / H
az = (u[None, :] - 0.5) * 2 * np.pi
el = (0.5 - v[:, None]) * np.pi  # +pi/2 at the zenith

def mix(a, b, t):
    return a + (b - a) * t[..., None]

zenith = np.array([0.002, 0.003, 0.010])  # Deep midnight obsidian / navy
mid = np.array([0.008, 0.010, 0.024])     # Deep twilight indigo
ember = np.array([0.92, 0.38, 0.12])     # Warm golden-amber sunset glow at horizon
haze_color = np.array([0.05, 0.04, 0.08]) # Subtle dusk haze (eliminates milky purple cast)

up = np.clip(np.sin(el), 0, 1) * np.ones_like(az)
sky = mix(mid, zenith, up ** 0.5)

# Ember glow hugging the horizon closely, focused in one sector for directional warmth.
sector = 0.25 + 0.75 * (0.5 + 0.5 * np.cos(az - 0.9)) ** 2
elev = np.abs(el) * np.ones_like(az)
glow = np.exp(-elev / 0.045) * sector
haze = np.exp(-elev / 0.18) * sector
sky = sky + haze_color * haze[..., None] * 0.12 + ember * glow[..., None] * 0.25

# Below the horizon: dark, so the floor never reads a bright ground in reflections.
below = np.clip(-np.sin(el), 0, 1) * np.ones_like(az)
sky = mix(sky, np.array([0.005, 0.005, 0.008]) * np.ones_like(sky), np.clip(below * 6, 0, 1))

# Faint milky-way band: great circle tilted, modulated by subtle noise.
nx, ny, nz = np.cos(el) * np.cos(az), np.sin(el), np.cos(el) * np.sin(az)
n = np.array([0.35, 0.8, 0.5]); n /= np.linalg.norm(n)
dist = nx * n[0] + ny * n[1] + nz * n[2]
band = np.exp(-(dist / 0.12) ** 2)
noise = np.array(Image.fromarray((rng.random((64, 128)) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)) / 255
sky = sky + np.array([0.04, 0.05, 0.08]) * (band * noise * (up > 0.02))[..., None] * 0.12

# Stored linear (bake with --linear): dark gradients need dithering or 8 bit bands badly.
dither = rng.random((H, W, 1)) - 0.5
Image.fromarray(np.clip(sky * 255 + dither, 0, 255).round().astype(np.uint8)).save(out)
print("wrote", out)
