import { describe, expect, it } from "vitest";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { Cube } from "../../src/geometry/index.js";
import { StandardMaterial } from "../../src/core/materials/index.js";
import { Matrix4, Vector3D } from "../../src/math/index.js";

/**
 * @invariant SCENE-HIERARCHICAL-CONTAINMENT: Sichtbarkeits-Containment ist hierarchisch sauber:
 *   Ein im Frustum liegender Child darf nicht durch einen Out-of-Frustum-Parent mitgecullt
 *   werden (Parent-Bound ⊇ Child-Bounds ist die Schallbedingung). BEFUND (D7/D17) auf HEAD:
 *   `Scene._collectVisible` early-returnete auf `parent.inFrustum === false` und übersprang
 *   dadurch sichtbare Kinder. **BEHOBEN (Commit nach P5-IMPL, campaign-lead):** das Frustum-Gate
 *   rejected jetzt nur noch den Node selbst, die Kind-Rekursion läuft immer (Child-Marker ist ein
 *   billiges Boolean; HZB-Occlusion-Gate bleibt ein Spar-Gate, da per Konstruktion monoton).
 *   Der Green-Test verankert den Containment-Fall, der Happy-Path die per-Knoten-Weltbounds.
 */

function makeDrawable(name: string): Object3D {
  const obj = new Object3D(name);
  obj.geometry = new Cube({ size: 1 }).getGeometryData();
  obj.material = new StandardMaterial();
  return obj;
}

describe("SCENE-HIERARCHICAL-CONTAINMENT", () => {
  it("collects an in-frustum child even under an out-of-frustum parent (containment fix)", () => {
    const scene = new Scene();
    const parent = new Object3D("Parent");
    parent.bounds = { getBroadRadius: () => 1 } as never;
    parent.frustumCulled = true;
    parent.inFrustum = false; // parent bounds failed / stale (not conservative wrt the child)

    const child = makeDrawable("Child");
    child.inFrustum = true; // child is independently in-frustum
    child.occlusionCulled = false;
    parent.add(child);
    scene.add(parent);

    const list = scene.getVisibleObjectsSorted(new Matrix4().data, new Vector3D());
    const names = list.opaqueBatches.flatMap((b) => b.objects.map((o) => o.name));

    expect(names).toContain("Child");
    expect(scene.lastFrustumVisibleObjects).toContain(child);
    expect(scene.lastFrustumVisibleObjects).not.toContain(parent);
  });

  it("collects an in-frustum child when its parent passes the frustum gate (happy-path traversal)", () => {
    const scene = new Scene();
    const parent = new Object3D("Parent");
    parent.bounds = { getBroadRadius: () => 1 } as never;
    parent.frustumCulled = true;
    parent.inFrustum = true;
    parent.occlusionCulled = false;

    const child = makeDrawable("Child");
    child.inFrustum = true;
    child.occlusionCulled = false;
    parent.add(child);
    scene.add(parent);

    const list = scene.getVisibleObjectsSorted(new Matrix4().data, new Vector3D());
    const names = list.opaqueBatches.flatMap((b) => b.objects.map((o) => o.name));

    // Wenn der Parent im Frustum ist, wird der (eigene Weltbounds-)Gating des Kinds respektiert
    // und das Kind landet im Render-List — die Traversierungs- und per-Knoten-Gating-Logik
    // funktioniert; fehlt nur der Parent-Out-of-Frustum-Pfad (siehe it.todo).
    expect(names).toContain("Child");
    expect(scene.lastFrustumVisibleObjects).toContain(child);
  });

  it("culls only the child whose OWN world bounds are out of frustum, even under an inside parent", () => {
    const scene = new Scene();
    const parent = new Object3D("Parent");
    parent.bounds = { getBroadRadius: () => 1 } as never;
    parent.frustumCulled = true;
    parent.inFrustum = true;

    const visibleChild = makeDrawable("VisibleChild");
    visibleChild.inFrustum = true;
    const hiddenChild = makeDrawable("HiddenChild");
    hiddenChild.bounds = { getBroadRadius: () => 1 } as never;
    hiddenChild.frustumCulled = true;
    hiddenChild.inFrustum = false; // out-of-frustum Child
    parent.add(visibleChild, hiddenChild);
    scene.add(parent);

    scene.getVisibleObjectsSorted(new Matrix4().data, new Vector3D());

    expect(scene.lastFrustumVisibleObjects).toContain(visibleChild);
    expect(scene.lastFrustumVisibleObjects).not.toContain(hiddenChild);
  });
});
