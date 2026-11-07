import { describe, it, expect } from "vitest";
import { poissonDiskSample } from "../src/PoissonDiskSample.js";

describe("poissonDiskSample", () => {
  it("never places two points closer than minDistance", () => {
    const points = poissonDiskSample({
      bounds: { min: { x: -2, y: -2, z: -2 }, max: { x: 2, y: 2, z: 2 } },
      minDistance: 0.5,
      seed: 7,
    });

    expect(points.length).toBeGreaterThan(10);

    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const dx = points[i]!.x - points[j]!.x;
        const dy = points[i]!.y - points[j]!.y;
        const dz = points[i]!.z - points[j]!.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        expect(dist).toBeGreaterThanOrEqual(0.5 - 0.0001);
      }
    }
  });

  it("keeps every point inside the requested bounds", () => {
    const bounds = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };
    const points = poissonDiskSample({ bounds, minDistance: 0.3, seed: 3 });
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(bounds.min.x);
      expect(p.x).toBeLessThanOrEqual(bounds.max.x);
      expect(p.y).toBeGreaterThanOrEqual(bounds.min.y);
      expect(p.y).toBeLessThanOrEqual(bounds.max.y);
      expect(p.z).toBeGreaterThanOrEqual(bounds.min.z);
      expect(p.z).toBeLessThanOrEqual(bounds.max.z);
    }
  });

  it("is deterministic for a fixed seed", () => {
    const a = poissonDiskSample({ seed: 11, minDistance: 0.4 });
    const b = poissonDiskSample({ seed: 11, minDistance: 0.4 });
    expect(a).toEqual(b);
  });

  it("always returns at least the initial sample, even for a huge minDistance", () => {
    const points = poissonDiskSample({ minDistance: 100, maxAttempts: 5 });
    expect(points.length).toBe(1);
    expect(Number.isNaN(points[0]!.x)).toBe(false);
  });
});
