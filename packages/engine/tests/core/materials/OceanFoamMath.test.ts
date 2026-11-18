import { describe, expect, it } from "vitest";

/**
 * CPU mirrors of the pure foam math in `Ocean.frag.{wgsl,glsl,glsl100}`.
 * Keep in sync with `borePhase`/`boreFront` and `oceanFoamCells`/`oceanHash2`.
 */

const BORE_TIME_RATE = 0.21;
const BORE_DEPTH_RATE = 0.35;
const BORE_CELL_WARP = 0.9;
const BORE_RISE = 0.07;
const BORE_FALL_END = 0.55;

function fract(x: number): number {
  return x - Math.floor(x);
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function borePhase(t: number, d: number, a: number): number {
  return fract(t * BORE_TIME_RATE + d * BORE_DEPTH_RATE + a * BORE_CELL_WARP);
}

function boreFront(phase: number): number {
  return smoothstep(0, BORE_RISE, phase) * (1 - smoothstep(BORE_RISE, BORE_FALL_END, phase));
}

function oceanHash2(px: number, py: number): number {
  const qx = fract(px * 123.34);
  const qy = fract(py * 456.21);
  const k = qx * (qx + 45.32) + qy * (qy + 45.32);
  const rx = qx + k;
  const ry = qy + k;
  return fract(rx * ry);
}

function featurePoint(cx: number, cy: number): [number, number] {
  return [cx + oceanHash2(cx, cy), cy + oceanHash2(cx + 31.7, cy + 17.3)];
}

function oceanFoamCells(px: number, py: number): number {
  const gx = Math.floor(px);
  const gy = Math.floor(py);
  const fx = px - gx;
  const fy = py - gy;
  let m = 1;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const [hx, hy] = featurePoint(gx + ox, gy + oy);
      m = Math.min(m, Math.hypot(hx - gx - fx, hy - gy - fy));
    }
  }
  return m;
}

describe("Ocean foam math (CPU mirror of the shader bore front and Worley cells)", () => {
  it("boreFront stays within [0, 1] for any phase", () => {
    for (let i = 0; i <= 1000; i++) {
      const v = boreFront(i / 1000);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("is zero at phase 0 and for every phase >= 0.55", () => {
    expect(boreFront(0)).toBe(0);
    for (let p = BORE_FALL_END; p < 1; p += 0.005) expect(boreFront(p)).toBe(0);
  });

  it("peaks near phase 0.07 at exactly 1", () => {
    let best = 0;
    let bestPhase = 0;
    for (let i = 0; i < 1000; i++) {
      const p = i / 1000;
      const v = boreFront(p);
      if (v > best) {
        best = v;
        bestPhase = p;
      }
    }
    expect(boreFront(BORE_RISE)).toBeCloseTo(1, 10);
    expect(best).toBeCloseTo(1, 6);
    expect(Math.abs(bestPhase - BORE_RISE)).toBeLessThan(0.01);
    // Sharp leading edge, long tail: rises over 0.07 phase, decays over 0.48.
    expect(boreFront(0.035)).toBeLessThan(boreFront(0.07 + 0.035));
  });

  it("travels toward smaller depth d as t grows", () => {
    const a = 0.3;
    const d0 = 4;
    const t0 = 0;
    // Phase at a fixed d increases with t (until wrapping).
    expect(borePhase(0.5, d0, a)).toBeGreaterThan(borePhase(t0, d0, a) - 1e-12);
    const front = (t: number): number => d0 - (t * BORE_TIME_RATE) / BORE_DEPTH_RATE;
    for (let t = 0; t < 3; t += 0.25) {
      expect(front(t + 0.25)).toBeLessThan(front(t));
      // The constant-phase contour keeps its phase while moving along d*(t).
      expect(borePhase(t, front(t), a)).toBeCloseTo(borePhase(t0, d0, a), 9);
      expect(borePhase(t + 0.25, front(t + 0.25), a)).toBeCloseTo(borePhase(t0, d0, a), 9);
    }
    // Unwrapped phase of fixed d strictly grows with t.
    const raw = (t: number): number =>
      t * BORE_TIME_RATE + d0 * BORE_DEPTH_RATE + a * BORE_CELL_WARP;
    expect(raw(2)).toBeGreaterThan(raw(1));
  });

  it("Worley F1 mirror is deterministic and bounded in [0, sqrt(2)]", () => {
    for (let i = 0; i < 400; i++) {
      const x = ((i * 0.7371) % 17.3) - 8;
      const y = ((i * 1.3113) % 11.9) - 5;
      const v = oceanFoamCells(x, y);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(Math.SQRT2);
      expect(oceanFoamCells(x, y)).toBe(v);
    }
  });

  it("Worley F1 mirror is ~0 at its own feature points", () => {
    for (let cy = -3; cy <= 3; cy++) {
      for (let cx = -3; cx <= 3; cx++) {
        const [fx, fy] = featurePoint(cx, cy);
        expect(oceanFoamCells(fx, fy)).toBeLessThan(1e-6);
      }
    }
  });
});
