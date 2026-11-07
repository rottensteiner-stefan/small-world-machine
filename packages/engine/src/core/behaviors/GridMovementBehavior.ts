import { Behavior } from "./Behavior.js";
import type { Object3D } from "../index.js";
import { Vector3D } from "../../math/index.js";

export interface GridMovementOptions {
  /** The speed in units per second */
  speed?: number;
  /** The size of the grid cells. Turns are only evaluated when crossing these bounds. */
  gridSize?: number;
  /** Initial movement direction. Must be normalized. */
  direction?: Vector3D;
  /** Callback fired every time the object reaches a grid intersection.
   * Return a new Vector3D to change direction, or null to keep the current direction. */
  onGridIntersection?: (currentPosition: Vector3D, currentDirection: Vector3D) => Vector3D | null;
}

/**
 * A behavior that moves an object strictly along orthogonal axes (X or Z)
 * and evaluates grid intersections to allow for perfect 90-degree turns.
 */
export class GridMovementBehavior extends Behavior {
  public speed: number;
  public direction: Vector3D;
  public gridSize: number;
  public onGridIntersection?:
    ((currentPosition: Vector3D, currentDirection: Vector3D) => Vector3D | null) | undefined;

  private _distanceMoved: number = 0;

  constructor(options: GridMovementOptions = {}) {
    super();
    this.speed = options.speed ?? 10.0;
    this.gridSize = options.gridSize ?? 4.0;
    this.direction = options.direction ?? new Vector3D(1, 0, 0);
    this.onGridIntersection = options.onGridIntersection;
  }

  public override update(deltaTime: number): void {
    if (!this.target) return;
    const obj = this.target as Object3D;

    const dist = this.speed * deltaTime;
    obj.position.x += this.direction.x * dist;
    obj.position.z += this.direction.z * dist;
    this._distanceMoved += dist;

    if (this._distanceMoved >= this.gridSize) {
      this._distanceMoved -= this.gridSize;

      // Snap to grid to prevent floating point drift on the moving axis
      if (Math.abs(this.direction.x) > 0) {
        obj.position.x = Math.round(obj.position.x / this.gridSize) * this.gridSize;
      } else if (Math.abs(this.direction.z) > 0) {
        obj.position.z = Math.round(obj.position.z / this.gridSize) * this.gridSize;
      }

      if (this.onGridIntersection) {
        const newDir = this.onGridIntersection(obj.position, this.direction);
        if (newDir) {
          this.direction.copyFrom(newDir);
        }
      }
    }
  }

  /**
   * Resets the movement tracker. Call this if you manually teleport the object.
   */
  public resetMovement(): void {
    this._distanceMoved = 0;
  }
}
