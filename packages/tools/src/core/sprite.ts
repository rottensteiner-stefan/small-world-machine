/**
 * Pure RGBA-buffer sprite operations, extracted from `common/image/CanvasOps.ts`
 * (`cropImage`/`autocropImage`/`flipImage`/`padToPowerOfTwo`) and
 * `common/image/SmartSegmentation.ts` (`detectSpriteBounds`).
 *
 * The originals keep their exact `ImageData`-based public signatures and now delegate
 * here, so existing consumers compile and behave unchanged. This module only ever sees
 * `RgbaImage` (`{ width, height, data }`) -- deterministic, DOM-free, byte-reproducible.
 */

import type { RgbaImage } from "./RasterIO.js";

export interface SpriteBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpriteDetectionOptions {
  alphaThreshold?: number; // 0-255 (default 10)
  minWidth?: number; // min sprite width in px (default 8)
  minHeight?: number; // min sprite height in px (default 8)
  padding?: number; // padding around detected box (default 0)
}

/** Crops a RGBA buffer to the specified rectangle (clamped, at least 1x1). */
export function cropRgba(src: RgbaImage, x: number, y: number, w: number, h: number): RgbaImage {
  const startX = Math.max(0, Math.min(src.width, Math.floor(x)));
  const startY = Math.max(0, Math.min(src.height, Math.floor(y)));
  const endX = Math.max(startX, Math.min(src.width, Math.floor(x + w)));
  const endY = Math.max(startY, Math.min(src.height, Math.floor(y + h)));
  const outW = Math.max(1, endX - startX);
  const outH = Math.max(1, endY - startY);

  const out = new Uint8ClampedArray(outW * outH * 4);
  const srcData = src.data;
  const dstData = out;

  for (let row = 0; row < outH; row++) {
    for (let col = 0; col < outW; col++) {
      const srcIdx = ((startY + row) * src.width + (startX + col)) * 4;
      const dstIdx = (row * outW + col) * 4;
      dstData[dstIdx] = srcData[srcIdx]!;
      dstData[dstIdx + 1] = srcData[srcIdx + 1]!;
      dstData[dstIdx + 2] = srcData[srcIdx + 2]!;
      dstData[dstIdx + 3] = srcData[srcIdx + 3]!;
    }
  }
  return { width: outW, height: outH, data: out };
}

/** Autocrops transparent padding around the image (returns 1x1 when fully empty). */
export function autocropRgba(src: RgbaImage, alphaThreshold = 10): RgbaImage {
  const w = src.width;
  const h = src.height;
  const data = src.data;

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3]!;
      if (a > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { width: 1, height: 1, data: new Uint8ClampedArray(4) };
  }

  return cropRgba(src, minX, minY, maxX - minX + 1, maxY - minY + 1);
}

/** Flips a RGBA buffer horizontally and/or vertically. */
export function flipRgba(src: RgbaImage, horizontal = true, vertical = false): RgbaImage {
  const w = src.width;
  const h = src.height;
  const out = new Uint8ClampedArray(w * h * 4);
  const sData = src.data;
  const dData = out;

  for (let y = 0; y < h; y++) {
    const srcY = vertical ? h - 1 - y : y;
    for (let x = 0; x < w; x++) {
      const srcX = horizontal ? w - 1 - x : x;
      const sIdx = (srcY * w + srcX) * 4;
      const dIdx = (y * w + x) * 4;
      dData[dIdx] = sData[sIdx]!;
      dData[dIdx + 1] = sData[sIdx + 1]!;
      dData[dIdx + 2] = sData[sIdx + 2]!;
      dData[dIdx + 3] = sData[sIdx + 3]!;
    }
  }
  return { width: w, height: h, data: out };
}

/** Pads a RGBA buffer to the next power-of-two dimensions (centered). */
export function padToPowerOfTwoRgba(src: RgbaImage): RgbaImage {
  function nextPot(n: number): number {
    let p = 1;
    while (p < n) p <<= 1;
    return p;
  }
  const potW = nextPot(src.width);
  const potH = nextPot(src.height);
  if (potW === src.width && potH === src.height) {
    return { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) };
  }

  const out = new Uint8ClampedArray(potW * potH * 4);
  const dData = out;
  const sData = src.data;
  const offsetX = Math.floor((potW - src.width) / 2);
  const offsetY = Math.floor((potH - src.height) / 2);

  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const sIdx = (y * src.width + x) * 4;
      const dIdx = ((y + offsetY) * potW + (x + offsetX)) * 4;
      dData[dIdx] = sData[sIdx]!;
      dData[dIdx + 1] = sData[sIdx + 1]!;
      dData[dIdx + 2] = sData[sIdx + 2]!;
      dData[dIdx + 3] = sData[sIdx + 3]!;
    }
  }
  return { width: potW, height: potH, data: out };
}

/**
 * Connected-Component Labeling (CCL) to detect isolated opaque sprite islands on a
 * sprite sheet. Same algorithm as `SmartSegmentation.detectSpriteBounds`, on a plain
 * RGBA buffer instead of an ImageData.
 */
export function detectSpriteBoundsRgba(
  image: RgbaImage,
  options: SpriteDetectionOptions = {},
): SpriteBounds[] {
  const width = image.width;
  const height = image.height;
  const data = image.data;
  const alphaThreshold = options.alphaThreshold ?? 10;
  const minW = options.minWidth ?? 8;
  const minH = options.minHeight ?? 8;
  const padding = options.padding ?? 0;

  const visited = new Uint8Array(width * height);
  const boxes: SpriteBounds[] = [];

  const queueX = new Int32Array(width * height);
  const queueY = new Int32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx]) continue;
      const alpha = data[idx * 4 + 3]!;
      if (alpha <= alphaThreshold) {
        visited[idx] = 1;
        continue;
      }

      // BFS to flood connected component
      let qHead = 0;
      let qTail = 0;
      queueX[qTail] = x;
      queueY[qTail] = y;
      qTail++;
      visited[idx] = 1;

      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;

      while (qHead < qTail) {
        const cx = queueX[qHead]!;
        const cy = queueY[qHead]!;
        qHead++;

        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        // 8-way neighbors
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            const ny = cy + dy;

            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nIdx = ny * width + nx;
              if (!visited[nIdx]) {
                visited[nIdx] = 1;
                if (data[nIdx * 4 + 3]! > alphaThreshold) {
                  queueX[qTail] = nx;
                  queueY[qTail] = ny;
                  qTail++;
                }
              }
            }
          }
        }
      }

      const w = maxX - minX + 1;
      const h = maxY - minY + 1;

      if (w >= minW && h >= minH) {
        const clampedX = Math.max(0, minX - padding);
        const clampedY = Math.max(0, minY - padding);
        const clampedW = Math.min(width - clampedX, w + padding * 2);
        const clampedH = Math.min(height - clampedY, h + padding * 2);

        boxes.push({
          x: clampedX,
          y: clampedY,
          w: clampedW,
          h: clampedH,
        });
      }
    }
  }

  return sortSpriteBoxes(boxes);
}

/** Row band height (px): boxes whose top edge lies within this distance of the row's first box share a row. */
const ROW_TOLERANCE = 16;

/**
 * Sprite-sheet reading order: top-to-bottom rows, left-to-right inside a row. Rows are formed by
 * clustering against the row's anchor (first box by y) -- a pairwise "within 16px" comparator is
 * not a strict weak ordering (not transitive), which made the order depend on the sort algorithm
 * for dense sheets.
 */
export function sortSpriteBoxes(boxes: SpriteBounds[]): SpriteBounds[] {
  const byY = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: SpriteBounds[] = [];
  let row: SpriteBounds[] = [];
  let anchorY = 0;
  const flush = (): void => {
    row.sort((a, b) => a.x - b.x || a.y - b.y);
    out.push(...row);
    row = [];
  };
  for (const box of byY) {
    if (row.length > 0 && box.y - anchorY > ROW_TOLERANCE) flush();
    if (row.length === 0) anchorY = box.y;
    row.push(box);
  }
  flush();
  return out;
}
