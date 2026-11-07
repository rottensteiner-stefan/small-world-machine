import { Behavior } from "../behaviors/index.js";
import type { Object3D, InputInterface } from "../index.js";
import { InputMode, Keys } from "../../enums/index.js";
import { MathPool } from "../../math/index.js";

/**
 * Configuration for the WASDController.
 */
export interface WASDControllerOptions {
  /** The input source. Required for reading keys. */
  input?: InputInterface;
  /** Movement speed in units per second. Defaults to 10. */
  moveSpeed?: number;
  /** Input mode for A/D keys (STRAFE or TANK). Defaults to TANK. */
  inputMode?: InputMode;
  /** Whether vertical movement (Q/E) is enabled. Defaults to false. */
  enableVertical?: boolean;
}

/**
 * A controller that moves an Object3D using WASD keys.
 * Movement is relative to the object's rotation (local forward).
 */
export class WASDController extends Behavior {
  public enabled: boolean = true;
  private _options: Required<WASDControllerOptions>;

  /**
   * Creates a new WASDController.
   * @param options Configuration options.
   */
  constructor(options: WASDControllerOptions) {
    super();
    if (!options.input) throw new Error("WASDController requires an 'input' option.");
    this._options = {
      input: options.input,
      moveSpeed: options.moveSpeed ?? 10.0,
      inputMode: options.inputMode ?? InputMode.DEFAULT,
      enableVertical: options.enableVertical ?? false,
    };
  }

  public override update(deltaTime: number): void {
    if (!this.enabled || !this.target) {
      return;
    }

    const moveZ = this._options.input.getAxis(Keys.W, Keys.S);
    const horizontalAxis = this._options.input.getAxis(Keys.A, Keys.D);

    // Handle Rotation (A/D in TANK mode)
    const obj = this.target as Object3D;
    if (InputMode.TANK === this._options.inputMode && 0 !== horizontalAxis) {
      obj.rotation.y -= horizontalAxis * 2.0 * deltaTime;
    }

    if (0 !== moveZ || (0 !== horizontalAxis && InputMode.STRAFE === this._options.inputMode)) {
      // Calculate world-space direction based on object's rotation
      const forward = MathPool.acquireVector().set(0, 0, -1);
      forward.transformDirection(obj.worldMatrix).normalize();

      const direction = MathPool.acquireVector().set(0, 0, 0);

      // W/S movement
      if (0 !== moveZ) {
        direction.add(forward.scale(-moveZ));
      }

      // A/D strafe movement
      if (InputMode.STRAFE === this._options.inputMode && 0 !== horizontalAxis) {
        const right = MathPool.acquireVector().set(1, 0, 0);
        right.transformDirection(obj.worldMatrix).normalize();
        direction.add(right.scale(horizontalAxis));
        MathPool.releaseVector(right);
      }

      if (direction.lengthSq() > 0) {
        direction.normalize();
        obj.position.add(direction.scale(this._options.moveSpeed * deltaTime));
      }

      MathPool.releaseVector(forward);
      MathPool.releaseVector(direction);
    }

    if (this._options.enableVertical) {
      const moveY = this._options.input.getAxis(Keys.Q, Keys.E);
      if (0 !== moveY) {
        obj.position.y += moveY * this._options.moveSpeed * deltaTime;
      }
    }
  }
}
