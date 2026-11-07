import { describe, it, expect } from "vitest";
import { Object3D, Cube, ConvexHull, StandardMaterial } from "@small-world-machine/engine";
import { fractureObject } from "../src/VoronoiFracture.js";

function makeTarget(): Object3D {
  const target = new Object3D("Vase");
  target.geometry = new Cube({ size: 2 }).getGeometryData();
  target.material = new StandardMaterial();
  return target;
}

describe("fractureObject", () => {
  it("produces multiple ConvexHull-bounded, RigidBody-carrying shards", () => {
    const target = makeTarget();
    const shards = fractureObject(target, { pointCount: 8, seed: 1 });

    expect(shards.length).toBeGreaterThan(1);
    for (const shard of shards) {
      expect(shard.geometry).toBeDefined();
      expect(shard.bounds instanceof ConvexHull).toBe(true);
      expect(shard.rigidBody).toBeDefined();
      expect(shard.rigidBody!.mass).toBeGreaterThan(0);

      const data = shard.geometry!;
      expect(data.vertices.length).toBeGreaterThan(0);
      for (let i = 0; i < data.vertices.length; i++) {
        expect(Number.isNaN(data.vertices[i])).toBe(false);
      }
      expect(Number.isNaN(shard.position.x)).toBe(false);
    }
  });

  it("conserves total mass across all shards", () => {
    const target = makeTarget();
    const shards = fractureObject(target, { pointCount: 10, seed: 2, totalMass: 5 });

    const sum = shards.reduce((acc, s) => acc + s.rigidBody!.mass, 0);
    expect(sum).toBeCloseTo(5, 5);
  });

  it("is deterministic for a fixed seed", () => {
    const a = fractureObject(makeTarget(), { pointCount: 8, seed: 42 });
    const b = fractureObject(makeTarget(), { pointCount: 8, seed: 42 });

    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.position.x).toBeCloseTo(b[i]!.position.x, 5);
      expect(a[i]!.position.y).toBeCloseTo(b[i]!.position.y, 5);
      expect(a[i]!.position.z).toBeCloseTo(b[i]!.position.z, 5);
    }
  });

  it("re-parents shards in place of the original object when it has a parent", () => {
    const parent = new Object3D("Scene");
    const target = makeTarget();
    parent.add(target);

    const shards = fractureObject(target, { pointCount: 6, seed: 3 });

    expect(parent.children.includes(target)).toBe(false);
    for (const shard of shards) {
      expect(parent.children.includes(shard)).toBe(true);
    }
  });

  it("leaves an unparented target's shards for the caller to add themselves", () => {
    const target = makeTarget();
    const shards = fractureObject(target, { pointCount: 6, seed: 4 });
    for (const shard of shards) {
      expect(shard.parent).toBeUndefined();
    }
  });

  it("gives shards an outward initial velocity from an impact point", () => {
    const target = makeTarget();
    const shards = fractureObject(target, {
      pointCount: 8,
      seed: 5,
      impactPoint: { x: -5, y: 0, z: 0 },
      explosionStrength: 3,
    });

    for (const shard of shards) {
      // Every shard's centroid is at x >= -1 (the cube's own local extent), and the
      // impact point sits far to the left, so every shard should be pushed towards +X.
      expect(shard.rigidBody!.velocity.length()).toBeCloseTo(3, 5);
      expect(shard.rigidBody!.velocity.x).toBeGreaterThan(0);
    }
  });

  it("leaves shard velocity at zero without an impact point", () => {
    const target = makeTarget();
    const shards = fractureObject(target, { pointCount: 6, seed: 6 });
    for (const shard of shards) {
      expect(shard.rigidBody!.velocity.length()).toBe(0);
    }
  });
});
