import {
  Behavior,
  GridMovementBehavior,
  Object3D,
  Scene,
  Sphere,
  StandardMaterial,
  TrailRendererBehavior,
  Vector3D,
} from "@small-world-machine/engine";

// Static round-robin counter to ensure all 4 corners spawn drones equally
let cornerSpawnIndex = 0;

export class DroneController extends Behavior {
  private _scene: Scene;
  private _speed: number = 20.0;
  private _gridSize: number = 4.0;

  // The allowed directions for this specific drone to ensure it moves ACROSS the board
  private _allowedDirX: number = 1;
  private _allowedDirZ: number = 1;

  private _movementBehavior!: GridMovementBehavior;
  private _trailBehavior!: TrailRendererBehavior;

  constructor(scene: Scene, sharedMaterial: StandardMaterial) {
    super();
    this._scene = scene;

    // Create the geometry once
    const sharedGeometry = new Sphere({
      radius: 0.15,
      widthSegments: 8,
      heightSegments: 8,
    }).getGeometryData();

    // Prepare the generic behaviors
    this._trailBehavior = new TrailRendererBehavior({
      scene: this._scene,
      geometry: sharedGeometry,
      material: sharedMaterial,
      poolSize: 20,
      spawnInterval: 0.05,
      shrinkRate: 4.0,
      offset: new Vector3D(0, -0.15, 0),
    });

    this._movementBehavior = new GridMovementBehavior({
      speed: this._speed,
      gridSize: this._gridSize,
      onGridIntersection: (): Vector3D | null => this._handleGridIntersection(),
    });
  }

  public override onAttach(target: Object3D): void {
    super.onAttach(target);
    // Attach our generic building blocks to the same target!
    target.addBehavior(this._trailBehavior);
    target.addBehavior(this._movementBehavior);

    // Initial spawn
    this._respawn(target);
  }

  public override update(_deltaTime: number): void {
    if (!this.target) return;
    const obj = this.target as Object3D;

    // Out of bounds -> Respawn at corners (bounds extended to 34)
    if (Math.abs(obj.position.x) > 34.1 || Math.abs(obj.position.z) > 34.1) {
      this._respawn(obj);
    }
  }

  private _handleGridIntersection(): Vector3D | null {
    // 30% chance to turn. We ONLY turn in the allowed directions so the drone stair-steps!
    if (Math.random() < 0.3) {
      const currentDir = this._movementBehavior.direction;
      if (Math.abs(currentDir.x) > 0) {
        return new Vector3D(0, 0, this._allowedDirZ);
      } else {
        return new Vector3D(this._allowedDirX, 0, 0);
      }
    }
    return null;
  }

  private _respawn(obj: Object3D): void {
    const corners = [
      { x: 34, z: -34 }, // Spawn 1 (Red)
      { x: -34, z: 34 }, // Spawn 2 (Green)
      { x: -34, z: -34 }, // Spawn 3 (Blue)
      { x: 34, z: 34 }, // Spawn 4 (Magenta)
    ];

    // Round-robin selection
    const corner = corners[cornerSpawnIndex % corners.length]!;
    cornerSpawnIndex++;

    // Set Drone flight altitude to exactly 1.0 (equator of the resting marble)
    obj.position.set(corner.x, 1.0, corner.z);

    // Determine the ONLY allowed directions (always towards the center/opposite corner)
    this._allowedDirX = corner.x > 0 ? -1 : 1;
    this._allowedDirZ = corner.z > 0 ? -1 : 1;

    // Pick initial direction inwards
    if (Math.random() > 0.5) {
      this._movementBehavior.direction.set(this._allowedDirX, 0, 0);
    } else {
      this._movementBehavior.direction.set(0, 0, this._allowedDirZ);
    }

    this._movementBehavior.resetMovement();
    this._trailBehavior.clear();
  }
}
