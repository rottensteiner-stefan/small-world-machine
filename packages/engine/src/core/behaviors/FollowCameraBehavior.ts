import { Behavior } from "./Behavior.js";
import { Object3D } from "../Object3D.js";
import type { Vector3D } from "../../math/Vector3D.js";
import type { CameraInterfaceData } from "../../interfaces/CameraInterfaceData.js";

export interface FollowCameraAxes {
  x?: boolean;
  y?: boolean;
  z?: boolean;
}

export interface FollowCameraBehaviorOptions {
  /** The camera to follow. */
  camera: CameraInterfaceData;
  /** Constrains which axes follow the camera. Defaults to { x: true, y: true, z: true }. */
  axes?: FollowCameraAxes;
  /** Optional static 3D offset relative to the camera position. */
  offset?: Vector3D;
  /** Optional lerp damping speed (0 = instant snap, > 0 = smooth lag). Defaults to 0 (instant). */
  damping?: number;
}

/**
 * Automatically locks or smooth-follows an Object3D's position to a camera.
 * Perfect for Skydomes, background celestial spheres, weather volumes, HUD elements,
 * or camera-attached light rigs.
 */
export class FollowCameraBehavior extends Behavior {
  public camera: CameraInterfaceData;
  public axes: FollowCameraAxes;
  public offset: Vector3D | undefined;
  public damping: number;

  constructor(options: FollowCameraBehaviorOptions) {
    super();
    this.camera = options.camera;
    this.axes = {
      x: options.axes?.x ?? true,
      y: options.axes?.y ?? true,
      z: options.axes?.z ?? true,
    };
    this.offset = options.offset;
    this.damping = options.damping ?? 0;
  }

  public override update(deltaTime: number): void {
    if (this.target && this.target instanceof Object3D) {
      const camPos = this.camera.position;
      const targetPos = this.target.position;

      const targetX = (this.axes.x ? camPos.x : targetPos.x) + (this.offset?.x ?? 0);
      const targetY = (this.axes.y ? camPos.y : targetPos.y) + (this.offset?.y ?? 0);
      const targetZ = (this.axes.z ? camPos.z : targetPos.z) + (this.offset?.z ?? 0);

      if (this.damping <= 0) {
        if (this.axes.x) targetPos.x = targetX;
        if (this.axes.y) targetPos.y = targetY;
        if (this.axes.z) targetPos.z = targetZ;
      } else {
        const factor = Math.min(1.0, this.damping * deltaTime);
        if (this.axes.x) targetPos.x += (targetX - targetPos.x) * factor;
        if (this.axes.y) targetPos.y += (targetY - targetPos.y) * factor;
        if (this.axes.z) targetPos.z += (targetZ - targetPos.z) * factor;
      }
    }
  }
}
