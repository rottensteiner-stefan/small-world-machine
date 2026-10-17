import { Behavior } from "./Behavior.js";
import { CameraInterfaceData } from "../../interfaces/index.js";
import { Object3D, InputInterface, Scene } from "../index.js";
import { Keys } from "../../enums/index.js";
import { BoundingSphere } from "../../physix/index.js";
import { resolveSphereCollisions } from "./CollisionResolution.js";

/**
 * Configuration for the FirstPersonController.
 */
export interface FirstPersonControllerOptions {
  /** Movement speed in units per second. Defaults to 10. */
  moveSpeed?: number;
  /** Rotation speed in radians per second. Defaults to 2.0. */
  rotationSpeed?: number;
  /** Whether collisions are enabled. Requires a Scene reference. */
  enableCollision?: boolean;
  /** The radius of the collision sphere. Defaults to 0.7. */
  collisionRadius?: number;
  /** The resting height of the camera above the floor. Defaults to 0.2 (legacy behavior). */
  eyeHeight?: number;
  /** The scene to check for collisions. */
  scene?: Scene;
  /** Enable classic retro tank controls (turning with A/D) vs modern strafing. Defaults to true. */
  retroTankControls?: boolean;
  /** Input source. Required — no global fallback. */
  input?: InputInterface;
}

/**
 * A generalized First Person Controller handling movement, rotation, and collisions.
 */
export class FirstPersonController extends Behavior {
  public enabled: boolean = true;
  protected _options: Required<Omit<FirstPersonControllerOptions, "scene" | "input">> & {
    scene: Scene | undefined;
    input: InputInterface;
  };
  protected _collider?: BoundingSphere;

  // Public state for other behaviors (like weapon bobbing or footsteps) to read
  public distanceMoved: number = 0;
  public bobPhase: number = 0;
  public isMoving: boolean = false;

  /**
   * Creates a new FirstPersonController.
   * @param options The configuration options.
   */
  constructor(options: FirstPersonControllerOptions = {}) {
    super();
    this._options = {
      moveSpeed: options.moveSpeed ?? 10.0,
      rotationSpeed: options.rotationSpeed ?? 2.0,
      enableCollision: options.enableCollision ?? !!options.scene,
      collisionRadius: options.collisionRadius ?? 0.7,
      eyeHeight: options.eyeHeight ?? 0.2,
      scene: options.scene,
      retroTankControls: options.retroTankControls ?? true,
      input: options.input as InputInterface,
    };
    if (!this._options.input) {
      throw new Error("FirstPersonController requires an 'input' option.");
    }
  }

  public override onAttach(target: Object3D | CameraInterfaceData): void {
    super.onAttach(target);
    this._collider = new BoundingSphere(target.position.clone(), this._options.collisionRadius);
  }

  public override update(deltaTime: number): void {
    if (!this.enabled || !this.target) {
      return;
    }

    const input = this._options.input;
    const isCamera = "updateProjectionMatrix" in this.target;
    this.isMoving = false;

    // 1. Rotation (Turn Left/Right)
    let rotationDelta: number = 0;
    if (this._options.retroTankControls) {
      if (input.isPressed(Keys.A) || input.isPressed(Keys.LEFT)) {
        rotationDelta -= 1;
      }
      if (input.isPressed(Keys.D) || input.isPressed(Keys.RIGHT)) {
        rotationDelta += 1;
      }
    } else {
      // Modern mouse look or pointer lock logic could go here if implemented
      if (input.isPressed(Keys.LEFT)) rotationDelta -= 1;
      if (input.isPressed(Keys.RIGHT)) rotationDelta += 1;
    }

    const rotationAmount = rotationDelta * this._options.rotationSpeed * deltaTime;

    if (0 !== rotationDelta) {
      if (isCamera) {
        (this.target as unknown as CameraInterfaceData).theta += rotationAmount;
      } else {
        (this.target as Object3D).rotation.y -= rotationAmount;
      }
    }

    // 2. Movement
    let moveZ: number = 0;
    let moveX: number = 0;

    if (input.isPressed(Keys.W) || input.isPressed(Keys.UP)) {
      moveZ += 1;
    }
    if (input.isPressed(Keys.S) || input.isPressed(Keys.DOWN)) {
      moveZ -= 1;
    }

    if (!this._options.retroTankControls) {
      // Strafing
      if (input.isPressed(Keys.A)) moveX -= 1;
      if (input.isPressed(Keys.D)) moveX += 1;
    }

    if (0 !== moveZ || 0 !== moveX) {
      this.isMoving = true;
      const theta: number = isCamera
        ? (this.target as unknown as CameraInterfaceData).theta
        : (this.target as Object3D).rotation.y;

      const sin: number = Math.sin(theta);
      const cos: number = Math.cos(theta);

      // Forward is towards -Z at theta=0
      let dirX = sin * moveZ;
      let dirZ = -cos * moveZ;

      // Add strafe (perpendicular)
      dirX += cos * moveX;
      dirZ += sin * moveX;

      this.target.position.x += dirX * this._options.moveSpeed * deltaTime;
      this.target.position.z += dirZ * this._options.moveSpeed * deltaTime;
    }

    // 3. Update Walk Cycle / Bob Phase
    const totalMovement =
      Math.abs(rotationAmount) + (this.isMoving ? this._options.moveSpeed * deltaTime : 0);
    if (totalMovement > 0) {
      this.distanceMoved += totalMovement;
      this.bobPhase += totalMovement * 2.0;
    } else {
      // Smoothly return bob phase to 0 or multiple of PI when not moving, so weapon/head rests centered
      const remainder = this.bobPhase % (Math.PI * 2);
      if (remainder > 0.1) {
        const target = remainder > Math.PI ? Math.PI * 2 : 0;
        this.bobPhase += (target - remainder) * deltaTime * 5;
      }
    }

    // 4. Resolve Collisions
    if (true === this._options.enableCollision && undefined !== this._options.scene) {
      resolveSphereCollisions(
        this._collider,
        this.target,
        this._options.scene,
        this._options.eyeHeight,
      );
    }
  }
}
