import { CameraStrategyType } from "../../enums/index.js";
import {
  FixedStrategy,
  ManualStrategy,
  HybridSyncStrategy,
  FPSStrategy,
  SmoothStrategy,
  StiffStrategy,
  IsometricStrategy,
} from "./strategies/index.js";
import type { CameraStrategy } from "../../interfaces/index.js";

export class CameraStrategyFactory {
  /**
   * Creates a fresh camera strategy instance of the specified type.
   * @param type The type of camera strategy to create.
   * @returns A new independent camera strategy instance.
   */
  public static get(type: CameraStrategyType): CameraStrategy {
    switch (type) {
      case CameraStrategyType.MANUAL:
        return new ManualStrategy();
      case CameraStrategyType.HYBRID_SYNC:
        return new HybridSyncStrategy();
      case CameraStrategyType.FPS:
        return new FPSStrategy();
      case CameraStrategyType.SMOOTH:
        return new SmoothStrategy();
      case CameraStrategyType.STIFF:
        return new StiffStrategy();
      case CameraStrategyType.FIXED:
        return new FixedStrategy();
      case CameraStrategyType.ISOMETRIC:
        return new IsometricStrategy();
      default:
        throw new Error(`Unknown camera strategy type: ${type as string}`);
    }
  }
}
