import { describe, it, expect } from "vitest";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { BoundingBox, BoundingSphere, StaticCollider } from "../../src/physix/index.js";
import { Vector3D } from "../../src/math/index.js";
import { resolveSphereCollisions } from "../../src/core/behaviors/CollisionResolution.js";
import type { Collidable } from "../../src/interfaces/index.js";

/**
 * R5 / D6 (Whack-a-Mole) static-collider contract:
 *
 * `Scene.staticColliders` is the single registration channel for non-Object3D static
 * collision geometry. `Scene.updateStaticOctree()` auto-enters them into `staticOctree`, so the
 * player/camera resolution path (`CollisionResolution.resolveSphereCollisions`), EnemyBehavior,
 * picking and rigid-body physics all resolve against the SAME spatial structure. Without that
 * auto-entry, an obstacle registered via `staticColliders` blocks physics (PhysicsSystem drains
 * the array) but not the player walk/controller — the "ghost wall" defect.
 */
describe("StaticCollider octree contract (R5)", () => {
  function makeWallScene(): { scene: Scene; wall: StaticCollider; target: Object3D } {
    const scene = new Scene();
    scene.initOctrees(new BoundingBox(new Vector3D(-50, -50, -50), new Vector3D(50, 50, 50)));

    // Non-Object3D obstacle registered through the single documented channel.
    const wall = new StaticCollider(
      new BoundingBox(new Vector3D(-1, -0.5, -1), new Vector3D(1, 2, 1)),
    );
    scene.staticColliders.push(wall);
    scene.updateStaticOctree();

    const target = new Object3D("player");
    target.position.set(0.75, 1.0, 0);
    target.updateMatrixWorld();
    return { scene, wall, target };
  }

  it("lets the player resolution path collide with scene.staticColliders (no ghost walls)", () => {
    const { scene, wall, target } = makeWallScene();

    // The player collider overlaps the wall's x-extent (sphere x range 0.25..1.25 vs wall 1..).
    const sphere = new BoundingSphere(new Vector3D(0, 0, 0), 0.5);
    resolveSphereCollisions(sphere, target, scene);

    // Reconstruct the solver's sphere (center.y = position.y - eyeHeight + radius). Blocking is
    // resolved to the wall face: at most tangent contact (penetration <= 0), never a residual
    // overlap. On the ghost-wall state (HEAD) no octree/SpatialHash contains the wall, so the
    // sphere stays fully overlapping (penetration 0.5) and this fails.
    const resolved = new BoundingSphere(
      new Vector3D(target.position.x, target.position.y - 0.2 + 0.5, target.position.z),
      0.5,
    );
    const bb = wall.bounds as BoundingBox;
    const closest = new Vector3D(
      Math.max(bb.min.x, Math.min(resolved.center.x, bb.max.x)),
      Math.max(bb.min.y, Math.min(resolved.center.y, bb.max.y)),
      Math.max(bb.min.z, Math.min(resolved.center.z, bb.max.z)),
    );
    expect(resolved.radius - closest.distanceTo(resolved.center)).toBeLessThanOrEqual(1e-5);
    // The player was actually displaced (not merely never overlapping).
    expect(target.position.x).not.toBeCloseTo(0.75, 5);
  });

  it("makes staticColliders reachable exactly once through the static octree", () => {
    const { scene, wall } = makeWallScene();

    const hits: Collidable[] = [];
    scene.staticOctree!.queryVolume(new BoundingSphere(new Vector3D(0, 1, 0), 10), hits);
    // Some objects may exist (none here), but the wall itself participates at most once because
    // it is registered through exactly one channel (staticColliders -> staticOctree).
    expect(hits.filter((h) => h === wall)).toHaveLength(1);
  });

  it("does not accumulate a double correction across repeated resolution steps", () => {
    const { scene, target } = makeWallScene();

    const sphere = new BoundingSphere(new Vector3D(0, 0, 0), 0.5);
    resolveSphereCollisions(sphere, target, scene);
    const x1 = target.position.x;
    expect(x1).not.toBeCloseTo(0.75, 5);

    // A fully-resolved resting state must be stable: a second evaluation finds no further
    // overlap. A double-registered collider (octree + another channel) would push again here.
    resolveSphereCollisions(sphere, target, scene);
    expect(target.position.x).toBeCloseTo(x1, 5);
  });
});
