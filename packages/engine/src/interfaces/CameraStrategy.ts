import type { CameraConstraints } from "./CameraConstraints.js";
import type { CameraInterfaceData } from "./CameraInterfaceData.js";
import type { Vector3D } from "../math/index.js";

/**
 * Interface for camera control strategies (e.g. FPS, Orbit, Smooth).
 */
export interface CameraStrategy {
  /** The unique type identifier of the strategy. */
  readonly type: string;
  /** Optional spatial constraints for the camera. */
  constraints?: CameraConstraints | undefined;

  /**
   * Updates the camera position and target based on the strategy's logic.
   * @param camera The camera to update.
   * @param targetPos The target position to follow.
   * @param dx The horizontal rotation delta.
   * @param dy The vertical rotation delta.
   */
  update(camera: CameraInterfaceData, targetPos: Vector3D, dx: number, dy: number): void;

  /**
   * Optional method to handle zooming within the strategy.
   * @param camera The camera to update.
   * @param delta The zoom delta.
   * @returns True if the strategy handled the zoom, false otherwise.
   */
  zoom?(camera: CameraInterfaceData, delta: number): boolean;
}
