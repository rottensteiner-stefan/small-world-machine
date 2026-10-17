import type {
  CameraConstraints,
  CameraStrategy,
  CameraInterfaceData,
} from "../../../interfaces/index.js";
import type { Vector3D } from "../../../math/index.js";
import { MathPool } from "../../../math/index.js";
import { CameraStrategyType } from "../../../enums/index.js";
import { OrthographicProjection } from "../../../math/projections/index.js";
/**
 * Strategy for an isometric 2D/3D camera.
 * Uses an orthographic projection and fixed angles.
 */
export class IsometricStrategy implements CameraStrategy {
  public readonly type: string = CameraStrategyType.ISOMETRIC;

  public pixelPerfect: boolean = false;
  public zoomFactor: number = 50;
  public constraints?: CameraConstraints;

  /**
   * Updates the camera position and target.
   */
  public update(camera: CameraInterfaceData, targetPos: Vector3D, _dx: number, _dy: number): void {
    if (!(camera.projection instanceof OrthographicProjection)) {
      return;
    }

    const constrainedTarget = MathPool.acquireVector().copyFrom(targetPos);
    if (this.constraints) {
      if (this.constraints.min) {
        constrainedTarget.x = Math.max(constrainedTarget.x, this.constraints.min.x);
        constrainedTarget.y = Math.max(constrainedTarget.y, this.constraints.min.y);
        constrainedTarget.z = Math.max(constrainedTarget.z, this.constraints.min.z);
      }
      if (this.constraints.max) {
        constrainedTarget.x = Math.min(constrainedTarget.x, this.constraints.max.x);
        constrainedTarget.y = Math.min(constrainedTarget.y, this.constraints.max.y);
        constrainedTarget.z = Math.min(constrainedTarget.z, this.constraints.max.z);
      }
    }

    // Classic Isometric Angles: 45° around Y, ~35.264° around X
    const angleY = Math.PI / 4;
    const angleX = Math.atan(Math.SQRT1_2);
    const distance = 100;

    let posX = constrainedTarget.x + distance * Math.sin(angleY) * Math.cos(angleX);
    let posY = constrainedTarget.y + distance * Math.sin(angleX);
    let posZ = constrainedTarget.z + distance * Math.cos(angleY) * Math.cos(angleX);

    if (this.pixelPerfect) {
      posX = Math.round(posX * this.zoomFactor) / this.zoomFactor;
      posY = Math.round(posY * this.zoomFactor) / this.zoomFactor;
      posZ = Math.round(posZ * this.zoomFactor) / this.zoomFactor;
    }

    camera.position.set(posX, posY, posZ);
    camera.target.copyFrom(constrainedTarget);

    MathPool.releaseVector(constrainedTarget);
  }
}
