import { describe, expect, it } from "vitest";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { FrustumCuller } from "../../src/core/culling/FrustumCuller.js";
import { Cube } from "../../src/geometry/index.js";
import { StandardMaterial } from "../../src/core/materials/index.js";
import { Matrix4, Vector3D } from "../../src/math/index.js";

function makeDrawable(name: string): Object3D {
  const obj = new Object3D(name);
  obj.geometry = new Cube({ size: 1 }).getGeometryData();
  obj.material = new StandardMaterial();
  return obj;
}

describe("Scene._collectVisible: Hierarchical-Z occlusion gate", () => {
  it("skips objects with occlusionCulled=true and counts them, independent of frustum state", () => {
    const scene = new Scene();
    const visible = makeDrawable("Visible");
    const occluded = makeDrawable("Occluded");
    occluded.occlusionCulled = true;
    scene.add(visible, occluded);

    const list = scene.getVisibleObjectsSorted(new Matrix4().data, new Vector3D());
    const names = list.opaqueBatches.flatMap((b) => b.objects.map((o) => o.name));

    expect(names).toContain("Visible");
    expect(names).not.toContain("Occluded");
    expect(scene.lastOcclusionCulledCount).toBe(1);
  });

  it("never lets occlusionCulled override -- frustum-culled objects are skipped before it's even checked", () => {
    const scene = new Scene();
    const frustumCulled = makeDrawable("FrustumCulled");
    frustumCulled.frustumCulled = true;
    frustumCulled.bounds = { getBroadRadius: () => 1 } as never; // presence is what matters here
    frustumCulled.inFrustum = false;
    frustumCulled.occlusionCulled = false;
    scene.add(frustumCulled);

    const list = scene.getVisibleObjectsSorted(new Matrix4().data, new Vector3D());
    expect(list.opaqueBatches.flatMap((b) => b.objects)).toHaveLength(0);
    // The frustum check returns first -- occlusion bookkeeping never runs for this object.
    expect(scene.lastOcclusionCulledCount).toBe(0);
  });

  it("resets lastOcclusionCulledCount on every call", () => {
    const scene = new Scene();
    const occluded = makeDrawable("Occluded");
    occluded.occlusionCulled = true;
    scene.add(occluded);

    scene.getVisibleObjectsSorted(new Matrix4().data, new Vector3D());
    expect(scene.lastOcclusionCulledCount).toBe(1);

    occluded.occlusionCulled = false;
    scene.getVisibleObjectsSorted(new Matrix4().data, new Vector3D());
    expect(scene.lastOcclusionCulledCount).toBe(0);
  });
});

describe("Scene.lastFrustumVisibleObjects", () => {
  it("includes an occlusionCulled object -- unlike the RenderList, which excludes it", () => {
    const scene = new Scene();
    const occluded = makeDrawable("Occluded");
    occluded.occlusionCulled = true;
    scene.add(occluded);

    scene.getVisibleObjectsSorted(new Matrix4().data, new Vector3D());

    expect(scene.lastFrustumVisibleObjects).toContain(occluded);
  });

  it("excludes an invisible object and a frustum-culled one", () => {
    // Note: `scene.root` itself is always walked (and, having no `bounds`, always passes the
    // frustum check trivially) so it's always present too -- this only asserts on the two
    // objects actually under test, not on the list's total length.
    const scene = new Scene();
    const invisible = makeDrawable("Invisible");
    invisible.isVisible = false;
    const frustumCulled = makeDrawable("FrustumCulled");
    frustumCulled.bounds = { getBroadRadius: () => 1 } as never;
    frustumCulled.inFrustum = false;
    scene.add(invisible, frustumCulled);

    scene.getVisibleObjectsSorted(new Matrix4().data, new Vector3D());

    expect(scene.lastFrustumVisibleObjects).not.toContain(invisible);
    expect(scene.lastFrustumVisibleObjects).not.toContain(frustumCulled);
  });

  it("is cleared and repopulated on every call", () => {
    const scene = new Scene();
    const a = makeDrawable("A");
    scene.add(a);
    scene.getVisibleObjectsSorted(new Matrix4().data, new Vector3D());
    expect(scene.lastFrustumVisibleObjects).toContain(a);

    const emptyScene = new Scene();
    emptyScene.getVisibleObjectsSorted(new Matrix4().data, new Vector3D());
    expect(emptyScene.lastFrustumVisibleObjects).not.toContain(a);
  });
});

describe("FrustumCuller.cull (fallback path, no octree)", () => {
  it("marks exactly the objects that end up visible+inFrustum", () => {
    const culler = new FrustumCuller();
    const scene = new Scene();
    const a = makeDrawable("A");
    const b = makeDrawable("B");
    b.isVisible = false;
    scene.add(a, b);

    const count = culler.cull(scene, new Matrix4());

    expect(count).toBe(1);
    expect(a.inFrustum).toBe(true);
  });

  it("resets lastVisibleCount to 0 for an empty scene", () => {
    const culler = new FrustumCuller();
    const scene = new Scene();
    const a = makeDrawable("A");
    scene.add(a);
    culler.cull(scene, new Matrix4());
    expect(culler.lastVisibleCount).toBeGreaterThan(0);

    const emptyScene = new Scene();
    culler.cull(emptyScene, new Matrix4());
    expect(culler.lastVisibleCount).toBe(0);
  });
});
