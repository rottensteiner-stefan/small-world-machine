/** Generates every integer point on a line via Bresenham's algorithm. */
export function bresenhamLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  let cx = x0;
  let cy = y0;
  while (true) {
    points.push([cx, cy]);
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      cx += sx;
    }
    if (e2 < dx) {
      err += dx;
      cy += sy;
    }
  }

  return points;
}

/** Stack-based flood fill: replaces every pixel matching the seed pixel's color with `fillColor`. */
export function floodFill(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  fillColor: readonly [number, number, number, number],
): void {
  const targetIdx = (startY * width + startX) * 4;
  const r = data[targetIdx]!;
  const g = data[targetIdx + 1]!;
  const b = data[targetIdx + 2]!;
  const a = data[targetIdx + 3]!;
  const [fr, fg, fb, fa] = fillColor;

  if (r === fr && g === fg && b === fb && a === fa) return;

  const match = (idx: number): boolean => {
    return data[idx] === r && data[idx + 1] === g && data[idx + 2] === b && data[idx + 3] === a;
  };

  const setPx = (idx: number): void => {
    data[idx] = fr;
    data[idx + 1] = fg;
    data[idx + 2] = fb;
    data[idx + 3] = fa;
  };

  const stack: [number, number][] = [[startX, startY]];
  while (stack.length > 0) {
    const [x, y] = stack.pop() as [number, number];
    const idx = (y * width + x) * 4;

    if (match(idx)) {
      setPx(idx);
      if (x > 0) stack.push([x - 1, y]);
      if (x < width - 1) stack.push([x + 1, y]);
      if (y > 0) stack.push([x, y - 1]);
      if (y < height - 1) stack.push([x, y + 1]);
    }
  }
}

/**
 * Scans a `width`x`height` grid for the bounding box of every pixel `isBackground` reports as
 * foreground. `isBackground` stays caller-supplied so this stays reusable regardless of what a
 * given tool considers "background" (e.g. transparency-only vs. transparency-or-current-color).
 */
export function computeTrimBounds(
  width: number,
  height: number,
  isBackground: (x: number, y: number) => boolean,
): { x: number; y: number; width: number; height: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isBackground(x, y)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Returns a new canvas with `source`'s content flipped horizontally and/or vertically. */
export function flipCanvas(
  source: HTMLCanvasElement,
  horizontal: boolean,
  vertical: boolean,
): HTMLCanvasElement {
  const result = document.createElement("canvas");
  result.width = source.width;
  result.height = source.height;
  const ctx = result.getContext("2d")!;
  ctx.save();
  ctx.translate(horizontal ? source.width : 0, vertical ? source.height : 0);
  ctx.scale(horizontal ? -1 : 1, vertical ? -1 : 1);
  ctx.drawImage(source, 0, 0);
  ctx.restore();
  return result;
}
