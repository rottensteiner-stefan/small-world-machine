import { Behavior } from "../behaviors/Behavior.js";
import type { CameraInterfaceData } from "../../interfaces/index.js";
import { isCameraTarget } from "../../interfaces/index.js";
import type { Object3D, InputInterface, Scene } from "../index.js";
import { Keys } from "../../enums/index.js";
import { BoundingSphere } from "../../physix/index.js";
import { resolveSphereCollisions } from "../behaviors/CollisionResolution.js";
import { MathUtils } from "../../math/index.js";

/**
 * Configuration options for the FlyController.
 */
export interface FlyControllerOptions {
  /** Base flight speed in units per second. Defaults to 7.0. */
  moveSpeed?: number;
  /** Speed multiplier when holding Shift (Sprint/Boost). Defaults to 2.5. */
  fastMultiplier?: number;
  /** Speed multiplier when holding Alt/Ctrl (Precision/Slow). Defaults to 0.35. */
  slowMultiplier?: number;
  /** Mouse look sensitivity. Defaults to 0.004. */
  lookSensitivity?: number;
  /** Whether movement (WASD/Space/C) is enabled. Defaults to true. */
  enableMovement?: boolean;
  /** Whether rotation (Mouse) is enabled. Defaults to true. */
  enableRotation?: boolean;
  /** Whether vertical movement (Space/C or E/Q) is enabled. Defaults to true. */
  enableVertical?: boolean;
  /** Whether collisions against scene geometry are enabled. Defaults to true if scene is provided. */
  enableCollision?: boolean;
  /** Radius of the collision sphere around the camera. Defaults to 0.45. */
  collisionRadius?: number;
  /** Whether movement follows the full 3D pitch/yaw view direction. Defaults to true. */
  flyInLookDirection?: boolean;
  /** The scene to check for collisions against walls and obstacles. */
  scene?: Scene;
  /** Input source. Required. */
  input?: InputInterface;
}

/**
 * A full 6-DOF free-flight spectator controller with solid wall and obstacle collisions.
 *
 * Controls:
 * - Mouse / PointerLock: Look around (Pitch & Yaw)
 * - W / S: Fly forward / backward in 3D look direction
 * - A / D: Strafe left / right
 * - Space / E: Ascend (Up)
 * - C / Q: Descend (Down)
 * - Shift: Boost flight speed (2.5x)
 * - Alt / Ctrl: Precision crawl (0.35x)
 */
export class FlyController extends Behavior {
  public enabled: boolean = true;
  private _options: Required<Omit<FlyControllerOptions, "scene" | "input">> & {
    scene?: Scene;
    input: InputInterface;
  };
  private _collider?: BoundingSphere;

  constructor(options: FlyControllerOptions = {}) {
    super();
    this._options = {
      moveSpeed: options.moveSpeed ?? 7.0,
      fastMultiplier: options.fastMultiplier ?? 2.5,
      slowMultiplier: options.slowMultiplier ?? 0.35,
      lookSensitivity: options.lookSensitivity ?? 0.004,
      enableMovement: options.enableMovement ?? true,
      enableRotation: options.enableRotation ?? true,
      enableVertical: options.enableVertical ?? true,
      enableCollision: options.enableCollision ?? !!options.scene,
      collisionRadius: options.collisionRadius ?? 0.45,
      flyInLookDirection: options.flyInLookDirection ?? true,
      input: options.input as InputInterface,
      ...(options.scene !== undefined && { scene: options.scene }),
    };
    if (!this._options.input) {
      throw new Error("FlyController requires an 'input' option.");
    }
  }

  public get moveSpeed(): number {
    return this._options.moveSpeed;
  }

  public set moveSpeed(val: number) {
    this._options.moveSpeed = val;
  }

  public get fastMultiplier(): number {
    return this._options.fastMultiplier;
  }

  public set fastMultiplier(val: number) {
    this._options.fastMultiplier = val;
  }

  public get slowMultiplier(): number {
    return this._options.slowMultiplier;
  }

  public set slowMultiplier(val: number) {
    this._options.slowMultiplier = val;
  }

  public override onAttach(target: Object3D | CameraInterfaceData): void {
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

    // 1. Mouse Look / Rotation
    let dx = 0;
    let dy = 0;
    if (this._options.enableRotation && (input.isPointerLocked || input.mouse.left)) {
      dx = input.mouse.dx;
      dy = input.mouse.dy;
    }

    // 2. Speed Modifier (Shift = Fast, Alt/Ctrl = Slow)
    let speed = this._options.moveSpeed;
    if (input.isPressed(Keys.SHIFT_L) || input.isPressed(Keys.SHIFT_R)) {
      speed *= this._options.fastMultiplier;
    } else if (
      input.isPressed(Keys.ALT_L) ||
      input.isPressed(Keys.ALT_R) ||
      input.isPressed(Keys.CTRL_L) ||
      input.isPressed(Keys.CTRL_R)
    ) {
      speed *= this._options.slowMultiplier;
    }

    // 3. Movement
    if (this._options.enableMovement) {
      const moveZ = input.getAxis(Keys.W, Keys.S) || input.getAxis(Keys.UP, Keys.DOWN);
      const moveX = input.getAxis(Keys.A, Keys.D) || input.getAxis(Keys.LEFT, Keys.RIGHT);

      const theta = isCamera ? target.theta : (target as Object3D).rotation.y;
      const phi = isCamera ? target.phi : (target as Object3D).rotation.x;

      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      const sinP = Math.sin(phi);
      const cosP = Math.cos(phi);

      // Forward / Backward in 3D Look Direction
      if (0 !== moveZ) {
        // moveZ: -1 for W (Forward), +1 for S (Backward)
        if (this._options.flyInLookDirection && isCamera) {
          const dirX = sinT * cosP;
          const dirY = sinP;
          const dirZ = -cosT * cosP;

          target.position.x += -moveZ * dirX * speed * deltaTime;
          target.position.y += -moveZ * dirY * speed * deltaTime;
          target.position.z += -moveZ * dirZ * speed * deltaTime;
        } else {
          target.position.x += -moveZ * sinT * speed * deltaTime;
          target.position.z += -moveZ * -cosT * speed * deltaTime;
        }
      }

      // Strafe Left / Right
      if (0 !== moveX) {
        target.position.x += moveX * cosT * speed * deltaTime;
        target.position.z += moveX * sinT * speed * deltaTime;
      }

      // Vertical Ascend / Descend (Space / E = Up, C / Q = Down)
      if (this._options.enableVertical) {
        let verticalAxis = 0;
        if (input.isPressed(Keys.SPACE) || input.isPressed(Keys.E)) {
          verticalAxis += 1;
        }
        if (input.isPressed(Keys.C) || input.isPressed(Keys.Q)) {
          verticalAxis -= 1;
        }

        if (0 !== verticalAxis) {
          target.position.y += verticalAxis * speed * deltaTime;
        }
      }
    }

    // 4. Resolve Collisions Against Walls and Scene Geometry (No God-Mode)
    if (this._options.enableCollision && this._options.scene && this._collider) {
      resolveSphereCollisions(this._collider, target, this._options.scene, this._collider.radius);
    }

    // 5. Apply Look Rotation
    if (isCamera) {
      if (this._options.enableRotation && (0 !== dx || 0 !== dy)) {
        target.pendingDx += dx;
        target.pendingDy += dy;
      }
    } else {
      const obj = target as Object3D;
      if (this._options.enableRotation && (0 !== dx || 0 !== dy)) {
        obj.rotation.y -= dx * this._options.lookSensitivity;
        obj.rotation.x += dy * this._options.lookSensitivity;
        const limit = 1.55;
        obj.rotation.x = MathUtils.clamp(obj.rotation.x, -limit, limit);
      }
    }
  }
}
