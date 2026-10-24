import { describe, expect, it } from "vitest";
import { Bone, Skeleton, SkinnedMesh } from "../../../src/core/animation/index.js";
import { Cube } from "../../../src/geometry/index.js";
import { BoundingBox } from "../../../src/physix/index.js";
import type { FrustumInterface } from "../../../src/interfaces/index.js";

/**
 * A frustum whose only discriminating plane requires x >= 50 to be inside. Every other
 * plane is placed far enough away that it never culls in the coordinate range this test
 * uses. Plane convention (BoundingBox.intersectsFrustum): a*x + b*y + c*z + d >= 0 inside.
 */
function makeXGe50Frustum(): FrustumInterface {
  const planes = new Float32Array(24);
  planes[0] = 1;
  planes[1] = 0;
  planes[2] = 0;
  planes[3] = -50; // x >= 50

  planes[4] = -1;
  planes[5] = 0;
  planes[6] = 0;
  planes[7] = 10000; // x <= 10000
  planes[8] = 0;
  planes[9] = 1;
  planes[10] = 0;
  planes[11] = 10000; // y >= -10000
  planes[12] = 0;
  planes[13] = -1;
  planes[14] = 0;
  planes[15] = 10000; // y <= 10000
  planes[16] = 0;
  planes[17] = 0;
  planes[18] = 1;
  planes[19] = 10000; // z >= -10000
  planes[20] = 0;
  planes[21] = 0;
  planes[22] = -1;
  planes[23] = 10000; // z <= 10000
  return { planes };
}

describe("SkinnedMesh conservative pose-aware culling (EP-2 / F2-A)", () => {
  it("grows the bounds with a bone pose so a posed character is not frustum-culled", () => {
    const mesh = new SkinnedMesh("Char");
    // Local AABB [-0.5, 0.5]^3.
    mesh.geometry = new Cube({ size: 1 }).getGeometryData();

    const root = new Bone("Root");
    const leg = new Bone("Leg");
    const skeleton = new Skeleton([root, leg]);
    mesh.bind(skeleton);

    // Neutral pose: the conservative union must be a superset of the bind box.
    mesh.computeBounds();
    const neutral = mesh.bounds as BoundingBox;
    expect(neutral.max.x).toBeGreaterThanOrEqual(0.5);
    expect(neutral.min.x).toBeLessThanOrEqual(-0.5);

    // Snapshot the bind-pose box: this is exactly what the inherited Object3D.computeBounds()
    // would keep forever (local geometry x identity world matrix), i.e. the old bug.
    const bindBox = new BoundingBox(neutral.min.clone(), neutral.max.clone());

    // The leg leaves the bind pose far to +X.
    leg.setPosition(100, 0, 0);
    leg.updateMatrixWorld(true);

    mesh.computeBounds();
    const posed = mesh.bounds as BoundingBox;
    // The posed extreme must actually be reached (old code left max.x = 0.5 -> culled).
    expect(posed.max.x).toBeGreaterThan(100.4);
    // The union also keeps the joint at the origin (conservative superset).
    expect(posed.min.x).toBeLessThanOrEqual(-0.5);

    const frustum = makeXGe50Frustum();
    // Bind-pose bounds (old behavior) sit entirely at x < 50 -> would be culled ...
    expect(bindBox.intersectsFrustum(frustum)).toBe(false);
    // ... while the pose-aware union reaches x > 50 and stays visible.
    expect((mesh.bounds as BoundingBox).intersectsFrustum(frustum)).toBe(true);
  });

  it("keeps non-collidable skinned meshes unbounded so they are never culled", () => {
    const mesh = new SkinnedMesh("Deco");
    mesh.geometry = new Cube({ size: 1 }).getGeometryData();
    mesh.isCollidable = false;
    mesh.bind(new Skeleton([new Bone("Root")]));

    mesh.computeBounds();
    expect(mesh.bounds).toBeUndefined();
  });

  it("falls back to the inherited bind-pose bounds when the mesh has no skeleton", () => {
    const mesh = new SkinnedMesh("NoRig");
    mesh.geometry = new Cube({ size: 1 }).getGeometryData();

    mesh.computeBounds();
    const bounds = mesh.bounds as BoundingBox;
    expect(bounds.max.x).toBeCloseTo(0.5, 6);
    expect(bounds.min.x).toBeCloseTo(-0.5, 6);
  });
});
