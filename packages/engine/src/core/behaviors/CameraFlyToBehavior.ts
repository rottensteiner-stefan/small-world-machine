import { Behavior } from "./Behavior.js";
import type { CameraInterfaceData } from "../../interfaces/CameraInterfaceData.js";
import { Vector3D } from "../../math/Vector3D.js";
import { Easing } from "../../math/Easing.js";
import { CatmullRomSpline } from "../../math/CatmullRomSpline.js";

/**
 * Configuration options for initiating a camera fly-through transition.
 */
export interface CameraFlyToOptions {
  /** Target camera position in world coordinates. */
  position: Vector3D;
  /** Target look-at point in world coordinates. */
  target: Vector3D;
  /**
   * Optional intermediate 3D waypoints that the camera must pass through in order.
   * - 0 waypoints: Smooth quadratic Bézier with gentle crane/arched lift.
   * - 1 waypoint: Millimeter-precise pass-through at t = 0.5 via inverse quadratic Bézier.
   * - 2+ waypoints: Smooth Catmull-Rom spline guaranteeing continuous velocity (C1) and
   *   exact passage through every waypoint in order.
   */
  waypoints?: readonly Vector3D[] | undefined;
  /**
   * Flight duration in seconds.
   * If omitted, dynamically calculated based on trajectory distance (clamped in [1.0s, 4.5s]).
   */
  duration?: number | undefined;
  /**
   * Easing function mapping normalized time in [0, 1] to eased progress in [0, 1].
   * Defaults to `Easing.easeInOutCubic`.
   */
  easing?: ((t: number) => number) | undefined;
  /**
   * Optional single 3D control point shaping a quadratic Bézier flight trajectory.
   * If `isWaypoint` is true, this point is treated as an exact waypoint that the camera passes
   * through at t = 0.5 (via inverse quadratic Bézier control point solving: P1 = 2W - 0.5*(P0+P2)).
   * If `isWaypoint` is false or omitted, it is used directly as the quadratic Bézier control point P1.
   * Note: For multiple waypoints, prefer using `waypoints: Vector3D[]`.
   */
  controlPoint?: Vector3D | undefined;
  /**
   * Whether `controlPoint` represents an exact geometric waypoint the camera must pass through
   * at t = 0.5 rather than an off-curve Bézier attractor point.
   */
  isWaypoint?: boolean | undefined;
  /** Callback fired when the flight reaches its destination. */
  onComplete?: (() => void) | undefined;
  /** Callback fired if the flight is cancelled or interrupted before reaching its destination. */
  onCancel?: (() => void) | undefined;
}

/**
 * Smooth cinematic fly-through behavior for cameras.
 * Supports quadratic Bézier flight, exact single-waypoint pass-through via inverse Bézier,
 * and multi-waypoint tours via Catmull-Rom splines while smoothly rotating look-at orientation.
 */
export class CameraFlyToBehavior extends Behavior<CameraInterfaceData> {
  private _isFlying: boolean = false;
  private _elapsed: number = 0;
  private _duration: number = 1.5;
  private _easing: (t: number) => number = Easing.easeInOutCubic;

  private _useSpline: boolean = false;
  private readonly _spline: CatmullRomSpline = new CatmullRomSpline([]);
  private readonly _splinePoints: Vector3D[] = [];

  private readonly _startPos: Vector3D = new Vector3D();
  private readonly _endPos: Vector3D = new Vector3D();
  private readonly _controlPos: Vector3D = new Vector3D();
  private readonly _startTarget: Vector3D = new Vector3D();
  private readonly _endTarget: Vector3D = new Vector3D();

  private _onComplete: (() => void) | undefined = undefined;
  private _onCancel: (() => void) | undefined = undefined;
  private _activeResolve: ((completed: boolean) => void) | undefined = undefined;

  /**
   * Whether a fly-through transition is currently active.
   */
  public get isFlying(): boolean {
    return this._isFlying;
  }

  /**
   * Initiates a smooth cinematic flight transition.
   * If a flight is already in progress, it is smoothly retargeted from the current camera state.
   * @param options Target position, look-at target, and curve/waypoint settings.
   * @returns Promise resolving to `true` if destination was reached, or `false` if cancelled/interrupted.
   */
  public flyTo(options: CameraFlyToOptions): Promise<boolean> {
    const cam = this.target;
    if (!cam) {
      return Promise.resolve(false);
    }

    // Cancel any ongoing transition
    if (this._isFlying) {
      const prevResolve = this._activeResolve;
      const prevCancel = this._onCancel;
      this._activeResolve = undefined;
      this._onCancel = undefined;
      this._onComplete = undefined;
      prevCancel?.();
      prevResolve?.(false);
    }

    this._startPos.copyFrom(cam.position);
    this._startTarget.copyFrom(cam.target);
    this._endPos.copyFrom(options.position);
    this._endTarget.copyFrom(options.target);

    this._easing = options.easing ?? Easing.easeInOutCubic;
    this._onComplete = options.onComplete;
    this._onCancel = options.onCancel;
    this._elapsed = 0;

    const wpList = options.waypoints ?? [];

    if (wpList.length >= 2) {
      // Multi-waypoint Catmull-Rom spline trajectory
      this._useSpline = true;
      this._splinePoints.length = 0;
      this._splinePoints.push(this._startPos);
      for (let i = 0; i < wpList.length; i++) {
        this._splinePoints.push(wpList[i]!);
      }
      this._splinePoints.push(this._endPos);
      this._spline.points = this._splinePoints;

      let totalDist = 0;
      for (let i = 0; i < this._splinePoints.length - 1; i++) {
        totalDist += this._splinePoints[i]!.distanceTo(this._splinePoints[i + 1]!);
      }
      this._duration = options.duration ?? Math.min(4.5, Math.max(1.2, totalDist * 0.045 + 0.75));
    } else {
      // 0 or 1 waypoint: Quadratic Bézier (with exact inverse Bézier solving for 1 waypoint)
      this._useSpline = false;
      const singleWaypoint = 1 === wpList.length ? wpList[0] : options.controlPoint;
      const isWp = 1 === wpList.length || (options.isWaypoint ?? false);

      const dist = this._startPos.distanceTo(this._endPos);
      this._duration = options.duration ?? Math.min(2.4, Math.max(1.0, dist * 0.042 + 0.75));

      if (singleWaypoint) {
        if (isWp) {
          // Inverse quadratic Bézier: B(0.5) = 0.25*P0 + 0.5*P1 + 0.25*P2 = W  ==>  P1 = 2*W - 0.5*(P0 + P2)
          this._controlPos.set(
            2.0 * singleWaypoint.x - 0.5 * (this._startPos.x + this._endPos.x),
            2.0 * singleWaypoint.y - 0.5 * (this._startPos.y + this._endPos.y),
            2.0 * singleWaypoint.z - 0.5 * (this._startPos.z + this._endPos.z),
          );
        } else {
          this._controlPos.copyFrom(singleWaypoint);
        }
      } else {
        // Natural crane/arched flight: subtle lift above the midpoint
        const lift = Math.min(1.5, Math.max(0.2, dist * 0.04));
        this._controlPos.set(
          (this._startPos.x + this._endPos.x) * 0.5,
          Math.max(this._startPos.y, this._endPos.y) + lift,
          (this._startPos.z + this._endPos.z) * 0.5,
        );
      }
    }

    this._isFlying = true;

    return new Promise<boolean>((resolve) => {
      this._activeResolve = resolve;
    });
  }

  /**
   * Cancels any active camera flight immediately.
   */
  public cancel(): void {
    if (!this._isFlying) return;
    this._isFlying = false;

    const prevResolve = this._activeResolve;
    const prevCancel = this._onCancel;
    this._activeResolve = undefined;
    this._onCancel = undefined;
    this._onComplete = undefined;

    prevCancel?.();
    prevResolve?.(false);
  }

  /** @inheritdoc */
  public override update(deltaTime: number): void {
    if (!this._isFlying || !this.target) return;

    this._elapsed += deltaTime;
    const tNorm = Math.min(1.0, this._elapsed / Math.max(0.0001, this._duration));
    const ease = this._easing(tNorm);
    const cam = this.target;

    if (this._useSpline) {
      // Evaluate Catmull-Rom spline at normalized parameter [0, 1]
      this._spline.getPoint(ease, cam.position);
    } else {
      // Quadratic Bézier: B(t) = (1-t)^2 * P0 + 2*(1-t)*t * P1 + t^2 * P2
      const inv = 1.0 - ease;
      const b0 = inv * inv;
      const b1 = 2.0 * inv * ease;
      const b2 = ease * ease;

      cam.position.set(
        b0 * this._startPos.x + b1 * this._controlPos.x + b2 * this._endPos.x,
        b0 * this._startPos.y + b1 * this._controlPos.y + b2 * this._endPos.y,
        b0 * this._startPos.z + b1 * this._controlPos.z + b2 * this._endPos.z,
      );
    }

    // Eased linear interpolation for camera look-at target
    cam.target.set(
      this._startTarget.x + (this._endTarget.x - this._startTarget.x) * ease,
      this._startTarget.y + (this._endTarget.y - this._startTarget.y) * ease,
      this._startTarget.z + (this._endTarget.z - this._startTarget.z) * ease,
    );

    // Synchronize spherical angles theta and phi
    const dirX = cam.target.x - cam.position.x;
    const dirY = cam.target.y - cam.position.y;
    const dirZ = cam.target.z - cam.position.z;
    const len = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
    if (len > 1e-4) {
      const ny = dirY / len;
      cam.phi = Math.asin(Math.max(-0.9999, Math.min(0.9999, ny)));
      cam.theta = Math.atan2(dirX, -dirZ);
    }

    cam.updateViewMatrix();

    if (tNorm >= 1.0) {
      this._isFlying = false;
      cam.position.copyFrom(this._endPos);
      cam.target.copyFrom(this._endTarget);
      cam.updateViewMatrix();

      const resolve = this._activeResolve;
      const complete = this._onComplete;
      this._activeResolve = undefined;
      this._onCancel = undefined;
      this._onComplete = undefined;

      complete?.();
      resolve?.(true);
    }
  }

  /** @inheritdoc */
  public override clone(): CameraFlyToBehavior {
    const copy = super.clone() as CameraFlyToBehavior;
    copy._isFlying = false;
    copy._elapsed = 0;
    return copy;
  }
}
