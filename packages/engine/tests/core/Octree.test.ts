import { describe, it, expect } from "vitest";
import { Octree } from "../../src/core/culling/Octree.js";
import { Object3D } from "../../src/core/Object3D.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { Vector3D } from "../../src/math/Vector3D.js";
import { Cube } from "../../src/geometry/Cube.js";
import { Decal } from "../../src/core/objects/Decal.js";
import { DecalMaterial } from "../../src/core/materials/index.js";
import { Sprite } from "../../src/core/sprites/Sprite.js";

describe("Octree", () => {
  it("should return true when inserting an object within bounds", () => {
    const octree = new Octree(
      new BoundingBox(new Vector3D(-10, -10, -10), new Vector3D(10, 10, 10)),
    );
    const obj = new Object3D("TestObj");
    obj.geometry = new Cube({ size: 1 }).getGeometryData();
    obj.position.set(0, 0, 0);
    obj.updateMatrixWorld();
    obj.computeBounds();

    const result = octree.insert(obj);
    expect(result).toBe(true);
  });

  it("should return true when inserting a Sprite within bounds", () => {
    const octree = new Octree(
      new BoundingBox(new Vector3D(-200, -50, -200), new Vector3D(200, 100, 200)),
    );
    const sprite = new Sprite();
    sprite.position.set(-14, 1.5, -5);
    sprite.updateMatrixWorld();
    sprite.computeBounds();

    const result = octree.insert(sprite);
    expect(result).toBe(true);
  });

  it("should grow the root bounds and succeed when inserting an object outside the initial bounds", () => {
    const octree = new Octree(
      new BoundingBox(new Vector3D(-10, -10, -10), new Vector3D(10, 10, 10)),
    );
    const obj = new Object3D("TestObj");
    obj.geometry = new Cube({ size: 1 }).getGeometryData();
    obj.position.set(20, 20, 20);
    obj.updateMatrixWorld();
    obj.computeBounds();

    // A dynamically spawned/teleported object outside the octree's fixed extent must still be
    // inserted -- otherwise it is never returned by query() and FrustumCuller leaves it
    // permanently culled. The root bounds grow to accommodate it instead of rejecting it.
    const result = octree.insert(obj);
    expect(result).toBe(true);
    expect(octree.root.bounds.containsVolume(obj.bounds!)).toBe(true);
  });

  it("should return false when inserting an object without bounds", () => {
    const octree = new Octree(
      new BoundingBox(new Vector3D(-10, -10, -10), new Vector3D(10, 10, 10)),
    );
    const obj = new Object3D("TestObj");
    // No geometry = no bounds

    const result = octree.insert(obj);
    expect(result).toBe(false);
  });

  it("removes inserted objects and dynamically collapses subdivisions", () => {
    const octree = new Octree(
      new BoundingBox(new Vector3D(-10, -10, -10), new Vector3D(10, 10, 10)),
      { maxObjects: 2, maxDepth: 2 },
    );

    const objects: Object3D[] = [];
    for (let i = 0; i < 5; i++) {
      const obj = new Object3D(`Obj_${i}`);
      obj.geometry = new Cube({ size: 0.5 }).getGeometryData();
      obj.position.set(i - 2, 0, 0);
      obj.updateMatrixWorld();
      obj.computeBounds();
      octree.insert(obj);
      objects.push(obj);
    }

    // Node must have subdivided
    expect(octree.root.children.length).toBe(8);

    // Remove 4 objects
    for (let i = 0; i < 4; i++) {
      const removed = octree.remove(objects[i]!);
      expect(removed).toBe(true);
    }

    // After removing enough objects, child nodes collapse back to parent
    expect(octree.root.children.length).toBe(0);
    expect(octree.root.objects).toContain(objects[4]);

    // Removing non-existent object returns false
    const nonExistent = new Object3D("Ghost");
    expect(octree.remove(nonExistent)).toBe(false);
  });

  it("queryVolume skips decals, whose OBB bounds exist only for culling", () => {
    const octree = new Octree(
      new BoundingBox(new Vector3D(-10, -10, -10), new Vector3D(10, 10, 10)),
    );
    const solid = new Object3D("solid");
    solid.geometry = new Cube({ size: 1 }).getGeometryData();
    solid.updateMatrixWorld();
    solid.computeBounds();
    const decal = new Decal(new DecalMaterial());
    decal.updateMatrixWorld();
    decal.computeBounds();
    expect(decal.bounds).toBeDefined();
    expect(octree.insert(solid)).toBe(true);
    expect(octree.insert(decal)).toBe(true);

    const hits: Object3D[] = [];
    octree.queryVolume(solid.bounds!, hits);
    expect(hits).toContain(solid);
    expect(hits).not.toContain(decal);
    // Frustum culling still sees the decal.
    expect(octree.root.objects.concat(octree.root.children.flatMap((c) => c.objects))).toContain(
      decal,
    );
  });
});
