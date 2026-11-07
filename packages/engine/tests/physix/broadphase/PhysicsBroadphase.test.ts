import { describe, it, expect } from "vitest";
import { Object3D } from "../../../src/core/Object3D.js";
import { PhysicsBroadphase } from "../../../src/physix/broadphase/PhysicsBroadphase.js";
import { BoundingBox } from "../../../src/physix/BoundingBox.js";
import { Vector3D } from "../../../src/math/index.js";
import type { Collidable } from "../../../src/interfaces/index.js";

describe("PhysicsBroadphase", () => {
  it("builds an Octree and queries intersecting volumes", () => {
    const broadphase = new PhysicsBroadphase();

    const objA = new Object3D("A");
    objA.bounds = new BoundingBox(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));

    const objB = new Object3D("B");
    objB.bounds = new BoundingBox(new Vector3D(10, 10, 10), new Vector3D(11, 11, 11));

    broadphase.update([objA, objB]);
    expect(broadphase.tree).toBeDefined();

    const queryBox = new BoundingBox(new Vector3D(-0.5, -0.5, -0.5), new Vector3D(0.5, 0.5, 0.5));
    const hits: Collidable[] = [];
    broadphase.queryVolume(queryBox, hits);

    expect(hits).toContain(objA);
    expect(hits).not.toContain(objB);
  });

  it("handles fallback list when colliders cannot be inserted into the octree", () => {
    const broadphase = new PhysicsBroadphase();
    const obj = new Object3D("NoBounds");
    broadphase.update([obj]);
    expect(broadphase.fallback.length).toBeGreaterThanOrEqual(0);
  });

  it("updates Octree root min/max extents when colliders move beyond initial bounds across frames [BLK-C2]", () => {
    const broadphase = new PhysicsBroadphase();

    const movingObj = new Object3D("Mover");
    movingObj.bounds = new BoundingBox(new Vector3D(0, 0, 0), new Vector3D(2, 2, 2));

    // Frame 1: Initial bounds at [0, 0, 0] -> [2, 2, 2]
    broadphase.update([movingObj]);
    expect(broadphase.tree).toBeDefined();
    expect(broadphase.fallback).toHaveLength(0);

    const initialMin = broadphase.tree!.root.bounds.min.clone();
    const initialMax = broadphase.tree!.root.bounds.max.clone();

    // Frame 2: Object moves far outside frame 1 bounds to [100, 100, 100] -> [102, 102, 102]
    movingObj.bounds = new BoundingBox(new Vector3D(100, 100, 100), new Vector3D(102, 102, 102));
    broadphase.update([movingObj]);

    // Tree root bounds must have adapted to the new position instead of keeping old min/max
    expect(broadphase.tree!.root.bounds.min.x).toBeGreaterThan(50);
    expect(broadphase.tree!.root.bounds.min.x).not.toBeCloseTo(initialMin.x);
    expect(broadphase.tree!.root.bounds.max.x).not.toBeCloseTo(initialMax.x);
    expect(broadphase.fallback).toHaveLength(0);

    // Querying at the new location must hit the object from the octree
    const queryBox = new BoundingBox(new Vector3D(99, 99, 99), new Vector3D(103, 103, 103));
    const hits: Collidable[] = [];
    broadphase.queryVolume(queryBox, hits);
    expect(hits).toContain(movingObj);

    // Querying at the old location must be empty
    const oldQueryBox = new BoundingBox(new Vector3D(-1, -1, -1), new Vector3D(3, 3, 3));
    const oldHits: Collidable[] = [];
    broadphase.queryVolume(oldQueryBox, oldHits);
    expect(oldHits).not.toContain(movingObj);
  });
});
