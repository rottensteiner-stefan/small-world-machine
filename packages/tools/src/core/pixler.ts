/**
 * Pure RGBA-buffer pixel ops as used by the Pixler tool: flood fill, flip/mirror,
 * wrap-around pan and trimming. No toolbar/UI logic -- deterministic and headless.
 *
 * `floodFill` and `computeTrimBounds` already live as pure functions in
 * `common/dsp/CanvasOperations.ts`; they are re-exported here as single source.
 * `flipRgba` is lifted from `core/sprite.ts` (identical operation, no duplication).
 * `Pixler.ts` keeps its browser-side methods and re-exports this surface unchanged.
 */

import { computeTrimBounds, floodFill } from "../common/dsp/CanvasOperations.js";
import { cropRgba, flipRgba } from "./sprite.js";
import type { RgbaImage } from "./RasterIO.js";

export { computeTrimBounds, floodFill, flipRgba };

export interface PixlerTrimOptions {
  /** Optional background color (RGBA) treated as empty on top of full transparency. */
  backgroundColor?: readonly [number, number, number, number];
}

/** Flip/mirror alias (delegates to `core/sprite.flipRgba`). */
export function mirrorRgba(src: RgbaImage, horizontal = true, vertical = false): RgbaImage {
  return flipRgba(src, horizontal, vertical);
}

/**
 * Pans a RGBA buffer in both axes with wrap-around, mirroring the tiling behaviour
 * of the Pixler pan tool. Positive modulo keeps the result deterministic.
 */
export function panRgba(src: RgbaImage, dx: number, dy: number): RgbaImage {
  const w = src.width;
  const h = src.height;
  const ox = ((dx % w) + w) % w;
  const oy = ((dy % h) + h) % h;
  const out = new Uint8ClampedArray(w * h * 4);
  const sData = src.data;

  for (let y = 0; y < h; y++) {
    const srcY = (((y - oy) % h) + h) % h;
    for (let x = 0; x < w; x++) {
      const srcX = (((x - ox) % w) + w) % w;
      const sIdx = (srcY * w + srcX) * 4;
      const dIdx = (y * w + x) * 4;
      out[dIdx] = sData[sIdx]!;
      out[dIdx + 1] = sData[sIdx + 1]!;
      out[dIdx + 2] = sData[sIdx + 2]!;
      out[dIdx + 3] = sData[sIdx + 3]!;
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * Trims transparent (and optionally background-colored) borders, mirroring the
 * Pixler trim action. Returns a 1x1 transparent buffer when nothing is foreground.
 */
export function trimRgba(src: RgbaImage, options: PixlerTrimOptions = {}): RgbaImage {
  const w = src.width;
  const h = src.height;
  const data = src.data;
  const bg = options.backgroundColor;

  const isBackground = (x: number, y: number): boolean => {
    const i = (y * w + x) * 4;
    const a = data[i + 3]!;
    if (a === 0) return true;
    if (bg === undefined) return false;
    return data[i] === bg[0] && data[i + 1] === bg[1] && data[i + 2] === bg[2] && a === bg[3];
  };

  const bounds = computeTrimBounds(w, h, isBackground);
  if (!bounds) {
    return { width: 1, height: 1, data: new Uint8ClampedArray(4) };
  }
  return cropRgba(src, bounds.x, bounds.y, bounds.width, bounds.height);
}
