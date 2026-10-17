import { Behavior } from "./Behavior.js";
import { Object3D } from "../Object3D.js";
import { Vector3D } from "../../math/index.js";

/**
 * Continuously rotates the attached object along specified axes.
 */
export class RotatorBehavior extends Behavior {
  public speed: Vector3D;

  /**
   * @param speed The rotation speed per axis in radians per second. Defaults to Y-axis rotation (0, 1, 0).
   */
  constructor(speed: Vector3D = new Vector3D(0, 1, 0)) {
    super();
    this.speed = speed;
  }

  public override update(deltaTime: number): void {
    if (this.target && this.target instanceof Object3D) {
      this.target.rotation.x += this.speed.x * deltaTime;
      this.target.rotation.y += this.speed.y * deltaTime;
      this.target.rotation.z += this.speed.z * deltaTime;
    }
  }
}
