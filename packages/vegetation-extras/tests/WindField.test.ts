import { describe, expect, it } from "vitest";
import { WindField, type WindLean } from "../src/wind/WindField.js";

const lean = (): WindLean => ({ x: 0, z: 0 });

describe("WindField uniforms", () => {
  it("packs the SwmWind block with derived reciprocals", () => {
    const wind = new WindField({ gustLength: 50, crossStretch: 2, calm: 0.5, boundaryHeight: 8 });
    const u = wind.uniforms;
    expect(u).toHaveLength(WindField.UNIFORM_FLOATS);
    expect(u[0]).toBe(1);
    expect(u[1]).toBe(0);
    expect(u[6]).toBeCloseTo(1 / 50, 7);
    expect(u[7]).toBeCloseTo(1 / 100, 7);
    expect(u[10]).toBeCloseTo(1 / 8, 7);
    expect(u[13]).toBeCloseTo(2, 6);
  });

  it("normalizes the direction and ignores a zero vector", () => {
    const wind = new WindField({ directionX: 3, directionZ: 4 });
    expect(wind.directionX).toBeCloseTo(0.6, 10);
    expect(wind.directionZ).toBeCloseTo(0.8, 10);
    wind.setDirection(0, 0);
    expect(wind.directionX).toBeCloseTo(0.6, 10);
  });

  it("clamps calm so the gust remap never divides by zero", () => {
    const wind = new WindField({ calm: 1 });
    expect(Number.isFinite(wind.uniforms[13])).toBe(true);
  });
});

describe("WindField gusts", () => {
  it("travel downwind at the configured speed", () => {
    const wind = new WindField({ speed: 5, directionX: 1, directionZ: 0 });
    const before = [0, 7, 19, 33].map((x) => wind.gust(x, 4));
    wind.update(2);
    const after = [0, 7, 19, 33].map((x) => wind.gust(x + 10, 4));
    after.forEach((value, i) => expect(value).toBeCloseTo(before[i]!, 3));
  });

  it("wrap the scroll seamlessly (noise is periodic along the wind)", () => {
    const wind = new WindField({ gustLength: 30 });
    const span = WindField.PERIOD * 30;
    for (const x of [1.5, 12, 77]) {
      expect(wind.gust(x + span, 9)).toBeCloseTo(wind.gust(x, 9), 3);
    }
    wind.update((WindField.PERIOD * 30) / wind.speed + 0.25);
    expect(wind.scroll).toBeGreaterThanOrEqual(0);
    expect(wind.scroll).toBeLessThan(WindField.PERIOD);
  });

  it("leave calm areas and full gusts across a field", () => {
    const wind = new WindField();
    let calm = 0;
    let strong = 0;
    const samples = 4000;
    for (let i = 0; i < samples; i++) {
      const g = wind.gust((i % 80) * 3.1, Math.floor(i / 80) * 4.3);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      if (g === 0) calm++;
      if (g > 0.6) strong++;
    }
    expect(calm / samples).toBeGreaterThan(0.05);
    expect(calm / samples).toBeLessThan(0.7);
    expect(strong).toBeGreaterThan(0);
  });
});

describe("WindField lean", () => {
  it("does not move neighbouring plants in unison", () => {
    const wind = new WindField({ strength: 0, gustStrength: 0, flutterStrength: 0.1 });
    const a = wind.sampleLean(10, 10, 0.5, 0, lean());
    const b = wind.sampleLean(10.4, 10.2, 0.5, 0, lean());
    expect(Math.abs(a.x - b.x) + Math.abs(a.z - b.z)).toBeGreaterThan(1e-3);
  });

  it("is weaker near the ground and vanishes under full shelter", () => {
    const wind = new WindField({ flutterStrength: 0, groundFactor: 0.5, boundaryHeight: 10 });
    const grass = wind.sampleLean(5, 5, 0.4, 0, lean());
    const tree = wind.sampleLean(5, 5, 15, 0, lean());
    expect(Math.hypot(grass.x, grass.z)).toBeLessThan(Math.hypot(tree.x, tree.z));
    const sheltered = wind.sampleLean(5, 5, 15, 1, lean());
    expect(Math.hypot(sheltered.x, sheltered.z)).toBe(0);
  });

  it("leans downwind and respects maxLean", () => {
    const wind = new WindField({ directionX: 0, directionZ: -1, strength: 3, maxLean: 0.5 });
    const out = wind.sampleLean(2, 3, 20, 0, lean());
    expect(out.z).toBeLessThan(0);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(0.5, 5);
  });

  it("writes into the caller's out object", () => {
    const wind = new WindField();
    const out = lean();
    expect(wind.sampleLean(1, 2, 1, 0, out)).toBe(out);
  });
});
