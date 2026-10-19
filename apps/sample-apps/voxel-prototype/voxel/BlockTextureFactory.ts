import { TextureFilter, TextureWrap } from "@small-world-machine/engine";
import type { TextureArray } from "@small-world-machine/engine/core/textures/index.js";
import { TextureArray as TextureArrayImpl } from "@small-world-machine/engine/core/textures/index.js";
import { BLOCK_TEX_LAYER } from "./BlockRegistry.js";

/**
 * Builds the M0 block palette as a `TextureArray` from procedural canvas swatches -- no
 * borrowed asset, no Mojang textures, fully CC0-by-construction (dossier §2/§5.4 asset
 * cleanliness). Each layer is a distinct, deterministic color family with per-pixel speckle,
 * which both proves real texture sampling in the browser AND makes any wrong-layer/bleed bug
 * visually unmistakable (wrong layer = wrong color family).
 *
 * Browser-only (canvases + `createImageBitmap`); unit tests never touch this module, so the
 * pure voxel data layer stays node-testable.
 *
 * Layer 0/1/2 MUST stay in sync with `BLOCK_TEX_LAYER` in `BlockRegistry.ts`.
 */
const PALETTE_LAYERS: readonly {
  layer: number;
  base: readonly [number, number, number];
  tint: number;
}[] = [
  { layer: BLOCK_TEX_LAYER.GRASS_TOP, base: [62, 132, 62], tint: 0 },
  { layer: BLOCK_TEX_LAYER.DIRT, base: [128, 92, 62], tint: 0 },
  { layer: BLOCK_TEX_LAYER.STONE, base: [128, 128, 132], tint: 20 },
] as const;

const SWATCH_SIZE = 16;

/** Deterministic speckle so the pattern is stable across loads (no Math.random). */
function speckle(x: number, y: number, seed: number): number {
  // A small integer hash -- deterministic, no allocation, plenty for visual noise.
  let h = x * 374761393 + y * 668265263 + seed * 2654435769;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) % 256;
}

function drawLayer(base: readonly [number, number, number], seed: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SWATCH_SIZE;
  canvas.height = SWATCH_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("[BlockTextureFactory] 2d context unavailable");

  const img = ctx.createImageData(SWATCH_SIZE, SWATCH_SIZE);
  for (let y = 0; y < SWATCH_SIZE; y++) {
    for (let x = 0; x < SWATCH_SIZE; x++) {
      const s = speckle(x, y, seed) / 255.0;
      const offset = (s - 0.5) * 46;
      const i = (y * SWATCH_SIZE + x) * 4;
      const r = Math.max(0, Math.min(255, Math.round(base[0]! + offset)));
      const g = Math.max(0, Math.min(255, Math.round(base[1]! + offset)));
      const b = Math.max(0, Math.min(255, Math.round(base[2]! + offset)));
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Creates the block palette `TextureArray`. Nearest filtering + no mipmaps + clamp-to-edge
 * keep sampling crisp and bleeding-free; the swatch is square so the face mask has no
 * orientation to violate.
 */
export async function createBlockPalette(): Promise<TextureArray> {
  const canvases: HTMLCanvasElement[] = [];
  for (const entry of PALETTE_LAYERS) {
    canvases.push(drawLayer(entry.base, entry.tint));
  }
  const bitmaps: ImageBitmap[] = [];
  for (const canvas of canvases) {
    bitmaps.push(await createImageBitmap(canvas));
  }
  return TextureArrayImpl.fromImages(bitmaps, {
    minFilter: TextureFilter.NEAREST,
    magFilter: TextureFilter.NEAREST,
    generateMipmaps: false,
    addressModeU: TextureWrap.CLAMP_TO_EDGE,
    addressModeV: TextureWrap.CLAMP_TO_EDGE,
  });
}
