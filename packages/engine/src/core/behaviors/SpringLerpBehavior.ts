import { Behavior } from "./Behavior.js";
import { Object3D } from "../Object3D.js";
import type { Vector3D } from "../../math/index.js";

/**
 * Smoothly interpolates an object towards a target position, creating an inertia/spring-like effect.
 */
export class SpringLerpBehavior extends Behavior {
  public targetPosition: Vector3D;
  public lerpFactor: number;

  /**
   * @param targetPosition The position to move towards.
   * @param lerpFactor The interpolation factor (0.0 to 1.0). Default 0.1.
   */
  constructor(targetPosition: Vector3D, lerpFactor: number = 0.1) {
    super();
    this.targetPosition = targetPosition;
    this.lerpFactor = lerpFactor;
  }

  public override update(deltaTime: number): void {
    if (this.target && this.target instanceof Object3D) {
      // Adjust lerpFactor by deltaTime to be frame-rate independent
      const t = 1.0 - Math.pow(1.0 - this.lerpFactor, deltaTime * 60);

      this.target.position.x += (this.targetPosition.x - this.target.position.x) * t;
      this.target.position.y += (this.targetPosition.y - this.target.position.y) * t;
      this.target.position.z += (this.targetPosition.z - this.target.position.z) * t;
    }
  }
}
