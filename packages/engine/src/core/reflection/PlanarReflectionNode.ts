import { Object3D } from "../Object3D.js";
import { Camera } from "../cameras/Camera.js";
import { Scene } from "../Scene.js";
import { PerspectiveProjection } from "../../math/projections/index.js";
import { Renderer } from "../../interfaces/index.js";
import { RenderTarget } from "../textures/index.js";
import { MathPool } from "../../math/index.js";

/**
 * A node that renders the scene from a mirrored perspective into a RenderTarget.
 */
export class PlanarReflectionNode extends Object3D {
  public renderTarget: RenderTarget;
  public mirrorCamera: Camera;

  /**
   * Objects to hide (alongside this node itself) while rendering the reflection -- typically the
   * visible mesh whose material samples `renderTarget` (e.g. a mirror floor's `reflectionMap`).
   * Unlike `DynamicReflectionProbe`, which can just hide its own parent (a probe is always a
   * child of the reflective object it orbits), a `PlanarReflectionNode` and the mesh that samples
   * its texture are typically unrelated siblings in the scene graph, so there's no structural
   * relationship to hide automatically. Leaving the reflective mesh visible during its own
   * reflection sub-render both looks wrong (it would show its own stale reflection recursively)
   * and is invalid on WebGPU: `renderTarget`'s texture would be bound as a `RenderAttachment`
   * (this render) and a `TextureBinding` (this mesh's material) in the same pass.
   */
  public excludedObjects: Object3D[] = [];

  constructor(name: string = "PlanarReflectionNode", width: number = 1024, height: number = 1024) {
    super(name);
    this.renderTarget = RenderTarget.create({ width, height });
    this.mirrorCamera = new Camera(new PerspectiveProjection());
  }

  /**
   * Updates the reflection texture by rendering the scene from a mirrored camera.
   * Call this in your update loop before the main render.
   */
  public updateReflection(scene: Scene, mainCamera: Camera, renderer: Renderer): void {
    if (!mainCamera.projection) return;
    this.mirrorCamera.aspect = mainCamera.aspect;
    this.mirrorCamera.projection = mainCamera.projection;

    const prevRenderTarget = renderer.activeRenderTarget ?? null;
    const prevCubeFace = renderer.activeCubeFace;
    const pos = MathPool.acquireVector().set(0, 0, 0);
    const planeNormal = MathPool.acquireVector().set(0, 1, 0);

    const wasVisible = this.isVisible;
    let excludedWasVisible: boolean[] = [];

    try {
      // 1. Calculate mirror plane based on this object's world matrix. Only ever read within this
      // method (recomputed fresh every call from the current world matrix), so these live as local
      // MathPool-backed scratch values rather than instance fields.
      this.worldMatrix.transformVector(pos);

      this.worldMatrix.transformVector(planeNormal);
      planeNormal.sub(pos).normalize();
      const planeConstant = -planeNormal.dot(pos);

      // 2. Mirror the camera position
      const camPos = mainCamera.position;
      const dist = planeNormal.dot(camPos) + planeConstant;
      this.mirrorCamera.position.set(
        camPos.x - 2.0 * planeNormal.x * dist,
        camPos.y - 2.0 * planeNormal.y * dist,
        camPos.z - 2.0 * planeNormal.z * dist,
      );

      // 3. Mirror the camera target
      const targetPos = mainCamera.target;
      const distTarget = planeNormal.dot(targetPos) + planeConstant;
      this.mirrorCamera.target.set(
        targetPos.x - planeNormal.x * 2 * distTarget,
        targetPos.y - planeNormal.y * 2 * distTarget,
        targetPos.z - planeNormal.z * 2 * distTarget,
      );

      // 4. Mirror the camera UP vector (must be set BEFORE updateViewMatrix)
      const up = mainCamera.up;
      const upDist = planeNormal.dot(up);
      this.mirrorCamera.up.set(
        up.x - 2.0 * planeNormal.x * upDist,
        up.y - 2.0 * planeNormal.y * upDist,
        up.z - 2.0 * planeNormal.z * upDist,
      );

      // Update view and projection internally
      this.mirrorCamera.updateViewMatrix();

      // 5. Hide this reflection node (and its children) so it doesn't occlude the reflection
      this.isVisible = false;

      // 5b. Also hide every object that samples `renderTarget` in its own material -- see
      // `excludedObjects`'s doc comment for why this can't be inferred from the scene graph.
      excludedWasVisible = this.excludedObjects.map((obj) => obj.isVisible);
      for (const obj of this.excludedObjects) obj.isVisible = false;

      // 6. Render to target
      renderer.setRenderTarget(this.renderTarget);
      renderer.render(
        scene,
        this.mirrorCamera.viewProjectionMatrix,
        this.mirrorCamera.position,
        this.mirrorCamera.viewMatrix,
      );
    } finally {
      MathPool.releaseVector(pos);
      MathPool.releaseVector(planeNormal);
      renderer.setRenderTarget(prevRenderTarget, prevCubeFace);

      // Restore visibility
      this.isVisible = wasVisible;
      if (excludedWasVisible.length > 0) {
        this.excludedObjects.forEach((obj, i) => (obj.isVisible = excludedWasVisible[i]!));
      }
    }
  }
}
