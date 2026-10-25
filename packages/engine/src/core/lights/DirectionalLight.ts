import type { LightOptions } from "./AbstractLight.js";
import { AbstractLight } from "./AbstractLight.js";
import { LightType, ProjectionType } from "../../enums/index.js";
import { Vector3D, MathPool } from "../../math/index.js";
import type { LightDataInterface } from "../../interfaces/index.js";
import { Camera } from "../cameras/Camera.js";
import type { AbstractProjection, PerspectiveProjection } from "../../math/projections/index.js";
import { OrthographicProjection } from "../../math/projections/index.js";

/**
 * Configuration options for directional light.
 */
export interface DirectionalLightOptions extends LightOptions {
  /** The direction of the light. Defaults to (0, -1, 0). */
  direction?: Vector3D;
  /** Number of shadow cascades. Defaults to 4. */
  numCascades?: number;
  /** Ratio between uniform and logarithmic split (0.0 = uniform, 1.0 = logarithmic). Defaults to 0.5. */
  cascadeSplitLambda?: number;
}

/**
 * Directional light that emits light in a specific direction.
 */
export class DirectionalLight extends AbstractLight {
  /** @inheritdoc */
  public override readonly type: LightType = LightType.DIRECTIONAL;

  /** The direction of the light. */
  public direction: Vector3D;

  /** Number of shadow cascades. */
  public numCascades: number;

  /** Ratio between uniform and logarithmic split. */
  public cascadeSplitLambda: number;

  /** The shadow cameras for each cascade. */
  public cascadeCameras: Camera[] = [];

  /** The far depth split distances for each cascade. */
  public cascadeSplits: number[] = [];

  /**
   * Per-cascade normal-offset bias lanes (E10 / P3), consumed by CascadedShadowPassGPU (WebGPU)
   * and WebGL2Renderer's `u_dirShadowBias` uniform, keyed by cascade index. Baked inside
   * `updateCascades()` from the cascade's own shadow-texel size (see CASCADE_BIAS_K below), so a
   * near cascade gets a small offset and a far cascade a larger one. Zero until a shadow-casting
   * light runs `updateCascades()`, which keeps the no-shadow default (and the constructor's
   * initial state) NaN-free.
   */
  public cascadeNormalBiases: number[] = [];

  // Pre-allocated objects to avoid GC pressure during frustum calculations
  private readonly _corners: Vector3D[] = Array.from({ length: 8 }, () => new Vector3D());
  private readonly _center: Vector3D = new Vector3D();
  private readonly _forward: Vector3D = new Vector3D();
  private readonly _right: Vector3D = new Vector3D();
  private readonly _up: Vector3D = new Vector3D();
  private readonly _nearCenter: Vector3D = new Vector3D();
  private readonly _farCenter: Vector3D = new Vector3D();
  private readonly _lightPos: Vector3D = new Vector3D();
  private readonly _lightUp: Vector3D = new Vector3D();

  /**
   * @fixed k = 1.2 per P3-E10: bewusst eingefrorener Antiwrinkle-Faktor ohne Knob (Standard).
   */
  private static readonly _CASCADE_BIAS_K = 1.2;

  /**
   * Creates a new DirectionalLight.
   * @param options The configuration options for the light.
   */
  constructor(options: DirectionalLightOptions = {}) {
    const {
      direction = new Vector3D(0, -1, 0).normalize(),
      name = "DirectionalLight",
      numCascades = 4,
      cascadeSplitLambda = 0.5,
    } = options;
    super({ ...options, name });

    this.direction = direction;
    this.numCascades = numCascades;
    this.cascadeSplitLambda = cascadeSplitLambda;

    // Initialize cascade cameras
    for (let i = 0; i < this.numCascades; i++) {
      const ortho = new OrthographicProjection({
        left: -10,
        right: 10,
        bottom: -10,
        top: 10,
        near: 0.1,
        far: 500,
      });
      const cam = new Camera(ortho);
      this.cascadeCameras.push(cam);
      this.cascadeSplits.push(0);
      this.cascadeNormalBiases.push(0);
    }
  }

  /**
   * Updates the shadow cascades based on the main camera's frustum.
   * @param cam The main camera interface data.
   */
  public updateCascades(cam: import("../../interfaces/index.js").CameraInterfaceData): void {
    if (!this.castShadow || this.numCascades <= 0) return;
    const proj = cam.projection;
    if (!proj) return;

    this._computeCascadeSplits(proj);

    // Determine light up vector to build light view matrix
    this._lightUp.set(0, 1, 0);
    if (Math.abs(this.direction.dot(this._lightUp)) > 0.999) {
      this._lightUp.set(0, 0, 1);
    }

    const isPerspective = proj.type === ProjectionType.PERSPECTIVE;

    let cascadeNear = isPerspective
      ? (proj as PerspectiveProjection).near
      : (proj as OrthographicProjection).near;
    for (let i = 0; i < this.numCascades; i++) {
      const cascadeFar = this.cascadeSplits[i]!;

      // 2. Compute bounding boxes for each cascade
      if (isPerspective) {
        this._updateFrustumCorners(cam, proj as PerspectiveProjection, cascadeNear, cascadeFar);
      } else {
        this._updateOrthoFrustumCorners(
          cam,
          proj as OrthographicProjection,
          cascadeNear,
          cascadeFar,
        );
      }

      // Center of this sub-frustum slice
      this._center.set(0, 0, 0);
      for (const c of this._corners) {
        this._center.add(c);
      }
      this._center.scale(1 / 8);

      // Position light camera at the center, pulled backwards along the light direction
      this._lightPos.copyFrom(this._center);
      this._lightPos.x -= this.direction.x * 200; // Pull back 200 units to catch casters behind the camera
      this._lightPos.y -= this.direction.y * 200;
      this._lightPos.z -= this.direction.z * 200;

      const cascadeCam = this.cascadeCameras[i]!;
      cascadeCam.position.copyFrom(this._lightPos);
      cascadeCam.target.copyFrom(this._center);
      cascadeCam.up.copyFrom(this._lightUp);
      cascadeCam.updateViewMatrix();

      // Transform corners into the light's view space
      let minX = Infinity,
        maxX = -Infinity;
      let minY = Infinity,
        maxY = -Infinity;
      let minZ = Infinity,
        maxZ = -Infinity;

      for (const c of this._corners) {
        cascadeCam.viewMatrix4.transformVector(c); // Transform world -> light view space
        if (c.x < minX) minX = c.x;
        if (c.x > maxX) maxX = c.x;
        if (c.y < minY) minY = c.y;
        if (c.y > maxY) maxY = c.y;
        if (c.z < minZ) minZ = c.z;
        if (c.z > maxZ) maxZ = c.z;
      }

      // Texel snapping: round the frustum's light-space center to whole shadow-map texels so
      // it doesn't drift by sub-texel amounts as the camera moves smoothly -- that sub-texel
      // drift is what causes CSM "shimmering" (the shadow edge crawling/swimming frame to
      // frame). Snapping the center (not min/max independently) keeps the frustum size intact.
      // Cascades are packed into a cols x cols atlas grid on WebGL2 (see WebGL2Renderer.ts),
      // so each cascade's true texel density is shadowResolution / cols; on WebGPU each
      // cascade is a full-resolution array layer, so this undercounts slightly there -- a
      // harmless, deliberately conservative approximation (coarser snap grid than strictly
      // needed, not a finer one that would fail to snap).
      const atlasCols = Math.ceil(Math.sqrt(this.numCascades));
      const perCascadeRes = this.shadowResolution / atlasCols;
      const texelSizeX = (maxX - minX) / perCascadeRes;
      const texelSizeY = (maxY - minY) / perCascadeRes;

      // Per-cascade normal-offset bias (P3-E10 / DP-13): bake k * max(texelSizeX, texelSizeY) so a
      // near (dense, small-texel) cascade gets a small offset and a far (sparse, large-texel)
      // cascade a larger one, instead of the old single global normal offset that over-biased near
      // cascades (peter-panning) and under-biased far ones (acne). Uses the same conservative
      // texel estimate as the snapping below (WebGL2 atlas density also applies to WebGPU -- a
      // deliberately coarser estimate, see above), keeping near/far bias in the intended ratio.
      // Degenerate frustum geometry (non-finite or non-positive texels) keeps the lane at its
      // constructor zero, i.e. no normal offset -- the least-bad choice for a degenerate cascade.
      this.cascadeNormalBiases[i] =
        Number.isFinite(texelSizeX) &&
        Number.isFinite(texelSizeY) &&
        texelSizeX > 0 &&
        texelSizeY > 0
          ? DirectionalLight._CASCADE_BIAS_K * Math.max(texelSizeX, texelSizeY)
          : 0;

      if (0 < texelSizeX && 0 < texelSizeY) {
        const halfWidth = (maxX - minX) * 0.5;
        const halfHeight = (maxY - minY) * 0.5;
        const snappedCenterX = Math.floor(((minX + maxX) * 0.5) / texelSizeX) * texelSizeX;
        const snappedCenterY = Math.floor(((minY + maxY) * 0.5) / texelSizeY) * texelSizeY;
        minX = snappedCenterX - halfWidth;
        maxX = snappedCenterX + halfWidth;
        minY = snappedCenterY - halfHeight;
        maxY = snappedCenterY + halfHeight;
      }

      // Update the orthographic projection bounds
      // Add padding to prevent tight clipping
      const padding = 2.0;
      const ortho = cascadeCam.projection as OrthographicProjection;
      ortho.left = minX - padding;
      ortho.right = maxX + padding;
      ortho.bottom = minY - padding;
      ortho.top = maxY + padding;

      // small-world-machine uses right-handed system (looking down -Z)
      // minZ is the most negative (farthest), maxZ is the least negative (nearest)
      ortho.near = -maxZ - 200;
      ortho.far = -minZ + 200;

      ortho.update();
      cascadeCam.updateProjectionMatrix();
      // updateViewMatrix() above multiplied the previous frame's ortho into the cached
      // view-projection matrix; recompute it now that the new bounds are applied.
      cascadeCam.updateViewMatrix();

      cascadeNear = cascadeFar;
    }
  }

  private _computeCascadeSplits(proj: AbstractProjection): void {
    if (proj.type === ProjectionType.PERSPECTIVE) {
      const perspective = proj as PerspectiveProjection;
      const near = perspective.near;
      // Limit shadow distance to something reasonable (e.g. 150) so we don't waste shadow resolution on far background
      const shadowMaxDistance = Math.min(perspective.far, 150.0);
      const ratio = shadowMaxDistance / near;

      // 1. Calculate cascade split distances (Practical Split Scheme)
      for (let i = 0; i < this.numCascades; i++) {
        const p = (i + 1) / this.numCascades;
        const log = near * Math.pow(ratio, p);
        const uniform = near + (shadowMaxDistance - near) * p;
        this.cascadeSplits[i] =
          log * this.cascadeSplitLambda + uniform * (1.0 - this.cascadeSplitLambda);
      }
    } else {
      // An orthographic camera has no perspective divergence, so the practical split scheme
      // buys nothing -- split the box depth linearly so every cascade tracks the frustum instead
      // of the first cascade covering everything.
      const ortho = proj as OrthographicProjection;
      const near = ortho.near;
      const far = ortho.far;
      for (let i = 0; i < this.numCascades; i++) {
        this.cascadeSplits[i] = near + (far - near) * ((i + 1) / this.numCascades);
      }
    }
  }

  private _updateFrustumCorners(
    cam: import("../../interfaces/index.js").CameraInterfaceData,
    proj: PerspectiveProjection,
    nearDist: number,
    farDist: number,
  ): void {
    const fov = proj.fov;
    const aspect = proj.aspect;

    const nearHeight = 2 * Math.tan(fov / 2) * nearDist;
    const nearWidth = nearHeight * aspect;

    const farHeight = 2 * Math.tan(fov / 2) * farDist;
    const farWidth = farHeight * aspect;

    // Camera axes
    this._forward.copyFrom(cam.target).sub(cam.position).normalize();
    this._right.copyFrom(this._forward).cross(cam.up).normalize();
    this._up.copyFrom(this._right).cross(this._forward).normalize();

    const tempVec = MathPool.acquireVector();

    tempVec.set(this._forward.x * nearDist, this._forward.y * nearDist, this._forward.z * nearDist);
    this._nearCenter.copyFrom(cam.position).add(tempVec);

    tempVec.set(this._forward.x * farDist, this._forward.y * farDist, this._forward.z * farDist);
    this._farCenter.copyFrom(cam.position).add(tempVec);

    // Near Plane Corners
    this._setCorner(this._corners[0]!, this._nearCenter, nearHeight, nearWidth, 1, -1);
    this._setCorner(this._corners[1]!, this._nearCenter, nearHeight, nearWidth, 1, 1);
    this._setCorner(this._corners[2]!, this._nearCenter, nearHeight, nearWidth, -1, -1);
    this._setCorner(this._corners[3]!, this._nearCenter, nearHeight, nearWidth, -1, 1);

    // Far Plane Corners
    this._setCorner(this._corners[4]!, this._farCenter, farHeight, farWidth, 1, -1);
    this._setCorner(this._corners[5]!, this._farCenter, farHeight, farWidth, 1, 1);
    this._setCorner(this._corners[6]!, this._farCenter, farHeight, farWidth, -1, -1);
    this._setCorner(this._corners[7]!, this._farCenter, farHeight, farWidth, -1, 1);

    MathPool.releaseVector(tempVec);
  }

  /**
   * Fill `_corners` with the 8 world-space corners of a cascade slab of an orthographic camera.
   * Unlike the perspective path, an orthographic frustum has a constant width/height along the view
   * direction (parallel projection), so the slab is a plain box: corners are read straight off
   * `left/right/top/bottom` instead of being derived from fov/aspect.
   */
  private _updateOrthoFrustumCorners(
    cam: import("../../interfaces/index.js").CameraInterfaceData,
    proj: OrthographicProjection,
    nearDist: number,
    farDist: number,
  ): void {
    const height = proj.top - proj.bottom;
    const width = proj.right - proj.left;

    // Camera axes
    this._forward.copyFrom(cam.target).sub(cam.position).normalize();
    this._right.copyFrom(this._forward).cross(cam.up).normalize();
    this._up.copyFrom(this._right).cross(this._forward).normalize();

    const tempVec = MathPool.acquireVector();

    tempVec.set(this._forward.x * nearDist, this._forward.y * nearDist, this._forward.z * nearDist);
    this._nearCenter.copyFrom(cam.position).add(tempVec);

    tempVec.set(this._forward.x * farDist, this._forward.y * farDist, this._forward.z * farDist);
    this._farCenter.copyFrom(cam.position).add(tempVec);

    // Near Plane Corners
    this._setCorner(this._corners[0]!, this._nearCenter, height, width, 1, -1);
    this._setCorner(this._corners[1]!, this._nearCenter, height, width, 1, 1);
    this._setCorner(this._corners[2]!, this._nearCenter, height, width, -1, -1);
    this._setCorner(this._corners[3]!, this._nearCenter, height, width, -1, 1);

    // Far Plane Corners
    this._setCorner(this._corners[4]!, this._farCenter, height, width, 1, -1);
    this._setCorner(this._corners[5]!, this._farCenter, height, width, 1, 1);
    this._setCorner(this._corners[6]!, this._farCenter, height, width, -1, -1);
    this._setCorner(this._corners[7]!, this._farCenter, height, width, -1, 1);

    MathPool.releaseVector(tempVec);
  }

  private _setCorner(
    out: Vector3D,
    center: Vector3D,
    h: number,
    w: number,
    yDir: number,
    xDir: number,
  ): void {
    out.copyFrom(center);

    const tempVec = MathPool.acquireVector();
    tempVec.set(
      this._up.x * (h / 2) * yDir,
      this._up.y * (h / 2) * yDir,
      this._up.z * (h / 2) * yDir,
    );
    out.add(tempVec);

    tempVec.set(
      this._right.x * (w / 2) * xDir,
      this._right.y * (w / 2) * xDir,
      this._right.z * (w / 2) * xDir,
    );
    out.add(tempVec);

    MathPool.releaseVector(tempVec);
  }

  /** @inheritdoc */
  public override applyTo(data: LightDataInterface): void {
    data.dDir.set(this.direction.x, this.direction.y, this.direction.z);
    // Invert direction for lighting calculations
    data.dDir.scale(-1).normalize();
    data.dCol.copyFrom(this.color);
    data.dIntensity = this.intensity;
    data.dLight = this;
  }
}
