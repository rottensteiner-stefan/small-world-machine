import { describe, expect, it } from "vitest";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { Camera } from "../../src/core/cameras/Camera.js";
import { PerspectiveProjection } from "../../src/math/projections/PerspectiveProjection.js";
import { DirectionalLight } from "../../src/core/lights/DirectionalLight.js";
import { BasicMaterial } from "../../src/core/materials/surface/BasicMaterial.js";
import { BoundingSphere } from "../../src/physix/index.js";
import { Vector3D } from "../../src/math/Vector3D.js";
import type { GeometryDataInterface } from "../../src/interfaces/index.js";
import { ShadowCasterCollector } from "../../src/renderers/passes/ShadowCasterCollector.js";

describe("ShadowCasterCollector (R2 off-screen & HZB-occluded shadow casters)", () => {
  it("collects shadow casters behind the main camera or marked occlusionCulled when inside a light cascade frustum", () => {
    const scene = new Scene();
    const camera = new Camera(
      new PerspectiveProjection({ fov: Math.PI / 3, aspect: 1.0, near: 0.1, far: 100 }),
    );
    camera.position.set(0, 2, 0);
    camera.target.set(0, 2, -10);
    camera.updateViewMatrix();

    const light = new DirectionalLight({
      direction: new Vector3D(0, -0.7071, -0.7071).normalize(),
      numCascades: 2,
      castShadow: true,
    });
    scene.add(light);

    const material = new BasicMaterial();
    const geometry: GeometryDataInterface = {
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      getBoundingVolume: () => new BoundingSphere(new Vector3D(0, 0, 0), 1),
    };

    // Caster positioned behind the main camera (+Z), casting a shadow forward into the camera view (-Z)
    const behindCameraCaster = new Object3D("BehindCameraCaster");
    behindCameraCaster.geometry = geometry;
    behindCameraCaster.material = material;
    behindCameraCaster.castShadow = true;
    behindCameraCaster.position.set(0, 6, 4);
    behindCameraCaster.bounds = new BoundingSphere(new Vector3D(0, 6, 4), 1.5);
    scene.add(behindCameraCaster);

    // Caster inside the camera view but marked occlusionCulled by HZB from the camera's perspective
    const occludedCaster = new Object3D("HzbOccludedCaster");
    occludedCaster.geometry = geometry;
    occludedCaster.material = material;
    occludedCaster.castShadow = true;
    occludedCaster.position.set(0, 2, -6);
    occludedCaster.bounds = new BoundingSphere(new Vector3D(0, 2, -6), 1.5);
    scene.add(occludedCaster);

    scene.update(0.016);
    behindCameraCaster.bounds = new BoundingSphere(new Vector3D(0, 6, 4), 1.5);
    occludedCaster.bounds = new BoundingSphere(new Vector3D(0, 2, -6), 1.5);
    behindCameraCaster.inFrustum = false;
    occludedCaster.occlusionCulled = true;

    // Main camera render list culls both objects
    const mainRenderList = scene.getVisibleObjectsSorted(
      camera.viewProjectionMatrix,
      camera.position,
    );
    const mainVisibleObjects = mainRenderList.opaqueBatches.flatMap((b) => b.objects);
    expect(mainVisibleObjects).not.toContain(behindCameraCaster);
    expect(mainVisibleObjects).not.toContain(occludedCaster);

    // ShadowCasterCollector traverses scene.root against the light cascades and keeps both casters
    light.updateCascades(camera);
    const collector = new ShadowCasterCollector();
    collector.reset();
    for (let i = 0; i < light.numCascades; i++) {
      collector.addViewProjectionMatrix(light.cascadeCameras[i]!.viewProjectionMatrix);
    }
    collector.collect(scene.root);

    const shadowObjects = collector.batches.flatMap((b) => b.objects);
    expect(shadowObjects).toContain(behindCameraCaster);
    expect(shadowObjects).toContain(occludedCaster);
  });
});
