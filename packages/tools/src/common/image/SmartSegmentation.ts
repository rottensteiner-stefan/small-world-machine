import { detectSpriteBoundsRgba } from "../../core/sprite.js";

export interface SpriteBoundingBox {
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

/**
 * Connected-Component Labeling (CCL) to detect isolated opaque sprite islands on a canvas/sprite sheet.
 * Pure implementation lives in `core/sprite.ts` (`detectSpriteBoundsRgba`).
 */
export function detectSpriteBounds(
  imageData: ImageData,
  options: SpriteDetectionOptions = {},
): SpriteBoundingBox[] {
  return detectSpriteBoundsRgba(
    { width: imageData.width, height: imageData.height, data: imageData.data },
    options,
  );
}

/**
 * Magic Wand Flood-Fill: Returns bounding box and binary alpha mask for contiguous color region.
 */
export function magicWand(
  imageData: ImageData,
  startX: number,
  startY: number,
  tolerance: number = 32,
): { box: SpriteBoundingBox; mask: Uint8Array } | null {
  const width = imageData.width;
  const height = imageData.height;
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return null;

  const data = imageData.data;
  const startIdx = (startY * width + startX) * 4;
  const targetR = data[startIdx]!;
  const targetG = data[startIdx + 1]!;
  const targetB = data[startIdx + 2]!;
  const targetA = data[startIdx + 3]!;

  const visited = new Uint8Array(width * height);
  const mask = new Uint8Array(width * height);
  const queueX = new Int32Array(width * height);
  const queueY = new Int32Array(width * height);

  let qHead = 0;
  let qTail = 0;
  queueX[qTail] = startX;
  queueY[qTail] = startY;
  qTail++;
  visited[startY * width + startX] = 1;
  mask[startY * width + startX] = 255;

  let minX = startX;
  let maxX = startX;
  let minY = startY;
  let maxY = startY;

  const tolSq = tolerance * tolerance * 4;

  while (qHead < qTail) {
    const cx = queueX[qHead]!;
    const cy = queueY[qHead]!;
    qHead++;

    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;

    const neighbors: Array<[number, number]> = [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ];

    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nIdx = ny * width + nx;
        if (!visited[nIdx]) {
          visited[nIdx] = 1;
          const pxIdx = nIdx * 4;
          const dr = data[pxIdx]! - targetR;
          const dg = data[pxIdx + 1]! - targetG;
          const db = data[pxIdx + 2]! - targetB;
          const da = data[pxIdx + 3]! - targetA;
          const distSq = dr * dr + dg * dg + db * db + da * da;

          if (distSq <= tolSq) {
            mask[nIdx] = 255;
            queueX[qTail] = nx;
            queueY[qTail] = ny;
            qTail++;
          }
        }
      }
    }
  }

  return {
    box: {
      x: minX,
      y: minY,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
    },
    mask,
  };
}
