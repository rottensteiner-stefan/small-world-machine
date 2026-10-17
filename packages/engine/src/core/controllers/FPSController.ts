import { Behavior } from "../behaviors/Behavior.js";
import { CameraInterfaceData, isCameraTarget } from "../../interfaces/index.js";
import { Object3D, InputInterface, Scene } from "../index.js";
import { InputMode, Keys } from "../../enums/index.js";
import { BoundingSphere } from "../../physix/index.js";
import { resolveSphereCollisions } from "../behaviors/CollisionResolution.js";
import { MathUtils } from "../../math/index.js";

/**
 * Configuration for the FPSController.
 */
export interface FPSControllerOptions {
  /** Movement speed in units per second. Defaults to 10. */
  moveSpeed?: number;
  /** Look sensitivity. Defaults to 0.005. */
  lookSensitivity?: number;
  /** Input mode for A/D keys (STRAFE or TANK). Defaults to TANK. */
  inputMode?: InputMode;
  /** Whether movement (WASD) is enabled. Defaults to true. */
  enableMovement?: boolean;
  /** Whether rotation (Mouse) is enabled. Defaults to true. */
  enableRotation?: boolean;
  /** Whether vertical movement (Q/E) is enabled. Defaults to true. */
  enableVertical?: boolean;
  /** Whether collisions are enabled. Requires a Scene reference. */
  enableCollision?: boolean;
  /** The radius of the collision sphere. Defaults to 0.5. */
  collisionRadius?: number;
  /** The scene to check for collisions. */
  scene?: Scene;
  /** Input source. Required — no global fallback. */
  input?: InputInterface;
}

/**
 * A controller for first-person style movement and looking.
 */
export class FPSController extends Behavior {
  public enabled: boolean = true;
  private _options: Required<Omit<FPSControllerOptions, "scene" | "input">> & {
    scene: Scene | undefined;
    input: InputInterface;
  };
  private _collider?: BoundingSphere;

  /**
   * Creates a new FPSController.
   * @param options The configuration options.
   */
  constructor(options: FPSControllerOptions = {}) {
    super();
    this._options = {
      moveSpeed: options.moveSpeed ?? 10.0,
      lookSensitivity: options.lookSensitivity ?? 0.005,
      inputMode: options.inputMode ?? InputMode.DEFAULT,
      enableMovement: options.enableMovement ?? true,
      enableRotation: options.enableRotation ?? true,
      enableVertical: options.enableVertical ?? true,
      enableCollision: options.enableCollision ?? !!options.scene,
      collisionRadius: options.collisionRadius ?? 0.5,
      scene: options.scene,
      input: options.input as InputInterface,
    };
    if (!this._options.input) {
      throw new Error("FPSController requires an 'input' option.");
    }
  }

  public override onAttach(target: import("../index.js").Object3D | CameraInterfaceData): void {
    super.onAttach(target);
    this._collider = new BoundingSphere(
      this.target!.position.clone(),
      this._options.collisionRadius,
    );
  }

  public override update(deltaTime: number): void {
    if (!this.enabled || !this.target) {
      return;
    }

    const input = this._options.input;
    const target = this.target;
    const isCamera = isCameraTarget(target);
    let dx = 0;
    let dy = 0;
    if (this._options.enableRotation && input.isPointerLocked) {
      dx = input.mouse.dx;
      dy = input.mouse.dy;
    }

    // 1. Horizontal Movement & Rotation
    if (this._options.enableMovement) {
      const moveZ = input.getAxis(Keys.W, Keys.S);
      const horizontalAxis = input.getAxis(Keys.A, Keys.D);

      if (InputMode.TANK === this._options.inputMode) {
        // Keyboard Rotation (A/D)
        if (0 !== horizontalAxis) {
          const rotationAmount = horizontalAxis * 2.0 * deltaTime; // 2 rad/s
          if (isCamera) {
            target.theta += rotationAmount;
          } else {
            (target as Object3D).rotation.y -= rotationAmount;
          }
        }
      }

      if (0 !== moveZ || (0 !== horizontalAxis && InputMode.STRAFE === this._options.inputMode)) {
        // If it's a camera, we use its current look direction (theta)
        const theta = isCamera ? target.theta : (target as Object3D).rotation.y;

        const sin = Math.sin(theta);
        const cos = Math.cos(theta);

        // Forward/Backward
        if (0 !== moveZ) {
          // moveZ is -1 for W (forward), +1 for S (backward)
          target.position.x += -moveZ * sin * this._options.moveSpeed * deltaTime;
          target.position.z += moveZ * cos * this._options.moveSpeed * deltaTime;
        }

        // Strafe
        if (0 !== horizontalAxis && InputMode.STRAFE === this._options.inputMode) {
          target.position.x += horizontalAxis * cos * this._options.moveSpeed * deltaTime;
          target.position.z += horizontalAxis * sin * this._options.moveSpeed * deltaTime;
        }
      }
    }

    // 2. Vertical Movement
    if (this._options.enableVertical) {
      const moveY = input.getAxis(Keys.Q, Keys.E);
      if (0 !== moveY) {
        target.position.y += moveY * this._options.moveSpeed * deltaTime;
      }
    }

    // 3. Resolve Collisions (BEFORE rotation application)
    if (this._options.enableCollision && this._options.scene) {
      resolveSphereCollisions(this._collider, target, this._options.scene);
    }

    // 4. Apply Rotation / View Update
    if (isCamera) {
      // Removed cam.update, rely on Camera's update logic
      if (this._options.enableRotation && input.isPointerLocked) {
        target.pendingDx += dx;
        target.pendingDy += dy;
      }
    } else {
      const obj = target as Object3D;
      if (this._options.enableRotation) {
        obj.rotation.y -= dx * this._options.lookSensitivity;
        obj.rotation.x += dy * this._options.lookSensitivity;
        const limit = 1.55;
        obj.rotation.x = MathUtils.clamp(obj.rotation.x, -limit, limit);
      }
    }
  }
}
