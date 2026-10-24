import type {
  CameraInterfaceData,
  CameraConstraints,
  CameraStrategy,
} from "../../../interfaces/index.js";
import { CameraStrategyType } from "../../../enums/index.js";
import type { Vector3D } from "../../../math/index.js";
import { MathUtils } from "../../../math/index.js";
import { clampVector } from "./CameraStrategyUtils.js";
/**
 * A camera strategy that rigidly follows a target.
 */
export class StiffStrategy implements CameraStrategy {
  /** @inheritdoc */
  public readonly type: string = CameraStrategyType.STIFF;
  /** The radius of the camera from the target. */
  public radius: number = 20;
  /** Minimum allowed radius. */
  public minRadius: number = 2;
  /** Maximum allowed radius. */
  public maxRadius: number = 500;
  /** @inheritdoc */
  public constraints?: CameraConstraints;

  private _isInitialized: boolean = false;

  /** @inheritdoc */
  public update(camera: CameraInterfaceData, targetPos: Vector3D, dx: number, dy: number): void {
    if (!this._isInitialized) {
      const relX = camera.position.x - targetPos.x;
      const relY = camera.position.y - targetPos.y;
      const relZ = camera.position.z - targetPos.z;
      const trueLen: number = Math.sqrt(relX * relX + relY * relY + relZ * relZ);
      this.radius = Math.max(this.minRadius, Math.min(this.maxRadius, trueLen));
      if (trueLen > 0.0001) {
        // Exact inverse of position = target + radius * (sinθ·cosφ, sinφ, cosθ·cosφ).
        // Angles MUST be derived from the TRUE relative length (not the clamped radius),
        // otherwise the horizontal components are skewed for non-horizontal views and the
        // D3 explicit-transition direction is corrupted.
        const sinPhi: number = relY / trueLen;
        camera.phi = Math.asin(Math.min(1, Math.max(-1, sinPhi)));
        const cosPhi: number = Math.sqrt(Math.max(0, 1 - sinPhi * sinPhi));
        if (cosPhi > 1e-9) {
          camera.theta = Math.atan2(relX / cosPhi, relZ / cosPhi);
        } else {
          camera.theta = 0;
        }
      }
      this._isInitialized = true;
    }

    if (0 !== dx || 0 !== dy) {
      camera.theta -= dx * 0.005;
      camera.phi += dy * 0.005;
      const limit: number = MathUtils.HALF_PI - 0.01;
      if (limit < camera.phi) camera.phi = limit;
      if (-limit > camera.phi) camera.phi = -limit;
    }

    camera.target.copyFrom(targetPos);

    clampVector(camera.target, this.constraints);

    camera.position.x =
      camera.target.x + this.radius * Math.sin(camera.theta) * Math.cos(camera.phi);
    camera.position.y = camera.target.y + this.radius * Math.sin(camera.phi);
    camera.position.z =
      camera.target.z + this.radius * Math.cos(camera.theta) * Math.cos(camera.phi);
  }

  /** @inheritdoc */
  public zoom(_camera: CameraInterfaceData, delta: number): boolean {
    this.radius += delta * this.radius;
    this.radius = MathUtils.clamp(this.radius, this.minRadius, this.maxRadius);
    return true;
  }
}
