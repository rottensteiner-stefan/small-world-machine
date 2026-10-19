import { Behavior, Keys } from "@small-world-machine/engine";
import type { Camera, InputInterface } from "@small-world-machine/engine";
import type { ChunkWorld } from "../ChunkWorld.js";
import type { SweepWorld, Vec3 } from "./VoxelSweep.js";
import { sweepVoxel } from "./VoxelSweep.js";

/**
 * M1 first-person player with voxel-grid collision (dossier §4.4 E2: "Eigener App-seitiger
 * FPS-Behavior"). Runs the swept AABB resolver (`sweepVoxel`) against `ChunkWorld` every frame,
 * bakes the input into a desired planar velocity and feeds the engine's FPS camera strategy.
 *
 * Separation of concerns (M1 architecture):
 *   - PURE collision math stays in `voxel/physics/VoxelSweep.ts` (node-testable, no engine).
 *   - This behavior is thin, engine-coupled GLUE: input -> desired velocity -> sweep -> camera.
 *   - It owns "where the player is", so it is the ONLY place that can center streaming on the
 *     fresh body position: `world.setFocus()` + `world.update()` run here after the sweep
 *     (the engine runs camera behaviors AFTER `App.update`, so centering must happen here or
 *     stream dispatch would lag one frame behind the body -- see `SmallWorldMachine`'s loop).
 *
 * Camera conventions (exact engine parity, see `FPSController` + `FPSStrategy`):
 *   - Mouse-look is NOT applied here: the behavior only accumulates `pendingDx`/`pendingDy`
 *     (raw deltas, only while pointer is locked); the FPS strategy owns theta/phi and applies
 *     its fixed 0.005 sensitivity in `Camera.update`, which the engine calls per frame.
 *   - Forward/strafe math uses `camera.theta` (yaw) with the SAME sign convention as
 *     `FPSController` (W is -1 on the W/S axis, forward is -Z at theta = 0).
 *   - The camera position is set to the player's eye (body feet + `eyeHeight`). Because the
 *     engine passes `camera.target` itself, the FPS strategy does not overwrite the position.
 *
 * The body is a 0.6-wide, 1.8-tall AABB around a feet origin (see `options.body`); gravity is
 * passed as accel into the sweep (the gravity-in-accel model `VoxelSweep` documents). On
 * ground contact the vertical velocity is zeroed -- the Luanti-style "standing still" state.
 */

/** Minimal structural seam between the pure sweep and the world store (no engine, no coupling). */
class SweepWorldAdapter implements SweepWorld {
  private readonly _world: ChunkWorld;

  constructor(world: ChunkWorld) {
    this._world = world;
  }

  public isSolidCell(x: number, y: number, z: number): boolean {
    return this._world.isSolidAt(x, y, z);
  }
}

export interface VoxelPlayerOptions {
  /** The streaming world the player sweeps against + drives via its focus. Required. */
  world: ChunkWorld;
  /** Input source (no global fallback). Required. */
  input: InputInterface;
  /** Maximum planar walk speed in m/s. Default 5. */
  walkSpeed?: number;
  /** Gravity in m/s² (positive number, applied downward). Default 20. */
  gravity?: number;
  /** Eye offset above the feet (camera Y). Default 1.62. */
  eyeHeight?: number;
  /** Player AABB as min/max OFFSETS relative to the feet origin. Default 0.6 × 1.8. */
  body?: { min: Vec3; max: Vec3 };
}

export class VoxelPlayerCollision extends Behavior<Camera> {
  private readonly _options: Required<Omit<VoxelPlayerOptions, "world" | "input">> & {
    world: ChunkWorld;
    input: InputInterface;
  };
  private readonly _world: SweepWorldAdapter;

  /** Player body origin (feet centre, world units). */
  private _body: Vec3 = { x: 0, y: 0, z: 0 };
  private _velocity: Vec3 = { x: 0, y: 0, z: 0 };
  private _onGround: boolean = false;
  private _spawned: boolean = false;

  constructor(options: VoxelPlayerOptions) {
    super();
    if (!options.world || !options.input) {
      throw new Error("VoxelPlayerCollision requires 'world' and 'input' options.");
    }
    this._world = new SweepWorldAdapter(options.world);
    this._options = {
      world: options.world,
      input: options.input,
      walkSpeed: options.walkSpeed ?? 5,
      gravity: options.gravity ?? 20,
      eyeHeight: options.eyeHeight ?? 1.62,
      body: options.body ?? { min: { x: -0.3, y: 0, z: -0.3 }, max: { x: 0.3, y: 1.8, z: 0.3 } },
    };
  }

  /** Whether the body is standing on solid ground (as resolved by the previous frame). */
  public isOnGround(): boolean {
    return this._onGround;
  }

  /** Current feet position (player body origin) in world units. A fresh object, never shared. */
  public getFeetPosition(): Vec3 {
    return { x: this._body.x, y: this._body.y, z: this._body.z };
  }

  /**
   * Whether the full voxel cell (wx, wy, wz) intersects the player AABB (world space). Strict
   * inequalities, so resting exactly ON a surface (feet at an integer) does not overlap the
   * cell below -- the same contact semantics the sweep resolver applies. Used by the block
   * editor's placement guard (M2) so a player cannot embed itself in a freshly placed block.
   */
  public overlapsCell(wx: number, wy: number, wz: number): boolean {
    const body = this._options.body;
    const minX = this._body.x + body.min.x;
    const maxX = this._body.x + body.max.x;
    const minY = this._body.y + body.min.y;
    const maxY = this._body.y + body.max.y;
    const minZ = this._body.z + body.min.z;
    const maxZ = this._body.z + body.max.z;
    return maxX > wx && minX < wx + 1 && maxY > wy && minY < wy + 1 && maxZ > wz && minZ < wz + 1;
  }

  /**
   * Teleports the player to a feet position (e.g. the terrain surface at spawn). Clears velocity
   * and the ground flag. Must be called once before the first frame renders.
   */
  public setSpawn(x: number, y: number, z: number): void {
    this._body = { x, y, z };
    this._velocity = { x: 0, y: 0, z: 0 };
    this._onGround = false;
    this._spawned = true;
  }

  public override update(deltaTime: number): void {
    const cam = this.target;
    if (!cam || !this._spawned) return;

    const input = this._options.input;

    // 1. Feed the FPS strategy with raw look deltas (it owns sensitivity + theta/phi).
    if (input.isPointerLocked) {
      cam.pendingDx += input.mouse.dx;
      cam.pendingDy += input.mouse.dy;
    }

    // 2. Desired planar velocity from WASD, in the camera's yaw frame (FPSController parity).
    const moveZ = input.getAxis(Keys.W, Keys.S); // W = -1 (forward)
    const strafe = input.getAxis(Keys.A, Keys.D);
    const sin = Math.sin(cam.theta);
    const cos = Math.cos(cam.theta);
    const speed = this._options.walkSpeed;
    const velocity: Vec3 = {
      x: -moveZ * sin * speed + strafe * cos * speed,
      y: this._velocity.y,
      z: moveZ * cos * speed + strafe * sin * speed,
    };

    // 3. Sweep against the voxel grid (gravity always active; the resolver caps the axis).
    const result = sweepVoxel({
      world: this._world,
      options: {
        boxOffset: this._options.body,
        accel: { x: 0, y: -this._options.gravity, z: 0 },
      },
      position: this._body,
      velocity,
      dt: deltaTime,
    });

    // 4. Stand still on ground (Luanti convention: zero the falling speed once supported).
    let vy = result.velocity.y;
    if (result.onGround && vy < 0) vy = 0;
    this._velocity = { x: result.velocity.x, y: vy, z: result.velocity.z };
    this._body = { x: result.position.x, y: result.position.y, z: result.position.z };
    this._onGround = result.onGround;

    // 5. Center streaming on the fresh body and dispatch the bounded world tasks.
    this._options.world.setFocus(this._body.x, this._body.z);
    this._options.world.update();

    // 6. Put the eye where the body is (FPS strategy keeps the view direction; see header).
    cam.position.x = this._body.x;
    cam.position.y = this._body.y + this._options.eyeHeight;
    cam.position.z = this._body.z;
  }
}
