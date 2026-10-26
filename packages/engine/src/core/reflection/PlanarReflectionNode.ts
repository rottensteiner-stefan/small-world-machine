import { Object3D } from "../Object3D.js";
import { Camera } from "../cameras/Camera.js";
import type { Scene } from "../Scene.js";
import { PerspectiveProjection } from "../../math/projections/index.js";
import type { Renderer } from "../../interfaces/index.js";
import { RenderTarget } from "../textures/index.js";
import { MathPool, Matrix4, type Vector3D } from "../../math/index.js";

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

  /**
   * Cuts everything below the mirror plane out of the reflection (oblique near-plane clipping,
   * Lengyel 2004; Unity/Godot planar reflections do the same). Without it a seabed or a pool
   * floor lies between the mirrored camera and the surface and hides the reflection of the sky
   * and the shore. Costs nothing per pixel; `false` renders the unclipped scene.
   * @domain true clips below the plane (water, mirror floor); false keeps the whole scene.
   */
  public clipBelowPlane: boolean = true;

  /**
   * Distance of the clip plane from the mirror plane along its normal, in meters (positive = up).
   * A small negative value keeps the foot of shoreline geometry that sits just below a wavy
   * surface from being cut away.
   * @domain world meters along the plane normal; 0 = exactly the mirror plane.
   */
  public clipPlaneOffset: number = 0;

  private readonly _clipProjection: Matrix4 = new Matrix4();
  private readonly _clipInverse: Matrix4 = new Matrix4();
  private readonly _clipViewProj: Matrix4 = new Matrix4();

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

      // 5c. Clip everything below the plane out of the mirror image.
      const viewProjection = this.clipBelowPlane
        ? this._obliqueViewProjection(pos, planeNormal)
        : this.mirrorCamera.viewProjectionMatrix;

      // 6. Render to target
      renderer.setRenderTarget(this.renderTarget);
      renderer.render(
        scene,
        viewProjection,
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

  /**
   * View-projection of the mirror camera whose near plane is replaced by the mirror plane
   * (`pos`, `normal` in world space, normal pointing to the visible side). The camera's own
   * projection is shared with the main camera and stays untouched.
   */
  private _obliqueViewProjection(pos: Vector3D, normal: Vector3D): Float32Array {
    const view = this.mirrorCamera.viewMatrix4.data;
    const proj = this._clipProjection;
    proj.copy(this.mirrorCamera.projection.getMatrix());
    const p = proj.data;

    // Plane in camera space: normal = rotation part of the view matrix, point = view * position.
    const nx = normal.x;
    const ny = normal.y;
    const nz = normal.z;
    const cx = view[0]! * nx + view[4]! * ny + view[8]! * nz;
    const cy = view[1]! * nx + view[5]! * ny + view[9]! * nz;
    const cz = view[2]! * nx + view[6]! * ny + view[10]! * nz;
    const px = pos.x + nx * this.clipPlaneOffset;
    const py = pos.y + ny * this.clipPlaneOffset;
    const pz = pos.z + nz * this.clipPlaneOffset;
    const vx = view[0]! * px + view[4]! * py + view[8]! * pz + view[12]!;
    const vy = view[1]! * px + view[5]! * py + view[9]! * pz + view[13]!;
    const vz = view[2]! * px + view[6]! * py + view[10]! * pz + view[14]!;
    const cw = -(vx * cx + vy * cy + vz * cz);

    // Corner of the clip volume opposite the plane, back in camera space: q = P^-1 * (sgn(c.xy), 1, 1).
    if (!proj.invert(this._clipInverse)) return this.mirrorCamera.viewProjectionMatrix;
    const inv = this._clipInverse.data;
    const sx = Math.sign(cx);
    const sy = Math.sign(cy);
    const qx = inv[0]! * sx + inv[4]! * sy + inv[8]! + inv[12]!;
    const qy = inv[1]! * sx + inv[5]! * sy + inv[9]! + inv[13]!;
    const qz = inv[2]! * sx + inv[6]! * sy + inv[10]! + inv[14]!;
    const qw = inv[3]! * sx + inv[7]! * sy + inv[11]! + inv[15]!;
    const scale = 2 / (cx * qx + cy * qy + cz * qz + cw * qw);

    // The third row of the projection becomes plane - fourth row (column-major storage).
    p[2] = cx * scale - p[3]!;
    p[6] = cy * scale - p[7]!;
    p[10] = cz * scale - p[11]!;
    p[14] = cw * scale - p[15]!;

    Matrix4.multiply(proj, this.mirrorCamera.viewMatrix4, this._clipViewProj);
    return this._clipViewProj.data;
  }

  /**
   * Releases the GPU resources of `renderTarget` on `renderer`. Call it when the node is removed
   * for good (or before replacing the renderer): the target is owned by this node, so nothing else
   * frees it before `renderer.destroy()`. Rendering again afterwards simply re-allocates it.
   */
  public dispose(renderer: Renderer): void {
    renderer.releaseRenderTarget?.(this.renderTarget);
  }
}
