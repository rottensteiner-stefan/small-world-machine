import { Behavior } from "./Behavior.js";
import { Object3D } from "../Object3D.js";
import type { CameraInterfaceData } from "../../interfaces/index.js";
import { Vector3D } from "../../math/index.js";

/**
 * Configuration options for the ProximitySensorBehavior.
 */
export interface ProximitySensorOptions {
  /** The target object to measure distance to. Can be an Object3D or a Camera (CameraInterfaceData). */
  targetObj: Object3D | CameraInterfaceData;
  /** The outer distance at which the factor starts rising above 0.0. */
  radius: number;
  /** The inner distance at which the factor reaches 1.0. Defaults to 0.0. */
  minDistance?: number;
  /** Ignore the Y axis when measuring distance (e.g. floor hazards, pickups at a fixed player height). Defaults to false. */
  planar?: boolean;
  /** Callback executed every frame with the normalized proximity factor (0.0 to 1.0). */
  onUpdate: (factor: number, distance: number, deltaTime: number) => void;
}

/**
 * A behavior that acts as a proximity sensor.
 * It measures the distance between the object it is attached to and a target object,
 * and calls the `onUpdate` callback with a normalized factor between 0.0 (far away) and 1.0 (close).
 */
export class ProximitySensorBehavior extends Behavior {
  public options: Required<ProximitySensorOptions>;

  private _myPosition: Vector3D = new Vector3D();
  private _targetPosition: Vector3D = new Vector3D();

  /**
   * Creates a new ProximitySensorBehavior.
   * @param options Configuration options.
   */
  constructor(options: ProximitySensorOptions) {
    super();
    this.options = {
      targetObj: options.targetObj,
      radius: options.radius,
      minDistance: Math.max(0, options.minDistance ?? 0.0),
      planar: options.planar ?? false,
      onUpdate: options.onUpdate,
    };
  }

  /**
   * Helper to safely extract the world position of an Object3D or Camera.
   */
  private _getWorldPosition(obj: Object3D | CameraInterfaceData, out: Vector3D): void {
    if (obj instanceof Object3D) {
      obj.getWorldPosition(out);
    } else {
      out.copyFrom(obj.position);
    }
  }

  public override update(deltaTime: number): void {
    if (!this.target || !this.options.targetObj) return;

    // Get the world position of the object this behavior is attached to
    this._getWorldPosition(this.target as Object3D | CameraInterfaceData, this._myPosition);

    // Get the world position of the target we are sensing
    this._getWorldPosition(this.options.targetObj, this._targetPosition);

    // Calculate distance
    const distance = this.options.planar
      ? Math.hypot(
          this._myPosition.x - this._targetPosition.x,
          this._myPosition.z - this._targetPosition.z,
        )
      : this._myPosition.distanceTo(this._targetPosition);

    let factor: number;

    // Calculate normalized factor based on distance
    if (distance <= this.options.minDistance) {
      factor = 1.0;
    } else if (distance >= this.options.radius) {
      factor = 0.0;
    } else {
      // Map distance between minDistance and radius to 1.0 -> 0.0
      const range = this.options.radius - this.options.minDistance;
      const current = distance - this.options.minDistance;
      factor = 1.0 - current / range;
    }

    // Pass the calculated values back to the user
    this.options.onUpdate(factor, distance, deltaTime);
  }
}
