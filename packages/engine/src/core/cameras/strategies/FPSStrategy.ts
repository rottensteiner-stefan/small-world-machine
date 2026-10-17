import type {
  CameraConstraints,
  CameraStrategy,
  CameraInterfaceData,
} from "../../../interfaces/index.js";
import { CameraStrategyType } from "../../../enums/index.js";
import type { Vector3D } from "../../../math/index.js";
import { MathUtils } from "../../../math/index.js";
import { clampVector } from "./CameraStrategyUtils.js";
/**
 * A first-person camera strategy.
 */
export class FPSStrategy implements CameraStrategy {
  /** @inheritdoc */
  public readonly type: string = CameraStrategyType.FPS;
  /** The height offset from the target position. */
  public heightOffset: number = 0.0;
  /** @inheritdoc */
  public constraints?: CameraConstraints;

  /** @inheritdoc */
  public update(camera: CameraInterfaceData, targetPos: Vector3D, dx: number, dy: number): void {
    if (0 !== dx || 0 !== dy) {
      camera.theta += dx * 0.005;
      camera.phi += dy * 0.005;
      const limit: number = MathUtils.HALF_PI - 0.01;
      if (limit < camera.phi) camera.phi = limit;
      if (-limit > camera.phi) camera.phi = -limit;
    }

    // IMPORTANT FIX: In FPS mode, the user directly manipulates the camera's position (or we copy a targetPos into it).
    // However, Application.ts unconditionally calls camera.update(camera.target), which in FPS mode
    // would mean the camera treats its own look-at point as its feet and constantly flies forward.
    // To prevent this, FPSStrategy should ONLY update the position if the provided targetPos is NOT the camera's own target.
    if (targetPos !== camera.target) {
      camera.position.x = targetPos.x;
      camera.position.y = targetPos.y + this.heightOffset;
      camera.position.z = targetPos.z;
    }

    clampVector(camera.position, this.constraints);

    camera.target.x = camera.position.x + Math.sin(camera.theta) * Math.cos(camera.phi);
    camera.target.y = camera.position.y + Math.sin(camera.phi);
    camera.target.z = camera.position.z - Math.cos(camera.theta) * Math.cos(camera.phi);
  }
}
