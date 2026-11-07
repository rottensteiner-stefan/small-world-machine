/**
 * WeatherHeightfieldCollider and the WeatherEmitter roof-cull integration: independent bilinear
 * oracle vs the bake, eps-driven cull decision, grid consistency, monotonicity, edge clamping,
 * constructor validation, preallocated bake reuse, and the emitter's hidden/impact semantics.
 *
 *   @invariant HEIGHTFIELD-ROOF-CULL: weather particles with y < y_roof(x,z) are culled; the
 *     independent roof-depth oracle stays consistent with the 256×256 bake (monotone, no
 *     precipitation below the roof).
 */
import { describe, expect, it } from "vitest";
import {
  WeatherEmitter,
  WeatherHeightfieldCollider,
  type WeatherRoofSource,
} from "../../../src/index.js";

/** Decodes particle `i`'s effective uniform scale from its instance matrix (rotation-robust:
 * the matrix columns are the rotated basis vectors; a zero-scale culled instance has length 0). */
function readScale(emitter: WeatherEmitter, i: number): number {
  const m = emitter.mesh.instanceMatrices;
  const o = i * 16;
  const l0 = Math.hypot(m[o + 0]!, m[o + 1]!, m[o + 2]!);
  const l1 = Math.hypot(m[o + 4]!, m[o + 5]!, m[o + 6]!);
  const l2 = Math.hypot(m[o + 8]!, m[o + 9]!, m[o + 10]!);
  return (l0 + l1 + l2) / 3;
}

/** Analytic, strictly increasing-in-X roof -- an independent height oracle for consistency checks. */
function risingRoof(x: number, z: number): number {
  return 10 + 0.5 * x + 0.25 * Math.sin(z * 0.13);
}

/** Flat roof at `height`. */
function flatRoof(height: number): WeatherRoofSource {
  return () => height;
}

/** Independent bilinear reimplementation of the grid (validates the class's oracle, does not
 * read its private state beyond the public `heights`/`origin`/`extent` surface). */
function independentBilinear(collider: WeatherHeightfieldCollider, wx: number, wz: number): number {
  const res = collider.resolution;
  const cell = collider.extent / res;
  const fx = Math.min(Math.max((wx - collider.originX) / cell - 0.5, 0), res - 2);
  const fz = Math.min(Math.max((wz - collider.originZ) / cell - 0.5, 0), res - 2);
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const tx = Math.min(fx - x0, 1);
  const tz = Math.min(fz - z0, 1);
  const h = collider.heights;
  const a = h[z0 * res + x0]!;
  const b = h[z0 * res + x0 + 1]!;
  const c = h[(z0 + 1) * res + x0]!;
  const d = h[(z0 + 1) * res + x0 + 1]!;
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

describe("WeatherHeightfieldCollider (HEIGHTFIELD-ROOF-CULL)", () => {
  it("bake stores an independent source; oracle is consistent with the 256x256 bake", () => {
    const collider = new WeatherHeightfieldCollider({ resolution: 256, cellSize: 0.5 });
    collider.bake(risingRoof, 0, 0);

    // Bake covers the full grid; each cell holds the source sampled at its center.
    expect(collider.resolution).toBe(256);
    expect(collider.heights.length).toBe(256 * 256);
    const cell = collider.heights;
    for (let row = 0; row < 256; row += 32) {
      for (let col = 0; col < 256; col += 32) {
        const wx = collider.originX + (col + 0.5) * 0.5;
        const wz = collider.originZ + (row + 0.5) * 0.5;
        expect(cell[row * 256 + col]).toBeCloseTo(risingRoof(wx, wz), 5);
      }
    }

    // The interpolation oracle is the bilinear filter over the grid: validate it against an
    // INDEPENDENT bilinear reimplementation (test-side, from the raw heights) at scattered
    // in-field points -- consistency of the oracle with the bake, up to f32 storage error.
    for (let row = 0; row < 256; row += 7) {
      for (let col = 0; col < 256; col += 7) {
        const wx = collider.originX + (col + 0.5) * 0.5;
        const wz = collider.originZ + (row + 0.5) * 0.5;
        expect(collider.roofY(wx, wz)).toBeCloseTo(independentBilinear(collider, wx, wz), 4);
      }
    }
  });

  it("roofY returns the exact baked value at cell centers and blends only across the cell edge", () => {
    // Roof only over x < 0: with 1 m cells the centers at x = -0.5 / +0.5 straddle the step.
    const collider = new WeatherHeightfieldCollider({ resolution: 64, cellSize: 1 });
    collider.bake((x) => (x < 0 ? 20 : 0), 0, 0);
    expect(collider.roofY(-0.5, 3.5)).toBeCloseTo(20, 5);
    expect(collider.roofY(0.5, 3.5)).toBeCloseTo(0, 5);
    expect(collider.roofY(-10.5, 3.5)).toBeCloseTo(20, 5);
    expect(collider.roofY(10.5, 3.5)).toBeCloseTo(0, 5);
    // The cell edge x = 0 lies halfway between the two centers.
    expect(collider.roofY(0, 3.5)).toBeCloseTo(10, 5);
    // Same along Z.
    collider.bake((_x, z) => (z < 0 ? 20 : 0), 0, 0);
    expect(collider.roofY(3.5, -0.5)).toBeCloseTo(20, 5);
    expect(collider.roofY(3.5, 0.5)).toBeCloseTo(0, 5);
    expect(collider.roofY(3.5, 0)).toBeCloseTo(10, 5);
  });

  it("culls y < y_roof(x,z) + eps and keeps y >= y_roof + eps alive", () => {
    const collider = new WeatherHeightfieldCollider({ cullEpsilon: 0.05 });
    collider.bake(flatRoof(10), 0, 0);

    const roof = collider.roofY(3, -7);
    expect(roof).toBeCloseTo(10, 5);
    // Strict, eps-driven boundary per @invariant HEIGHTFIELD-ROOF-CULL.
    expect(collider.isCulled(3, roof + 0.05, -7)).toBe(false); // == roof + eps: survives
    expect(collider.isCulled(3, roof + 0.049, -7)).toBe(true); // just below the margin
    expect(collider.isCulled(3, roof - 5, -7)).toBe(true); // deep under the roof
    expect(collider.isCulled(3, roof + 100, -7)).toBe(false); // far above
  });

  it("roofY stays monotone where the baked source is monotone", () => {
    const collider = new WeatherHeightfieldCollider({ resolution: 128, cellSize: 1 });
    collider.bake(risingRoof, 0, 0);
    let prev = -Infinity;
    for (let x = 0; x < 120; x += 1) {
      const v = collider.roofY(collider.originX + x, collider.originZ + 13.5);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("out-of-field queries clamp to the nearest edge cell (distinguishable on a stepped roof)", () => {
    // Four corners with distinct heights: x < 0 adds 20, z < 0 adds 100. A flat roof would pass
    // any clamp; here a wrong edge (or a wrapped/zeroed lookup) yields a different value.
    const collider = new WeatherHeightfieldCollider({ resolution: 64, cellSize: 1 });
    collider.bake((x, z) => (x < 0 ? 20 : 0) + (z < 0 ? 100 : 0), 0, 0);
    expect(collider.roofY(-1e9, -1e9)).toBeCloseTo(120, 4);
    expect(collider.roofY(1e9, -1e9)).toBeCloseTo(100, 4);
    expect(collider.roofY(-1e9, 1e9)).toBeCloseTo(20, 4);
    expect(collider.roofY(1e9, 1e9)).toBeCloseTo(0, 4);
    // One axis outside, one inside: only the outside axis is clamped.
    expect(collider.roofY(-1e9, 10.5)).toBeCloseTo(20, 4);
    expect(collider.roofY(10.5, -1e9)).toBeCloseTo(100, 4);
  });

  it("a NaN query never culls and does not throw", () => {
    const collider = new WeatherHeightfieldCollider({ resolution: 8, cellSize: 1 });
    collider.bake(flatRoof(10), 0, 0);
    expect(() => collider.roofY(NaN, 0)).not.toThrow();
    expect(collider.isCulled(NaN, 0, 0)).toBe(false);
    expect(collider.isCulled(0, NaN, 0)).toBe(false);
  });

  it.each([
    ["resolution below 2", { resolution: 1 }, /resolution/],
    ["non-integer resolution", { resolution: 4.5 }, /resolution/],
    ["NaN resolution", { resolution: NaN }, /resolution/],
    ["zero cellSize", { cellSize: 0 }, /cellSize/],
    ["negative cellSize", { cellSize: -1 }, /cellSize/],
    ["infinite cellSize", { cellSize: Infinity }, /cellSize/],
    ["negative cullEpsilon", { cullEpsilon: -0.01 }, /cullEpsilon/],
    ["NaN cullEpsilon", { cullEpsilon: NaN }, /cullEpsilon/],
  ])("constructor rejects %s", (_label, options, message) => {
    expect(() => new WeatherHeightfieldCollider(options)).toThrow(message);
  });

  it("constructor accepts the boundary values resolution 2 and cullEpsilon 0", () => {
    const collider = new WeatherHeightfieldCollider({ resolution: 2, cullEpsilon: 0 });
    collider.bake(flatRoof(4), 0, 0);
    expect(collider.isCulled(0, 4, 0)).toBe(false);
    expect(collider.isCulled(0, 3.999, 0)).toBe(true);
  });

  it("bake reuses the preallocated grid (cadence-governed, no reallocation)", () => {
    const collider = new WeatherHeightfieldCollider({ resolution: 256, cellSize: 1 });
    const first = collider.heights;
    collider.bake(flatRoof(1), 0, 0);
    collider.bake(flatRoof(2), 100, 100);
    collider.bake(flatRoof(3), -50, 40);
    // Same backing buffer across every bake + every query -- bake() never reallocates.
    expect(collider.heights).toBe(first);
    expect(collider.roofY(0, 0)).toBeCloseTo(3, 4);
  });
});

describe("WeatherEmitter roof-cull integration (HEIGHTFIELD-ROOF-CULL)", () => {
  it("roof-culled particles are hidden (zero-scale) and onRoofImpact fires on the transition edge", () => {
    const collider = new WeatherHeightfieldCollider({ cullEpsilon: 0.05 });
    collider.bake(flatRoof(10000), 0, 0); // roof above the entire spawn volume
    let impacts = 0;
    const emitter = new WeatherEmitter("Rain", {
      count: 16,
      spawnArea: { width: 100, depth: 100, height: 50 },
      roofCollider: collider,
      onRoofImpact: (): void => {
        impacts++;
      },
    });

    emitter.update(0.016);
    // Every particle spawned below the 10000-roof -> all hidden (zero scale). None ever fell onto
    // the roof, so none is an impact.
    for (let i = 0; i < emitter.mesh.instanceCount; i++) {
      expect(readScale(emitter, i)).toBeLessThan(1e-6);
    }
    expect(impacts).toBe(0);
    emitter.update(0.016);
    expect(impacts).toBe(0);
  });

  it("fires onRoofImpact once per real visible -> culled transition (mixed case)", () => {
    let roofHeight = -10000; // particle starts visible above the roof
    const source: WeatherRoofSource = () => roofHeight;
    const collider = new WeatherHeightfieldCollider({ cullEpsilon: 0.05 });
    collider.bake(source, 0, 0);
    let impacts = 0;
    const emitter = new WeatherEmitter("Rain", {
      count: 1,
      spawnArea: { width: 10, depth: 10, height: 50 },
      roofCollider: collider,
      onRoofImpact: (): void => {
        impacts++;
      },
    });

    emitter.update(0.001);
    expect(readScale(emitter, 0)).toBeGreaterThan(1e-4);
    expect(impacts).toBe(0);

    roofHeight = 10000; // the particle "falls onto" the roof
    collider.bake(source, 0, 0);
    emitter.update(0.001);
    expect(readScale(emitter, 0)).toBeLessThan(1e-6);
    expect(impacts).toBe(1);
    emitter.update(0.001); // still culled: no repeat
    expect(impacts).toBe(1);

    roofHeight = -10000; // visible again ...
    collider.bake(source, 0, 0);
    emitter.update(0.001);
    expect(readScale(emitter, 0)).toBeGreaterThan(1e-4);
    expect(impacts).toBe(1);

    roofHeight = 10000; // ... and culled again = second impact
    collider.bake(source, 0, 0);
    emitter.update(0.001);
    expect(impacts).toBe(2);
  });

  it("particles above the roof keep full scale and never fire the impact hook", () => {
    const collider = new WeatherHeightfieldCollider({ cullEpsilon: 0.05 });
    collider.bake(flatRoof(-10000), 0, 0); // roof deep below the spawn volume
    let impacts = 0;
    const emitter = new WeatherEmitter("Snow", {
      count: 16,
      spawnArea: { width: 100, depth: 100, height: 50 },
      roofCollider: collider,
      onRoofImpact: (): void => {
        impacts++;
      },
    });

    emitter.update(0.016);
    for (let i = 0; i < emitter.mesh.instanceCount; i++) {
      expect(readScale(emitter, i)).toBeGreaterThan(1e-4);
    }
    expect(impacts).toBe(0);
  });
});
