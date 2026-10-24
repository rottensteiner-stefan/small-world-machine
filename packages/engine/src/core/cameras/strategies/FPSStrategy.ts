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
  /** @inheritdoc */
  public constraints?: CameraConstraints;

  /** @inheritdoc */
  public update(camera: CameraInterfaceData, _targetPos: Vector3D, dx: number, dy: number): void {
    // FPS position is exclusively owned by the controller (FPSController, FlyController,
    // voxel player). The engine calls camera.update(camera.target) each frame; copying
    // `targetPos` into `camera.position` (keyed on an object-identity sentinel) used to
    // teleport the camera whenever a distinct, value-equal vector was passed. This strategy
    // only turns the mouse deltas into orientation and derives the look target below.
    if (0 !== dx || 0 !== dy) {
      camera.theta += dx * 0.005;
      camera.phi += dy * 0.005;
      const limit: number = MathUtils.HALF_PI - 0.01;
      if (limit < camera.phi) camera.phi = limit;
      if (-limit > camera.phi) camera.phi = -limit;
    }

    clampVector(camera.position, this.constraints);

    camera.target.x = camera.position.x + Math.sin(camera.theta) * Math.cos(camera.phi);
    camera.target.y = camera.position.y + Math.sin(camera.phi);
    camera.target.z = camera.position.z - Math.cos(camera.theta) * Math.cos(camera.phi);
  }
}
