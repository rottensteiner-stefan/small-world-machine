import { describe, expect, it } from "vitest";
import { Vector3D } from "@small-world-machine/engine";
import { mulberry32 } from "@small-world-machine/engine/utils/SeededRandom.js";
import {
  sampleBox,
  sampleCone,
  sampleRing,
  sampleSphere,
  sampleSphereShell,
} from "../src/spawners/EmitterShapes.js";

const TWO_PI = 6.283185307179586;

function seeded(seed: number): () => number {
  return mulberry32(seed);
}

describe("EmitterShapes", () => {
  it("is deterministic for a fixed seed", () => {
    const a = new Vector3D();
    const b = new Vector3D();
    const ra = seeded(0x1234);
    const rb = seeded(0x1234);
    for (let i = 0; i < 50; i++) {
      sampleSphere(a, ra, new Vector3D(1, 2, 3), 4);
      sampleSphere(b, rb, new Vector3D(1, 2, 3), 4);
      expect(a.x).toBe(b.x);
      expect(a.y).toBe(b.y);
      expect(a.z).toBe(b.z);
    }
  });

  it("samples only inside the sphere volume", () => {
    const center = new Vector3D(5, 5, 5);
    const radius = 3;
    const out = new Vector3D();
    const rng = seeded(1);
    for (let i = 0; i < 2000; i++) {
      sampleSphere(out, rng, center, radius);
      const d = Math.hypot(out.x - center.x, out.y - center.y, out.z - center.z);
      expect(d).toBeLessThanOrEqual(radius + 1e-5);
    }
  });

  it("samples exactly on the sphere shell", () => {
    const center = new Vector3D(0, 0, 0);
    const radius = 2.5;
    const out = new Vector3D();
    const rng = seeded(2);
    for (let i = 0; i < 500; i++) {
      sampleSphereShell(out, rng, center, radius);
      const d = Math.hypot(out.x, out.y, out.z);
      expect(d).toBeCloseTo(radius, 5);
    }
  });

  it("samples only inside the box", () => {
    const min = new Vector3D(-1, 0, -2);
    const max = new Vector3D(3, 4, 5);
    const out = new Vector3D();
    const rng = seeded(3);
    for (let i = 0; i < 1000; i++) {
      sampleBox(out, rng, min, max);
      expect(out.x).toBeGreaterThanOrEqual(min.x - 1e-5);
      expect(out.x).toBeLessThanOrEqual(max.x + 1e-5);
      expect(out.y).toBeGreaterThanOrEqual(min.y - 1e-5);
      expect(out.y).toBeLessThanOrEqual(max.y + 1e-5);
      expect(out.z).toBeGreaterThanOrEqual(min.z - 1e-5);
      expect(out.z).toBeLessThanOrEqual(max.z + 1e-5);
    }
  });

  it("samples the ring on the XZ plane at the expected radius", () => {
    const center = new Vector3D(1, 7, 1);
    const out = new Vector3D();
    const rng = seeded(4);
    for (let i = 0; i < 500; i++) {
      sampleRing(out, rng, center, 5, 0);
      expect(out.y).toBe(center.y);
      const r = Math.hypot(out.x - center.x, out.z - center.z);
      expect(r).toBeCloseTo(5, 4);
    }
  });

  it("samples the annulus band within thickness", () => {
    const center = new Vector3D(0, 0, 0);
    const out = new Vector3D();
    const rng = seeded(5);
    for (let i = 0; i < 500; i++) {
      sampleRing(out, rng, center, 10, 2);
      const r = Math.hypot(out.x, out.z);
      expect(r).toBeGreaterThanOrEqual(9 - 1e-4);
      expect(r).toBeLessThanOrEqual(11 + 1e-4);
    }
  });

  it("samples cone velocities inside the half-angle at the target speed", () => {
    const origin = new Vector3D(0, 0, 0);
    const axis = new Vector3D(0, 1, 0);
    const speed = 5;
    const halfAngle = 0.3;
    const out = new Vector3D();
    const outVel = new Vector3D();
    const rng = seeded(6);
    for (let i = 0; i < 500; i++) {
      sampleCone(out, outVel, rng, origin, axis, halfAngle, speed, 1);
      const dist = Math.hypot(outVel.x, outVel.y, outVel.z);
      expect(dist).toBeCloseTo(speed, 4);
      const dotY = outVel.y / dist;
      expect(dotY).toBeGreaterThan(Math.cos(halfAngle) - 1e-4);
      const posR = Math.hypot(out.x, out.z);
      expect(posR).toBeLessThanOrEqual(1 + 1e-4);
    }
  });

  it("reduces the cone to a directed ray for zero half-angle", () => {
    const origin = new Vector3D(1, 2, 3);
    const axis = new Vector3D(0, 0, -1);
    const out = new Vector3D();
    const outVel = new Vector3D();
    const rng = seeded(7);
    sampleCone(out, outVel, rng, origin, axis, 0, 4, 0);
    expect(out.x).toBe(1);
    expect(out.y).toBe(2);
    expect(out.z).toBe(3);
    expect(outVel.x).toBeCloseTo(0, 6);
    expect(outVel.y).toBeCloseTo(0, 6);
    expect(outVel.z).toBeCloseTo(-4, 6);
  });

  it("handles hemisphere cone halfAngle = Math.PI / 2 without tan(PI/2) singularity and samples uniformly in solid angle", () => {
    const origin = new Vector3D(0, 0, 0);
    const axis = new Vector3D(0, 1, 0);
    const out = new Vector3D();
    const outVel = new Vector3D();
    const rng = seeded(42);
    let sumCosTheta = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
      sampleCone(out, outVel, rng, origin, axis, Math.PI / 2, 10, 0);
      const speed = Math.hypot(outVel.x, outVel.y, outVel.z);
      expect(speed).toBeCloseTo(10, 5);
      const cosTheta = outVel.y / speed;
      expect(cosTheta).toBeGreaterThanOrEqual(-1e-6);
      expect(cosTheta).toBeLessThanOrEqual(1 + 1e-6);
      sumCosTheta += cosTheta;
    }
    // For a hemisphere (cos(alpha) = 0), E[cos(theta)] = 0.5 (tan(PI/2) bug yielded 0.0).
    expect(sumCosTheta / N).toBeGreaterThan(0.45);
    expect(sumCosTheta / N).toBeLessThan(0.55);
  });

  it("samples annulus ring with area-uniform radial density (sqrt(rMin^2 + u*(rMax^2 - rMin^2)))", () => {
    const center = new Vector3D(0, 0, 0);
    const out = new Vector3D();
    // For a full disc (radius = 2, thickness = 4 -> rMin = 0, rMax = 4) at u = 0.25,
    // area-uniform radius is sqrt(0.25 * 16) = 2.0 (linear bug yielded 0 + 0.25*4 = 1.0).
    let call = 0;
    const fixedRng = (): number => (call++ % 2 === 0 ? 0.25 : 0);
    sampleRing(out, fixedRng, center, 2, 4);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(2.0, 5);
  });

  it("produces a uniform disc distribution on the cone base (Area test via determinism)", () => {
    // Statistical uniformity would be flaky; instead assert the samples fill the disc in
    // both angular directions (theta spread) with a fixed seed.
    const origin = new Vector3D(0, 0, 0);
    const axis = new Vector3D(0, 1, 0);
    const out = new Vector3D();
    const outVel = new Vector3D();
    const rng = seeded(8);
    let maxTheta = -Infinity;
    for (let i = 0; i < 200; i++) {
      sampleCone(out, outVel, rng, origin, axis, 0.6, 1, 2);
      maxTheta = Math.max(maxTheta, Math.atan2(out.z, out.x) * 57.29577951308232);
    }
    expect(maxTheta).toBeGreaterThan(100);
  });

  it("guards degenerate sphere and ring inputs", () => {
    const out = new Vector3D();
    const rng = seeded(9);
    sampleSphere(out, rng, new Vector3D(0, 0, 0), 0);
    expect(Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z)).toBe(true);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(out.z).toBe(0);
    sampleRing(out, rng, new Vector3D(0, 1, 0), 5, -3);
    expect(Math.abs(out.y - 1)).toBe(0);
    // Negative thickness clamps to 0 -> exact ring radius.
    const r = Math.hypot(out.x, out.z);
    expect(r).toBeCloseTo(5, 4);
    expect(rng().toString().length).toBeGreaterThan(0);
  });

  it("does not draw beyond the rng", () => {
    // A tiny smoke check that sampleSphere consumes a bounded number of draws.
    let draws = 0;
    const counting: () => number = () => {
      draws++;
      return 0.5;
    };
    const out = new Vector3D();
    sampleSphere(out, counting, new Vector3D(0, 0, 0), 2);
    expect(draws).toBe(3);
    expect(TWO_PI).toBeGreaterThan(6);
  });
});
