import type { CameraInterfaceData, Input } from "@small-world-machine/engine";
import { Vector3D } from "@small-world-machine/engine";

export interface OrbitCameraOptions {
  target?: Vector3D;
  distance?: number;
  yaw?: number;
  pitch?: number;
  minDistance?: number;
  maxDistance?: number;
  minPitch?: number;
  maxPitch?: number;
}

/** A snapshot of the orbit camera's view, independent of any live `Vector3D` reference --
 * see `getView()`/`setView()`, used by Maker's camera bookmarks. */
export interface OrbitCameraView {
  target: Vector3D;
  distance: number;
  yaw: number;
  pitch: number;
}

/**
 * Right-drag-to-orbit, wheel-to-zoom edit-mode camera controller for Maker's viewport. Pair
 * with `camera.setStrategy(CameraStrategyType.MANUAL)` so the engine's own strategy system
 * performs no automatic updates of its own -- this controller drives `camera.position`/
 * `camera.target` directly, once per frame. Left-click stays free for object picking.
 */
export class OrbitCameraController {
  public readonly target: Vector3D;
  private _distance: number;
  private _yaw: number;
  private _pitch: number;
  private readonly _minDistance: number;
  private readonly _maxDistance: number;
  private readonly _minPitch: number;
  private readonly _maxPitch: number;

  constructor(options: OrbitCameraOptions = {}) {
    this.target = options.target ?? new Vector3D(0, 0, 0);
    this._distance = options.distance ?? 10;
    this._yaw = options.yaw ?? 0.6;
    this._pitch = options.pitch ?? 0.5;
    this._minDistance = options.minDistance ?? 1;
    this._maxDistance = options.maxDistance ?? 200;
    this._minPitch = options.minPitch ?? -1.5;
    this._maxPitch = options.maxPitch ?? 1.5;
  }

  /** Rotates the camera around its target by delta pixels/units. */
  public rotate(dx: number, dy: number): void {
    this._yaw -= dx * 0.005;
    this._pitch = Math.min(this._maxPitch, Math.max(this._minPitch, this._pitch - dy * 0.005));
  }

  /** Zooms the camera closer or further from its target. */
  public zoom(delta: number): void {
    this._distance = Math.min(
      this._maxDistance,
      Math.max(this._minDistance, this._distance + delta * 0.01 * this._distance),
    );
  }

  /** Reads this frame's accumulated mouse delta/wheel from `input` and writes the resulting
   * orbit position into `camera`. Call once per frame, before the engine renders. Safe to call
   * every frame regardless of whether the right button is held -- it's a no-op drag-wise then,
   * only the (harmless) position/target write still happens. */
  public update(camera: CameraInterfaceData, input: Input): void {
    if (input.mouse.right) {
      this.rotate(input.mouse.dx, input.mouse.dy);
    }
    if (0 !== input.mouse.wheelY) {
      this.zoom(input.mouse.wheelY);
    }

    const cosPitch = Math.cos(this._pitch);
    camera.position.x = this.target.x + this._distance * cosPitch * Math.sin(this._yaw);
    camera.position.y = this.target.y + this._distance * Math.sin(this._pitch);
    camera.position.z = this.target.z + this._distance * cosPitch * Math.cos(this._yaw);
    camera.target.copyFrom(this.target);
  }

  /** Snapshots the current view -- an independent `target` clone, so later mutating `this.target`
   * (e.g. via `setView()`) can't retroactively change a previously saved snapshot. */
  public getView(): OrbitCameraView {
    return {
      target: this.target.clone(),
      distance: this._distance,
      yaw: this._yaw,
      pitch: this._pitch,
    };
  }

  /** Restores a previously saved view. Takes effect on the next `update()` call. */
  public setView(view: OrbitCameraView): void {
    this.target.copyFrom(view.target);
    this._distance = view.distance;
    this._yaw = view.yaw;
    this._pitch = view.pitch;
  }
}
