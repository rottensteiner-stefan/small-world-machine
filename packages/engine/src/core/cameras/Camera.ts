import type { AbstractProjection } from "../../math/projections/index.js";
import { MathPool, Matrix4, Quaternion, Vector3D } from "../../math/index.js";
import { CameraEffectFactory, CameraStrategyFactory } from "./index.js";
import type { CameraEffectType } from "../../enums/index.js";
import { CameraStrategyType } from "../../enums/index.js";
import type {
  CameraConstraints,
  CameraEffect,
  CameraInterfaceData,
  CameraStrategy,
} from "../../interfaces/index.js";
import type { Behavior } from "../behaviors/Behavior.js";
import { attachBehavior, detachBehavior } from "../behaviors/Behavior.js";
import { CameraFlyToBehavior, type CameraFlyToOptions } from "../behaviors/CameraFlyToBehavior.js";
import { Color } from "../colors/index.js";

/**
 * Standard implementation of the CameraInterfaceData.
 */
export class Camera implements CameraInterfaceData {
  /** @inheritdoc */
  public position: Vector3D = new Vector3D(0, 10, 20);
  /** @inheritdoc */
  public target: Vector3D = new Vector3D(0, 0, 0);
  /** @inheritdoc */
  public up: Vector3D = new Vector3D(0, 1, 0);

  /** @inheritdoc */
  public theta: number = 0;
  /** @inheritdoc */
  public phi: number = 0;

  /** @inheritdoc */
  public pendingDx: number = 0;
  /** @inheritdoc */
  public pendingDy: number = 0;

  /** @inheritdoc */
  public behaviors: Behavior[] = [];

  private _projection!: AbstractProjection;
  private _aspect: number = 1;

  private _strategy!: CameraStrategy;

  private _effects: CameraEffect[] = [];
  private _yawOffset: number = 0;
  private _pitchOffset: number = 0;
  private _flashIntensity: number = 0;
  private readonly _flashColor: Color = new Color(1, 1, 1);
  private readonly _effectQuat: Quaternion = new Quaternion();

  private _viewMatrix: Matrix4 = new Matrix4();
  private _viewProjMatrix: Matrix4 = new Matrix4();

  /** Sub-pixel jitter offset (NDC units) for TAA, baked into `viewProjectionMatrix` for every
   * consumer rather than a separate matrix -- see `docs/adr/0002-taa-jitter-shared-viewproj-matrix.md`. */
  public jitterX: number = 0;
  public jitterY: number = 0;

  /**
   * Creates a new Camera.
   * @param projection The projection to use.
   */
  constructor(projection: AbstractProjection) {
    this.projection = projection;
    this.setStrategy(CameraStrategyType.DEFAULT);
  }

  /** @inheritdoc */
  public get projection(): AbstractProjection {
    return this._projection;
  }

  /** @inheritdoc */
  public set projection(value: AbstractProjection) {
    this._projection = value;
    this._projection.setAspect(this._aspect);
  }

  /** @inheritdoc */
  public get viewProjectionMatrix(): Float32Array {
    return this._viewProjMatrix.data;
  }

  /** @inheritdoc */
  public get viewProjectionMatrix4(): Matrix4 {
    return this._viewProjMatrix;
  }

  /** @inheritdoc */
  public get viewMatrix(): Float32Array {
    return this._viewMatrix.data;
  }

  /** @inheritdoc */
  public get viewMatrix4(): Matrix4 {
    return this._viewMatrix;
  }

  /** @inheritdoc */
  public get aspect(): number {
    return this._aspect;
  }

  /** @inheritdoc */
  public set aspect(value: number) {
    this._aspect = value;
    this.projection.setAspect(value);
  }

  /** @inheritdoc */
  public zoom(delta: number): void {
    // 1. Try to let the strategy handle the zoom (e.g. radius adjustment)
    if (this._strategy.zoom?.(this, delta)) {
      return;
    }

    // 2. Delegate to projection (e.g. FOV or bounds scaling)
    this.projection.zoom(delta);
  }

  /** @inheritdoc */
  public updateProjectionMatrix(): void {
    this.projection.update();
  }

  /** @inheritdoc */
  public updateViewMatrix(): void {
    const finalPos = MathPool.acquireVector().copyFrom(this.position);
    const finalTarget = MathPool.acquireVector().copyFrom(this.target);

    for (const effect of this._effects) {
      finalPos.add(effect.offset);
      finalTarget.add(effect.targetOffset);
    }

    if (0 !== this._yawOffset || 0 !== this._pitchOffset) {
      // Rotate the view direction (not the position) around the camera, so shake can never
      // clip it through geometry, and the effect stays independent of the target distance.
      const direction = MathPool.acquireVector().copyFrom(finalTarget).sub(finalPos);
      const euler = MathPool.acquireVector().set(this._pitchOffset, this._yawOffset, 0);
      this._effectQuat.setFromEuler(euler);
      direction.applyQuaternion(this._effectQuat);
      finalTarget.copyFrom(finalPos).add(direction);
      MathPool.releaseVector(direction);
      MathPool.releaseVector(euler);
    }

    Matrix4.lookAt(finalPos, finalTarget, this.up, this._viewMatrix);
    Matrix4.multiply(this.projection.getMatrix(), this._viewMatrix, this._viewProjMatrix);

    if (0 !== this.jitterX || 0 !== this.jitterY) {
      // Standard TAA jitter injection: add the offset into the projection's third column, so
      // it scales with view-space z during the perspective divide (a constant NDC offset
      // regardless of depth) rather than distorting near/far differently.
      this._viewProjMatrix.data[8] = (this._viewProjMatrix.data[8] ?? 0) + this.jitterX;
      this._viewProjMatrix.data[9] = (this._viewProjMatrix.data[9] ?? 0) + this.jitterY;
    }

    MathPool.releaseVector(finalPos);
    MathPool.releaseVector(finalTarget);
  }

  /** @inheritdoc */
  public screenToWorld(screenX: number, screenY: number): Vector3D {
    const invVP: Matrix4 = MathPool.acquireMatrix();
    if (false === this._viewProjMatrix.invert(invVP)) {
      MathPool.releaseMatrix(invVP);
      return new Vector3D().copyFrom(this.target);
    }

    // Points in NDC space
    const pNear: Vector3D = MathPool.acquireVector().set(screenX, screenY, -1);
    const pFar: Vector3D = MathPool.acquireVector().set(screenX, screenY, 1);

    // Transform to world space
    invVP.transformVector(pNear);
    invVP.transformVector(pFar);

    const result: Vector3D = new Vector3D();
    const dy: number = pFar.y - pNear.y;

    if (0.0001 < Math.abs(dy)) {
      const t: number = -pNear.y / dy;
      // Linear interpolation between pNear and pFar at Y=0
      result.set(pNear.x + (pFar.x - pNear.x) * t, 0, pNear.z + (pFar.z - pNear.z) * t);
    } else {
      result.copyFrom(pNear);
      result.y = 0;
    }

    MathPool.releaseMatrix(invVP);
    MathPool.releaseVector(pNear);
    MathPool.releaseVector(pFar);

    return result;
  }

  /** @inheritdoc */
  public project(worldPos: Vector3D, result: Vector3D = new Vector3D()): Vector3D {
    const e = this._viewProjMatrix.data;
    const wClip =
      (e[3] ?? 0) * worldPos.x +
      (e[7] ?? 0) * worldPos.y +
      (e[11] ?? 0) * worldPos.z +
      (e[15] ?? 0);
    this._viewProjMatrix.transformVector(worldPos, result);
    if (wClip <= 0) {
      // Behind the camera. True in-front NDC Z can never drop below -1 (the near plane), so the
      // sentinel -2 is unambiguous. Callers MUST gate on `z >= -1` (NOT `z > 0`): with
      // OpenGL-style depth, in-front points closer than ~2x near always have negative NDC Z.
      result.z = -2;
    }
    return result;
  }

  /** @inheritdoc */
  public get strategy(): CameraStrategy {
    return this._strategy;
  }

  /** @inheritdoc */
  public setStrategy(type: CameraStrategyType): void {
    const oldStrategy: CameraStrategy | undefined = this._strategy;
    const oldConstraints: CameraConstraints | undefined = oldStrategy?.constraints;
    const next: CameraStrategy = CameraStrategyFactory.get(type);

    // D3: explicit state transition. Entering FPS must re-derive theta/phi from the CURRENT
    // view direction (target - position); otherwise an orbit-convention state is reused
    // blindly and the view snaps ~180 deg (control break on strategy switch).
    if (next.type === CameraStrategyType.FPS && oldStrategy) {
      const fx: number = this.target.x - this.position.x;
      const fy: number = this.target.y - this.position.y;
      const fz: number = this.target.z - this.position.z;
      const len: number = Math.sqrt(fx * fx + fy * fy + fz * fz);
      if (len > 1e-6) {
        const limit: number = Math.PI / 2 - 0.01;
        const phi: number = Math.asin(fy / len);
        this.phi = Math.min(limit, Math.max(-limit, phi));
        this.theta = Math.atan2(fx / len, -fz / len);
      }
    }

    this._strategy = next;
    if (undefined !== oldConstraints) {
      next.constraints = oldConstraints;
    }
  }

  /** @inheritdoc */
  public setConstraints(constraints?: CameraConstraints): void {
    if (this._strategy) {
      this._strategy.constraints = constraints;
    }
  }

  public addBehavior(behavior: Behavior): this {
    attachBehavior(this.behaviors, behavior, this);
    return this;
  }

  public removeBehavior(behavior: Behavior): this {
    detachBehavior(this.behaviors, behavior);
    return this;
  }

  /**
   * Whether the camera is currently executing a cinematic fly-through transition.
   */
  public get isFlying(): boolean {
    const flyBehavior = this.behaviors.find(
      (b): b is CameraFlyToBehavior => b instanceof CameraFlyToBehavior,
    );
    return flyBehavior?.isFlying ?? false;
  }

  /**
   * Initiates a smooth cinematic fly-through transition to the target position and look-at point.
   * Lazily attaches a CameraFlyToBehavior if not already present on the camera.
   * @param options Target position, look-at target, and curve settings.
   * @returns Promise resolving to `true` when the destination is reached, or `false` if cancelled.
   */
  public flyTo(options: CameraFlyToOptions): Promise<boolean> {
    let flyBehavior = this.behaviors.find(
      (b): b is CameraFlyToBehavior => b instanceof CameraFlyToBehavior,
    );
    if (!flyBehavior) {
      flyBehavior = new CameraFlyToBehavior();
      this.addBehavior(flyBehavior);
    }
    return flyBehavior.flyTo(options);
  }

  /**
   * Cancels any active camera fly-through transition immediately.
   */
  public cancelFlight(): void {
    const flyBehavior = this.behaviors.find(
      (b): b is CameraFlyToBehavior => b instanceof CameraFlyToBehavior,
    );
    flyBehavior?.cancel();
  }

  /** @inheritdoc */
  public get activeStrategyType(): string {
    return this._strategy.type;
  }

  /** @inheritdoc */
  public get flashIntensity(): number {
    return this._flashIntensity;
  }

  /** @inheritdoc */
  public get flashColor(): Color {
    return this._flashColor;
  }

  /** @inheritdoc */
  public update(targetPos: Vector3D, dx: number, dy: number, deltaTime: number = 0.016): void {
    for (let i = 0; i < this.behaviors.length; i++) {
      const b = this.behaviors[i]!;
      if (b.isActive) b.update(deltaTime);
    }

    const totalDx = dx + this.pendingDx;
    const totalDy = dy + this.pendingDy;
    this.pendingDx = 0;
    this.pendingDy = 0;

    if (this._strategy) {
      this._strategy.update(this, targetPos, totalDx, totalDy);
    }

    // Update effects
    for (let i: number = this._effects.length - 1; 0 <= i; i--) {
      const effect: CameraEffect = this._effects[i]!;
      effect.update(deltaTime);
      if (effect.isFinished) {
        this._effects.splice(i, 1);
      }
    }

    // Aggregate the rotation/flash channels across all active effects. Position (`offset`/
    // `targetOffset`) is summed directly in `updateViewMatrix()` instead, since it's applied
    // there alongside the rotation.
    let yaw: number = 0;
    let pitch: number = 0;
    let flash: number = 0;
    let strongestFlash: number = 0;
    for (const effect of this._effects) {
      yaw += effect.yawOffset;
      pitch += effect.pitchOffset;
      flash += effect.flashIntensity;
      if (effect.flashIntensity > strongestFlash) {
        strongestFlash = effect.flashIntensity;
        this._flashColor.copyFrom(effect.flashColor);
      }
    }
    this._yawOffset = yaw;
    this._pitchOffset = pitch;
    this._flashIntensity = Math.min(1, flash);

    this.updateViewMatrix();
  }

  /**
   * Adds a new effect to the camera. If an existing effect of the same type accepts a merge,
   * `effect` is absorbed into it instead of stacking a separate, independently-decaying instance.
   * @param effect The effect to add.
   * @returns The effect that now represents this addition.
   */
  public addEffect(effect: CameraEffect): CameraEffect {
    for (const existing of this._effects) {
      if (existing.type === effect.type && true === existing.merge?.(effect)) {
        return existing;
      }
    }
    this._effects.push(effect);
    return effect;
  }

  /**
   * Removes a specific effect instance.
   * @param effect The effect instance to remove.
   */
  public removeEffect(effect: CameraEffect): void {
    const index: number = this._effects.indexOf(effect);
    if (-1 !== index) {
      this._effects.splice(index, 1);
    }
  }

  /**
   * Removes all active effects, or all effects of a specific type.
   * @param type If given, only effects of this type are removed; otherwise all are.
   */
  public clearEffects(type?: CameraEffectType): void {
    if (undefined === type) {
      this._effects.length = 0;
      return;
    }
    this._effects = this._effects.filter((effect: CameraEffect): boolean => effect.type !== type);
  }

  /**
   * Creates and adds a new effect by type.
   * @param type The type of effect.
   * @param intensity The intensity.
   * @param duration The duration in seconds.
   * @param color The tint color, only used by effects that support one (e.g. Flash).
   * @returns The effect that now represents this addition.
   */
  public applyEffect(
    type: CameraEffectType,
    intensity?: number,
    duration?: number,
    color?: Color,
  ): CameraEffect {
    return this.addEffect(CameraEffectFactory.create(type, intensity, duration, color));
  }
}
