import { Object3D } from "../Object3D.js";
import { Camera } from "../cameras/Camera.js";
import type { Scene } from "../Scene.js";
import { PerspectiveProjection } from "../../math/projections/index.js";
import type { Renderer } from "../../interfaces/index.js";
import { RenderTargetCube } from "../textures/index.js";
import { Vector3D, MathPool, MathUtils } from "../../math/index.js";
import { RendererType } from "../../enums/index.js";

/**
 * A probe that renders the environment into a CubeMap from its position.
 * Features time-slicing to update only a subset of faces per frame for better performance.
 */
export class DynamicReflectionProbe extends Object3D {
  public renderTarget: RenderTargetCube;
  public probeCamera: Camera;

  /** Number of faces to update per frame (1-6). Default is 1 for max performance. */
  public facesPerFrame: number = 1;

  private _currentFace: number = 0;

  /**
   * The 6 directions for the cube faces: +X, -X, +Y, -Y, +Z, -Z
   * WebGL/WebGPU cube map face order:
   * 0: +X (Right)
   * 1: -X (Left)
   * 2: +Y (Top)
   * 3: -Y (Bottom)
   * 4: +Z (Front)
   * 5: -Z (Back)
   *
   * Up-vectors for a top-left-origin backend (WebGPU/D3D/Metal). WebGL's bottom-left
   * framebuffer origin needs every up-vector negated relative to this table when rendering
   * into an FBO-attached cube face, or the 4 side faces come out vertically flipped and
   * floor/sky content bleeds into the wrong hemisphere of a mirror reflection (see
   * `_FACE_DIRECTIONS_GL` below, and three.js's `CubeCamera` for the same reference convention).
   */
  private static readonly _FACE_DIRECTIONS = [
    { dir: new Vector3D(1, 0, 0), up: new Vector3D(0, 1, 0) }, // Positive X
    { dir: new Vector3D(-1, 0, 0), up: new Vector3D(0, 1, 0) }, // Negative X
    { dir: new Vector3D(0, 1, 0), up: new Vector3D(0, 0, -1) }, // Positive Y (Look up, up is -Z)
    { dir: new Vector3D(0, -1, 0), up: new Vector3D(0, 0, 1) }, // Negative Y (Look down, up is +Z)
    { dir: new Vector3D(0, 0, 1), up: new Vector3D(0, 1, 0) }, // Positive Z
    { dir: new Vector3D(0, 0, -1), up: new Vector3D(0, 1, 0) }, // Negative Z
  ];

  /** Same face/direction order as `_FACE_DIRECTIONS`, up-vectors negated for WebGL's FBO cube-face convention. */
  private static readonly _FACE_DIRECTIONS_GL = [
    { dir: new Vector3D(1, 0, 0), up: new Vector3D(0, -1, 0) }, // Positive X
    { dir: new Vector3D(-1, 0, 0), up: new Vector3D(0, -1, 0) }, // Negative X
    { dir: new Vector3D(0, 1, 0), up: new Vector3D(0, 0, 1) }, // Positive Y
    { dir: new Vector3D(0, -1, 0), up: new Vector3D(0, 0, -1) }, // Negative Y
    { dir: new Vector3D(0, 0, 1), up: new Vector3D(0, -1, 0) }, // Positive Z
    { dir: new Vector3D(0, 0, -1), up: new Vector3D(0, -1, 0) }, // Negative Z
  ];

  constructor(name: string = "DynamicReflectionProbe", resolution: number = 256) {
    super(name);
    this.renderTarget = RenderTargetCube.create({ width: resolution, height: resolution });

    const proj = new PerspectiveProjection();
    proj.fov = Math.PI / 2; // 90 degree FOV in radians to exactly cover one face
    proj.setAspect(1.0); // 1:1 aspect ratio for cube faces
    proj.near = 0.1;
    proj.far = 1000.0;

    this.probeCamera = new Camera(proj);
  }

  /**
   * Updates the environment probe.
   * Renders the specified number of faces into the CubeMap.
   * Call this in your update loop before the main render.
   */
  public updateReflection(scene: Scene, renderer: Renderer): void {
    // Hide this probe (and its children) so it doesn't occlude the reflection
    const wasVisible = this.isVisible;
    this.isVisible = false;

    // Also hide parent if it's not the scene root, to avoid the object reflecting itself from the inside.
    // Note: Scene.root is an Object3D, not a Scene instance. We guard against hiding scene.root when
    // the probe is attached directly to the scene.
    const isParentSceneRoot =
      !this.parent || this.parent === scene.root || this.parent.parent === undefined;
    let parentWasVisible = true;
    const hideParent = !isParentSceneRoot;
    if (hideParent && this.parent) {
      parentWasVisible = this.parent.isVisible;
      this.parent.isVisible = false;
    }

    const prevRenderTarget = renderer.activeRenderTarget ?? null;
    const prevCubeFace = renderer.activeCubeFace;
    const pos = MathPool.acquireVector().set(0, 0, 0);

    try {
      // Get world position of this probe
      this.worldMatrix.transformVector(pos);
      this.probeCamera.position.copyFrom(pos);

      // Update faces based on time-slicing
      const facesToUpdate = MathUtils.clamp(this.facesPerFrame, 1, 6);
      const isWebGL =
        renderer.type === RendererType.WEB_GL1 || renderer.type === RendererType.WEB_GL2;
      const faceDirections = isWebGL
        ? DynamicReflectionProbe._FACE_DIRECTIONS_GL
        : DynamicReflectionProbe._FACE_DIRECTIONS;

      for (let i = 0; i < facesToUpdate; i++) {
        const faceIndex = this._currentFace;
        const dirInfo = faceDirections[faceIndex]!;

        // Set camera lookAt and up
        this.probeCamera.target.set(
          pos.x + dirInfo.dir.x,
          pos.y + dirInfo.dir.y,
          pos.z + dirInfo.dir.z,
        );
        this.probeCamera.up.copyFrom(dirInfo.up);

        this.probeCamera.updateViewMatrix();

        // Render to specific cube face
        renderer.setRenderTarget(this.renderTarget, faceIndex);
        renderer.render(
          scene,
          this.probeCamera.viewProjectionMatrix,
          this.probeCamera.position,
          this.probeCamera.viewMatrix,
        );

        // Advance face counter
        this._currentFace = (this._currentFace + 1) % 6;
      }
    } finally {
      MathPool.releaseVector(pos);
      renderer.setRenderTarget(prevRenderTarget, prevCubeFace);

      // Restore visibility
      this.isVisible = wasVisible;
      if (hideParent && this.parent) {
        this.parent.isVisible = parentWasVisible;
      }
    }
  }

  /**
   * Releases the cube target's GPU resources on `renderer` (see `PlanarReflectionNode.dispose`).
   */
  public dispose(renderer: Renderer): void {
    renderer.releaseRenderTarget?.(this.renderTarget);
  }
}
