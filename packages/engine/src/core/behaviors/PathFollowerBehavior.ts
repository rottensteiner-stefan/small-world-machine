import { Behavior } from "./Behavior.js";
import { Object3D } from "../Object3D.js";
import type { Curve3D } from "../../math/index.js";
import { Vector3D } from "../../math/index.js";

/**
 * Moves an object along a 3D curve (e.g., CatmullRomSpline) over time.
 * Optionally orients the object to face the direction of travel.
 */
export class PathFollowerBehavior extends Behavior {
  public curve: Curve3D;
  public duration: number; // Duration to complete one full pass in seconds
  public lookForward: boolean;
  public pingPong: boolean;

  private _time: number = 0;
  private _direction: number = 1;
  private _scratchTangent: Vector3D = new Vector3D();

  /**
   * @param curve The mathematical path to follow.
   * @param duration Time in seconds to complete the path.
   * @param lookForward If true, aligns the object's rotation with the path's tangent (forward direction).
   * @param pingPong If true, the object reverses direction at the ends of the path. Otherwise it loops back to 0.
   */
  constructor(
    curve: Curve3D,
    duration: number = 5.0,
    lookForward: boolean = true,
    pingPong: boolean = false,
  ) {
    super();
    this.curve = curve;
    this.duration = duration;
    this.lookForward = lookForward;
    this.pingPong = pingPong;
  }

  public override update(deltaTime: number): void {
    if (!this.target || !(this.target instanceof Object3D)) return;

    this._time += (deltaTime / this.duration) * this._direction;

    if (this._time > 1.0) {
      if (this.pingPong) {
        this._time = 1.0 - (this._time - 1.0);
        this._direction = -1;
      } else {
        this._time = this._time % 1.0;
      }
    } else if (this._time < 0.0) {
      if (this.pingPong) {
        this._time = Math.abs(this._time);
        this._direction = 1;
      } else {
        this._time = 1.0 + (this._time % 1.0);
      }
    }

    // Update position
    this.curve.getPoint(this._time, this.target.position);

    // Update orientation (look forward)
    if (this.lookForward) {
      this.curve.getTangent(this._time, this._scratchTangent);

      // If moving backwards in pingPong, flip the tangent to look where we are going
      if (this._direction < 0) {
        this._scratchTangent.scale(-1);
      }

      const dx = this._scratchTangent.x;
      const dy = this._scratchTangent.y;
      const dz = this._scratchTangent.z;

      // Small World Machine uses Right-Handed coordinates with -Z forward.
      const yaw = Math.atan2(dx, -dz);
      const pitch = Math.atan2(-dy, Math.sqrt(dx * dx + dz * dz));

      this.target.rotation.set(pitch, yaw, 0);
    }
  }
}
