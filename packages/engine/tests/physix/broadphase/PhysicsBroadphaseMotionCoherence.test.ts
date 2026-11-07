import { describe, it, expect } from "vitest";
import { Object3D } from "../../../src/core/Object3D.js";
import { PhysicsBroadphase } from "../../../src/physix/broadphase/PhysicsBroadphase.js";
import { BoundingBox } from "../../../src/physix/BoundingBox.js";
import { Vector3D } from "../../../src/math/index.js";
import type { Collidable } from "../../../src/interfaces/index.js";

describe("PhysicsBroadphase Motion Coherence & Fat AABB Caching", () => {
  it("skips spatial re-sorting for stationary objects across frames", () => {
    const broadphase = new PhysicsBroadphase({ fatMargin: 0.2 });

    const objA = new Object3D("StationaryA");
    objA.bounds = new BoundingBox(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));

    const objB = new Object3D("StationaryB");
    objB.bounds = new BoundingBox(new Vector3D(5, 0, 0), new Vector3D(6, 1, 1));

    const objC = new Object3D("StationaryC");
    objC.bounds = new BoundingBox(new Vector3D(10, 0, 0), new Vector3D(11, 1, 1));

    const colliders = [objA, objB, objC];

    // Frame 1: Initial insertion (all 3 must be inserted)
    broadphase.update(colliders);
    expect(broadphase.movedCount).toBe(3);
    expect(broadphase.skippedCount).toBe(0);

    // Frame 2: No objects moved -> all 3 should skip re-sorting completely!
    broadphase.update(colliders);
    expect(broadphase.movedCount).toBe(0);
    expect(broadphase.skippedCount).toBe(3);

    // Frame 3: Micro-movement within fatMargin (0.2)
    // Moving objA by 0.05 stays inside fatMargin
    objA.bounds = new BoundingBox(new Vector3D(0.05, 0, 0), new Vector3D(1.05, 1, 1));
    broadphase.update(colliders);
    expect(broadphase.movedCount).toBe(0);
    expect(broadphase.skippedCount).toBe(3);

    // Verify spatial queries still work seamlessly with cached proxies
    const hits: Collidable[] = [];
    broadphase.queryVolume(
      new BoundingBox(new Vector3D(-0.5, -0.5, -0.5), new Vector3D(1.5, 1.5, 1.5)),
      hits,
    );
    expect(hits).toContain(objA);
    expect(hits).not.toContain(objB);
    expect(hits).not.toContain(objC);
  });

  it("selectively re-sorts only the objects that moved outside their fat AABB", () => {
    const broadphase = new PhysicsBroadphase({ fatMargin: 0.1 });

    const stationary = new Object3D("Stationary");
    stationary.bounds = new BoundingBox(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));

    const mover = new Object3D("Mover");
    mover.bounds = new BoundingBox(new Vector3D(10, 0, 0), new Vector3D(11, 1, 1));

    const colliders = [stationary, mover];

    // Frame 1: Initial build
    broadphase.update(colliders);
    expect(broadphase.movedCount).toBe(2);

    // Frame 2: Only 'mover' moves far away (exceeding fatMargin of 0.1)
    mover.bounds = new BoundingBox(new Vector3D(15, 0, 0), new Vector3D(16, 1, 1));
    broadphase.update(colliders);

    // stationary was skipped, mover was re-inserted
    expect(broadphase.skippedCount).toBe(1);
    expect(broadphase.movedCount).toBe(1);

    // Query old location of mover
    const oldHits: Collidable[] = [];
    broadphase.queryVolume(
      new BoundingBox(new Vector3D(9.5, -0.5, -0.5), new Vector3D(11.5, 1.5, 1.5)),
      oldHits,
    );
    expect(oldHits).not.toContain(mover);

    // Query new location of mover
    const newHits: Collidable[] = [];
    broadphase.queryVolume(
      new BoundingBox(new Vector3D(14.5, -0.5, -0.5), new Vector3D(16.5, 1.5, 1.5)),
      newHits,
    );
    expect(newHits).toContain(mover);
  });

  it("removes destroyed objects from internal proxy map and octree", () => {
    const broadphase = new PhysicsBroadphase();

    const objA = new Object3D("A");
    objA.bounds = new BoundingBox(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));

    const objB = new Object3D("B");
    objB.bounds = new BoundingBox(new Vector3D(2, 0, 0), new Vector3D(3, 1, 1));

    // Frame 1: Both in scene
    broadphase.update([objA, objB]);
    expect(broadphase.proxies.size).toBe(2);

    // Frame 2: objB is removed from scene
    broadphase.update([objA]);
    expect(broadphase.proxies.size).toBe(1);
    expect(broadphase.proxies.has(objB)).toBe(false);

    // Querying around objB position returns nothing
    const hits: Collidable[] = [];
    broadphase.queryVolume(
      new BoundingBox(new Vector3D(1.5, -0.5, -0.5), new Vector3D(3.5, 1.5, 1.5)),
      hits,
    );
    expect(hits).not.toContain(objB);
  });
});
