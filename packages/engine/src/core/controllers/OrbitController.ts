import { Behavior } from "../behaviors/index.js";
import type { CameraInterfaceData } from "../../interfaces/index.js";
import type { InputInterface } from "../index.js";

/**
 * Configuration for the OrbitController.
 */
export interface OrbitControllerOptions {
  /** The input source. Required for reading mouse/pointer lock state. */
  input?: InputInterface;
  /** Look sensitivity. Defaults to 0.005. */
  lookSensitivity?: number;
  /** Rotation speed for keyboard. Defaults to 2.0. */
  rotationSpeed?: number;
  /** Whether rotation (Mouse) is enabled. Defaults to true. */
  enableRotation?: boolean;
}

/**
 * A controller that orbits a camera around a fixed target.
 */
export class OrbitController extends Behavior<CameraInterfaceData> {
  public enabled: boolean = true;
  private _options: Required<OrbitControllerOptions>;

  /**
   * Creates a new OrbitController.
   * @param options Configuration options.
   */
  constructor(options: OrbitControllerOptions) {
    super();
    if (!options.input) throw new Error("OrbitController requires an 'input' option.");
    this._options = {
      input: options.input,
      lookSensitivity: options.lookSensitivity ?? 0.005,
      rotationSpeed: options.rotationSpeed ?? 2.0,
      enableRotation: options.enableRotation ?? true,
    };
  }

  public override update(_deltaTime: number): void {
    if (!this.enabled || !this.target) {
      return;
    }

    const cam = this.target;

    // 1. Handle Rotation
    if (this._options.enableRotation) {
      if (this._options.input.isPointerLocked || this._options.input.mouse.left) {
        cam.pendingDx += this._options.input.mouse.dx;
        cam.pendingDy += this._options.input.mouse.dy;
      }
    }

    // 2. Handle Zoom (Mouse Wheel / Touchpad Pinch)
    if (this._options.input.mouse.zoom !== 0) {
      // Delegate zooming to the camera's strategy instead of hardcoding position updates
      // The strategy maintains its own 'radius' state which would otherwise overwrite this.
      cam.zoom(this._options.input.mouse.zoom * 0.1);
    }
  }
}
