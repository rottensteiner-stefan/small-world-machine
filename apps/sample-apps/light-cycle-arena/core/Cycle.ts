import { Object3D, Scene, InstancedMesh } from "@small-world-machine/engine/core/index.js";
import { StandardMaterial } from "@small-world-machine/engine/core/materials/index.js";
import { Color } from "@small-world-machine/engine/core/colors/index.js";
import { GridMovementBehavior } from "@small-world-machine/engine/core/behaviors/index.js";
import { Cube } from "@small-world-machine/engine/geometry/index.js";
import { Vector3D, Matrix4 } from "@small-world-machine/engine/math/index.js";

export interface CycleOptions {
  scene: Scene;
  id: number;
  name: string;
  color: Color;
  position: Vector3D;
  direction: Vector3D;
  speed: number;
  gridSize: number;
  maxTrailSegments: number;
  trailHeight: number;
}

/**
 * One light cycle: its visible body, its permanent glowing trail, and its
 * `GridMovementBehavior`.
 *
 * The trail is one `InstancedMesh` grown by one segment per grid cell crossed -- not
 * `TrailRendererBehavior`, whose pooled/shrinking design is built for cosmetic short trails,
 * not a permanent Tron wall that has to stay exactly as long as the path actually taken.
 *
 * `movement` is attached with `isActive = false` on purpose: Light Cycle Arena's time-warp
 * mechanic scales each cycle's own deltaTime independently of the real frame time, so `App`
 * ticks `movement.update()` manually every frame instead of letting `Scene`'s automatic
 * per-behavior pass (which always uses the real, unscaled deltaTime) drive it.
 */
export class Cycle {
  public readonly id: number;
  public readonly object: Object3D;
  public readonly movement: GridMovementBehavior;
  public readonly color: Color;
  public alive: boolean = true;

  private readonly _trailMesh: InstancedMesh;
  private readonly _maxTrailSegments: number;
  private readonly _trailHeight: number;
  private readonly _gridSize: number;
  private _trailCount: number = 0;

  constructor(options: CycleOptions) {
    this.id = options.id;
    this.color = options.color;
    this._maxTrailSegments = options.maxTrailSegments;
    this._trailHeight = options.trailHeight;
    this._gridSize = options.gridSize;

    this.object = new Object3D(options.name);
    this.object.geometry = new Cube({ size: 1 }).getGeometryData();
    this.object.material = new StandardMaterial({
      color: options.color,
      emissiveColor: options.color,
      emissiveIntensity: 5.0,
      roughness: 0.25,
      metallic: 0.3,
    });
    this.object.setScale(
      options.gridSize * 0.55,
      options.trailHeight * 0.8,
      options.gridSize * 0.85,
    );
    this.object.position.copyFrom(options.position);
    this.object.position.y = options.trailHeight * 0.4;
    this.object.isCollidable = false;
    options.scene.add(this.object);

    this.movement = new GridMovementBehavior({
      speed: options.speed,
      gridSize: options.gridSize,
      direction: options.direction,
    });
    this.movement.isActive = false;
    this.object.addBehavior(this.movement);

    const trailMat = new StandardMaterial({
      color: options.color,
      emissiveColor: options.color,
      emissiveIntensity: 6.0,
      roughness: 0.2,
    });
    this._trailMesh = new InstancedMesh(
      `${options.name}_Trail`,
      new Cube({ size: 1 }).getGeometryData(),
      trailMat,
      this._maxTrailSegments,
    );
    this._trailMesh.isCollidable = false;
    const hidden = new Matrix4();
    hidden.compose(new Vector3D(0, -9999, 0), new Vector3D(), new Vector3D(0, 0, 0));
    for (let i = 0; i < this._maxTrailSegments; i++) {
      this._trailMesh.setMatrixAt(i, hidden);
    }
    options.scene.add(this._trailMesh);
  }

  /** Lays one permanent trail segment at `position` (called once per grid cell crossed). */
  public layTrailSegment(position: Vector3D): void {
    if (this._trailCount >= this._maxTrailSegments) return; // arena is small enough this never bites in practice
    const m = new Matrix4();
    m.compose(
      new Vector3D(position.x, this._trailHeight / 2, position.z),
      new Vector3D(),
      new Vector3D(this._gridSize, this._trailHeight, this._gridSize),
    );
    this._trailMesh.setMatrixAt(this._trailCount, m);
    this._trailCount++;
  }

  public destroy(): void {
    this.alive = false;
    this.object.isVisible = false;
  }
}
