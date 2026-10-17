import { Behavior } from "./Behavior.js";
import type { Scene, AbstractMaterial } from "../index.js";
import { Object3D } from "../Object3D.js";
import type { GeometryDataInterface } from "../../interfaces/index.js";
import { Vector3D } from "../../math/index.js";

export interface TrailRendererOptions {
  scene: Scene;
  geometry: GeometryDataInterface;
  material: AbstractMaterial;
  /** Number of trail segments to pool (default: 20) */
  poolSize?: number;
  /** Interval in seconds between spawning segments (default: 0.05) */
  spawnInterval?: number;
  /** How fast the segments shrink per second (default: 4.0) */
  shrinkRate?: number;
  /** An offset relative to the target's position (default: [0, 0, 0]) */
  offset?: Vector3D;
}

/**
 * A generic behavior that leaves a trail of shrinking 3D objects behind the target.
 * Uses object pooling to avoid garbage collection spikes.
 */
export class TrailRendererBehavior extends Behavior {
  private _scene: Scene;
  private _spawnInterval: number;
  private _shrinkRate: number;
  private _offset: Vector3D;

  private _trailTimer: number = 0;
  private _trails: Object3D[] = [];
  private _trailIndex: number = 0;

  constructor(options: TrailRendererOptions) {
    super();
    this._scene = options.scene;
    this._spawnInterval = options.spawnInterval ?? 0.05;
    this._shrinkRate = options.shrinkRate ?? 4.0;
    this._offset = options.offset ?? new Vector3D(0, 0, 0);

    const poolSize = options.poolSize ?? 20;

    for (let i = 0; i < poolSize; i++) {
      const trail = new Object3D("TrailSegment");
      trail.geometry = options.geometry;
      trail.material = options.material;
      trail.isVisible = false;
      trail.isCollidable = false;

      this._trails.push(trail);
      this._scene.add(trail);
    }
  }

  public override update(deltaTime: number): void {
    if (!this.target) return;
    const obj = this.target as Object3D;

    // 1. Update existing trails (shrink them)
    const shrink = 1.0 - this._shrinkRate * deltaTime;
    for (const trail of this._trails) {
      if (trail.isVisible) {
        trail.scale.x *= shrink;
        trail.scale.y *= shrink;
        trail.scale.z *= shrink;
        if (trail.scale.x <= 0.001) {
          trail.isVisible = false;
        }
      }
    }

    // 2. Spawn new trail segment
    this._trailTimer += deltaTime;
    if (this._trailTimer >= this._spawnInterval) {
      this._trailTimer -= this._spawnInterval;

      const trailObj = this._trails[this._trailIndex]!;
      trailObj.position.copyFrom(obj.position);
      trailObj.position.add(this._offset);
      trailObj.scale.set(1, 1, 1);
      trailObj.isVisible = true;

      this._trailIndex = (this._trailIndex + 1) % this._trails.length;
    }
  }

  /**
   * Instantly hides all active trail segments. Useful when teleporting the target.
   */
  public clear(): void {
    for (const trail of this._trails) {
      trail.isVisible = false;
    }
  }
}
