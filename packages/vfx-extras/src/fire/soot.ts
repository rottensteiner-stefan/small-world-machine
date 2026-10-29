import { Texture } from "@small-world-machine/engine";

const SOOT_SIZE = 256;

/**
 * Procedural scorch-mark texture for a fire's soot/ash ground decal (`DecalMaterial`):
 * a dark irregular splotch with feathered edges and ashy speckle, baked from a deterministic hash
 * (no `Math.random`), sized so a `Decal` of ~1.5 m reads as a burnt patch under a campfire.
 *
 * The coverage lives in the ALPHA channel (the decal path alpha-blends against the opaque depth,
 * ADR 0029); brightness in RGB. Returns `undefined` headless, where the decal simply has no
 * texture (tests never require one — same contract as `createEmberSpriteTexture`).
 */
export function createSootDecalTexture(): Texture | undefined {
  // Headless test environments have no DOM; the decal then stays texture-less and invisible in
  // the baked mesh tests, which only assert structure, not pixels.
  if (typeof document === "undefined") {
    return undefined;
  }
  const canvas = document.createElement("canvas");
  canvas.width = SOOT_SIZE;
  canvas.height = SOOT_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    return undefined;
  }

  const image = context.createImageData(SOOT_SIZE, SOOT_SIZE);
  const data = image.data;
  const center = (SOOT_SIZE - 1) / 2;
  // Soot coverage: a base with dark overlapping splotches whose edges feather out softly.
  const blotches = [
    { dx: 0, dy: 0, r: 0.5 },
    { dx: 0.22, dy: -0.1, r: 0.34 },
    { dx: -0.24, dy: 0.16, r: 0.3 },
    { dx: 0.08, dy: 0.3, r: 0.28 },
    { dx: -0.05, dy: -0.34, r: 0.26 },
    { dx: 0.3, dy: 0.24, r: 0.2 },
    { dx: -0.32, dy: -0.26, r: 0.18 },
  ];
  for (let y = 0; y < SOOT_SIZE; y++) {
    for (let x = 0; x < SOOT_SIZE; x++) {
      const offset = (y * SOOT_SIZE + x) * 4;
      const u = (x - center) / SOOT_SIZE;
      const v = (y - center) / SOOT_SIZE;
      let coverage = 0;
      for (let b = 0; b < blotches.length; b++) {
        const bl = blotches[b]!;
        const bx = u - bl.dx;
        const by = v - bl.dy;
        const falloff = Math.exp(-((bx * bx + by * by) / (bl.r * bl.r)));
        coverage = Math.max(coverage, falloff);
      }
      // Irregular, slightly charred rim from the same deterministic hash on both axes.
      const speckle = sootHash(u * 27, v * 31);
      const rim = 1 - smoothstep05(coverage);
      const edgeDrift = (sootHash(u * 11 + 5, v * 7 + 3) - 0.5) * 0.18;
      const alpha = Math.max(0, Math.min(1, coverage - rim * 0.05 - edgeDrift));
      // Soot is dark and matte; scattered ash motes keep it from reading as flat black.
      const gray = 0.07 + 0.05 * speckle + 0.08 * (1 - alpha);
      const warm = 0.05 * (1 - alpha);
      data[offset] = Math.round(255 * (gray + warm));
      data[offset + 1] = Math.round(255 * gray);
      data[offset + 2] = Math.round(255 * (gray - warm));
      data[offset + 3] = Math.round(255 * alpha);
    }
  }
  context.putImageData(image, 0, 0);
  return Texture.fromCanvas(canvas);
}

/** Deterministic 0..1 hash; keeps the baked patch identical across runs (golden-compatible). */
function sootHash(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep05(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}
