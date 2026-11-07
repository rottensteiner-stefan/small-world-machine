/** Pure texel statistics for `check-normal-maps.ts` (kept separate so tests can import it without running the CLI). */

export interface NormalMapVerdict {
  greyscale: number;
  meanBlue: number;
  neighbourDeg: number;
}

/**
 * Samples every second texel pair of a tightly packed 8-bit RGB buffer.
 * Returns `null` when no pair can be sampled (width < 2 or height < 1): nothing was checked,
 * which must never be reported as "clean" (`grey / 0` is NaN and every threshold test is false).
 */
export function analyseRgb(rgb: Uint8Array, w: number, h: number): NormalMapVerdict | null {
  let grey = 0;
  let blue = 0;
  let angle = 0;
  let n = 0;
  const unit = (i: number): [number, number, number] => {
    const x = rgb[i * 3]! / 127.5 - 1;
    const y = rgb[i * 3 + 1]! / 127.5 - 1;
    const z = rgb[i * 3 + 2]! / 127.5 - 1;
    const len = Math.hypot(x, y, z) || 1;
    return [x / len, y / len, z / len];
  };
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w - 1; x += 2) {
      const i = y * w + x;
      const r = rgb[i * 3]!;
      const g = rgb[i * 3 + 1]!;
      const b = rgb[i * 3 + 2]!;
      if (Math.abs(r - g) < 6 && Math.abs(g - b) < 6) grey++;
      blue += b / 255;
      const a = unit(i);
      const c = unit(i + 1);
      angle += Math.acos(Math.max(-1, Math.min(1, a[0] * c[0] + a[1] * c[1] + a[2] * c[2])));
      n++;
    }
  }
  if (n === 0) return null;
  return { greyscale: grey / n, meanBlue: blue / n, neighbourDeg: (angle / n) * (180 / Math.PI) };
}
