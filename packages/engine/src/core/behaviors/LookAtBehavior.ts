import { Behavior } from "./Behavior.js";
import { Object3D } from "../Object3D.js";
import { Vector3D } from "../../math/index.js";

/**
 * Constantly rotates the object to face a target position or another object.
 * Perfect for surveillance cameras, NPC tracking, or simple 2D billboards.
 */
export class LookAtBehavior extends Behavior {
  public targetPoint: Vector3D | Object3D;

  constructor(targetPoint: Vector3D | Object3D) {
    super();
    this.targetPoint = targetPoint;
  }

  public override update(_deltaTime: number): void {
    if (this.target && this.target instanceof Object3D) {
      const targetPos =
        this.targetPoint instanceof Object3D ? this.targetPoint.position : this.targetPoint;

      this.target.lookAt(targetPos);

      // If the object is a Light, its primary aiming mechanism is the .direction vector.
      if ("direction" in this.target && this.target.direction instanceof Vector3D) {
        const dx = targetPos.x - this.target.position.x;
        const dy = targetPos.y - this.target.position.y;
        const dz = targetPos.z - this.target.position.z;
        this.target.direction.set(dx, dy, dz).normalize();
      }
    }
  }
}
