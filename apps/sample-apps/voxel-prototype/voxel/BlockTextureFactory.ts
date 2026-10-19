import { TextureFilter, TextureWrap } from "@small-world-machine/engine";
import type { TextureArray } from "@small-world-machine/engine/core/textures/index.js";
import { TextureArray as TextureArrayImpl } from "@small-world-machine/engine/core/textures/index.js";
import { BLOCK_TEX_LAYER } from "./BlockRegistry.js";
import { ATLAS_PIXEL_HEX, decodeHexRgba } from "./palette/AtlasPixels.js";

/**
 * Builds the M2 block palette as a `TextureArray` from the EMBEDDED 16x16 pixel grids
 * (`voxel/palette/AtlasPixels.ts`, reload: CC0 "16x16 Block Texture Set" (2023) by
 * ARoachIFoundOnMyPillow + Water-Nachzeichnung). No borrowed Mojang textures, provenance in
 * `AtlasPixels.ATLAS_SOURCES`. Switching from the M0 procedural swatches to real art is the
 * M2 atlas turn-in (Entscheid 2026-10-19); the layer indices must match `BLOCK_TEX_LAYER`,
 * which the factory enforces fail-fast here and which a node test pins on the data level
 * (palette/AtlasPixels keys vs BLOCK_TEX_LAYER keys).
 *
 * Browser-only (canvases + `createImageBitmap`); unit tests never touch this module, so the
 * pure voxel/data layer stays node-testable.
 *
 * Nearest + clamp keeps sampling crisp and bleed-free (TextureArray eliminates atlas seams);
 * the WATER layer carries per-pixel alpha for the transparent water render (M2).
 */
const SWATCH_SIZE = 16;

function canvasFromRgba(rgba: Uint8Array): HTMLCanvasElement {
  if (rgba.length !== SWATCH_SIZE * SWATCH_SIZE * 4) {
    throw new Error(
      `[BlockTextureFactory] expected ${SWATCH_SIZE * SWATCH_SIZE * 4} rgba bytes, got ${rgba.length}`,
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = SWATCH_SIZE;
  canvas.height = SWATCH_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("[BlockTextureFactory] 2d context unavailable");
  const img = ctx.createImageData(SWATCH_SIZE, SWATCH_SIZE);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Creates the block palette `TextureArray`. Layer order follows `BLOCK_TEX_LAYER` indices
 * (the sampler2DArray layer selector in the block shader). Fails fast on any
 * registry/atlas-pixel desync.
 */
export async function createBlockPalette(): Promise<TextureArray> {
  const entries = Object.entries(BLOCK_TEX_LAYER) as ReadonlyArray<readonly [string, number]>;
  const highest = Math.max(...entries.map(([, index]) => index));
  const canvases: Array<HTMLCanvasElement | null> = new Array<HTMLCanvasElement | null>(
    highest + 1,
  ).fill(null);

  for (const [name, index] of entries) {
    const hex = ATLAS_PIXEL_HEX[name];
    if (hex === undefined) {
      throw new Error(`[BlockTextureFactory] atlas pixel layer "${name}" fehlt in AtlasPixels`);
    }
    canvases[index] = canvasFromRgba(decodeHexRgba(hex));
  }

  const missing = canvases.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
  if (missing.length > 0) {
    throw new Error(
      `[BlockTextureFactory] BLOCK_TEX_LAYER verweist auf unbefüllte Layer-Indizes: ${missing.join(", ")}`,
    );
  }

  const bitmaps: ImageBitmap[] = [];
  for (const canvas of canvases) {
    bitmaps.push(await createImageBitmap(canvas!));
  }
  return TextureArrayImpl.fromImages(bitmaps, {
    minFilter: TextureFilter.NEAREST,
    magFilter: TextureFilter.NEAREST,
    generateMipmaps: false,
    addressModeU: TextureWrap.CLAMP_TO_EDGE,
    addressModeV: TextureWrap.CLAMP_TO_EDGE,
  });
}
