import type {
  CameraInterfaceData,
  CameraConstraints,
  CameraStrategy,
} from "../../../interfaces/index.js";
import { CameraStrategyType } from "../../../enums/index.js";
import type { Vector3D } from "../../../math/index.js";
/**
 * A camera strategy where the developer has full manual control.
 * The engine performs no automatic position or target updates.
 */
export class ManualStrategy implements CameraStrategy {
  /** @inheritdoc */
  public readonly type: string = CameraStrategyType.MANUAL;
  /** @inheritdoc */
  public constraints?: CameraConstraints;

  /** @inheritdoc */
  public update(
    _camera: CameraInterfaceData,
    _targetPos: Vector3D,
    _dx: number,
    _dy: number,
  ): void {
    // Does nothing - Authority is with the developer
  }
}
