import { Color, Vector3D } from "@small-world-machine/engine";
import { mulberry32 } from "@small-world-machine/engine/utils/SeededRandom.js";
import type { ParticleSystem } from "../ParticleSystem.js";
import type { SdfColliderAffector } from "../affectors/SdfColliderAffector.js";
import { sampleCone } from "./EmitterShapes.js";

export type SubEmitterTrigger = "death" | "collision" | "both";

export interface SubEmitterOptions {
  /**
   * Primary `ParticleSystem` whose death or collision events trigger secondary bursts.
   */
  source: ParticleSystem;
  /**
   * Secondary `ParticleSystem` receiving the spawned child particles.
   */
  target: ParticleSystem;
  /**
   * Which parent event triggers secondary emission.
   * @domain `"death"` | `"collision"` | `"both"` — defaults to `"both"`.
   */
  trigger?: SubEmitterTrigger;
  /**
   * Optional `SdfColliderAffector` on `source` when `trigger` includes `"collision"`.
   */
  collider?: SdfColliderAffector;
  /**
   * Maximum number of parent events buffered per frame in the pre-allocated ring buffer.
   * Events beyond `maxEventsPerFrame` in a single tick are dropped without allocation.
   * @domain [1, 65536] — defaults to 256.
   */
  maxEventsPerFrame?: number;
  /**
   * Number of child particles spawned per parent trigger event.
   * @domain [1, 256] — defaults to 3.
   */
  burstCount?: number;
  /**
   * Cone opening half-angle in radians around the collision normal (or parent velocity on death).
   * @domain [0, Math.PI] — defaults to `Math.PI / 3` (60°).
   */
  coneHalfAngle?: number;
  /**
   * Child speed range `[min, max]` in meters/second.
   * @domain [0, Infinity) — defaults to `[1.0, 2.5]`.
   */
  speedRange?: readonly [number, number];
  /**
   * Child lifetime range `[min, max]` in seconds.
   * @domain (0, Infinity) — defaults to `[0.25, 0.6]`.
   */
  lifeRange?: readonly [number, number];
  /**
   * Child size range `[min, max]` in meters.
   * @domain (0, Infinity) — defaults to `[0.03, 0.07]`.
   */
  sizeRange?: readonly [number, number];
  /**
   * Initial child color. Defaults to warm spark orange `(1.0, 0.7, 0.3, 1.0)`.
   */
  color?: Color;
  /**
   * Minimum impact speed (m/s) required to trigger a collision burst.
   * @domain [0, Infinity) — defaults to 0.2.
   */
  minImpactSpeed?: number;
  /**
   * Deterministic integer seed for child burst sampling.
   * @domain Integer — defaults to 2026.
   */
  seed?: number;
}

const EVENT_STRIDE = 7; // [px, py, pz, dirX, dirY, dirZ, speed]

/**
 * Zero-allocation sub-emitter bridge connecting a parent `ParticleSystem` (and optional
 * `SdfColliderAffector`) to a secondary `ParticleSystem`. Buffers `onDeath` and `onCollision`
 * events in a pre-allocated `Float32Array` ring buffer during `source.update(dt)` and drains them
 * into `target.emit(...)` during {@link SubEmitter.flush}.
 */
export class SubEmitter {
  public readonly source: ParticleSystem;
  public readonly target: ParticleSystem;
  public readonly trigger: SubEmitterTrigger;
  public readonly maxEventsPerFrame: number;
  public burstCount: number;
  public coneHalfAngle: number;
  public speedRange: readonly [number, number];
  public lifeRange: readonly [number, number];
  public sizeRange: readonly [number, number];
  public color: Color;
  public minImpactSpeed: number;

  private readonly _eventBuffer: Float32Array;
  private _queuedEvents = 0;
  private readonly _rng: () => number;

  // Pre-allocated scratch objects so `flush()` allocates zero heap objects per frame.
  private readonly _scratchOrigin = new Vector3D();
  private readonly _scratchAxis = new Vector3D();
  private readonly _scratchPos = new Vector3D();
  private readonly _scratchVel = new Vector3D();

  constructor(options: SubEmitterOptions) {
    this.source = options.source;
    this.target = options.target;
    this.trigger = options.trigger ?? "both";
    this.maxEventsPerFrame = Math.max(1, Math.min(65536, options.maxEventsPerFrame ?? 256));
    this.burstCount = Math.max(1, Math.floor(options.burstCount ?? 3));
    this.coneHalfAngle = options.coneHalfAngle ?? Math.PI / 3;
    this.speedRange = options.speedRange ?? [1.0, 2.5];
    this.lifeRange = options.lifeRange ?? [0.25, 0.6];
    this.sizeRange = options.sizeRange ?? [0.03, 0.07];
    this.color = options.color ? options.color.clone() : new Color(1.0, 0.7, 0.3, 1.0);
    this.minImpactSpeed = Math.max(0, options.minImpactSpeed ?? 0.2);

    this._eventBuffer = new Float32Array(this.maxEventsPerFrame * EVENT_STRIDE);
    this._rng = mulberry32((options.seed ?? 2026) | 0);

    if (this.trigger === "death" || this.trigger === "both") {
      const prevOnDied = this.source.onParticleDied;
      this.source.onParticleDied = (slotIndex: number): void => {
        prevOnDied?.(slotIndex);
        this.recordDeath(slotIndex);
      };
    }

    if ((this.trigger === "collision" || this.trigger === "both") && options.collider) {
      const prevOnCollision = options.collider.onCollision;
      options.collider.onCollision = (
        slotIndex: number,
        px: number,
        py: number,
        pz: number,
        nx: number,
        ny: number,
        nz: number,
        impactSpeed: number,
      ): void => {
        prevOnCollision?.(slotIndex, px, py, pz, nx, ny, nz, impactSpeed);
        this.recordCollision(px, py, pz, nx, ny, nz, impactSpeed);
      };
    }
  }

  /** Number of events currently waiting in the ring buffer before `flush()`. */
  public get queuedEventCount(): number {
    return this._queuedEvents;
  }

  /**
   * Records a parent particle death event directly from `source.arrays` into the pre-allocated
   * ring buffer before the slot returns to `source`'s free list.
   */
  public recordDeath(slotIndex: number): void {
    if (this._queuedEvents >= this.maxEventsPerFrame) return;
    const arrays = this.source.arrays;
    const o3 = slotIndex * 3;
    const px = arrays.positions[o3]!;
    const py = arrays.positions[o3 + 1]!;
    const pz = arrays.positions[o3 + 2]!;
    const vx = arrays.velocities[o3]!;
    const vy = arrays.velocities[o3 + 1]!;
    const vz = arrays.velocities[o3 + 2]!;
    const speed = Math.hypot(vx, vy, vz);

    const base = this._queuedEvents * EVENT_STRIDE;
    const buf = this._eventBuffer;
    buf[base] = px;
    buf[base + 1] = py;
    buf[base + 2] = pz;
    if (speed > 1e-5) {
      buf[base + 3] = vx / speed;
      buf[base + 4] = vy / speed;
      buf[base + 5] = vz / speed;
    } else {
      buf[base + 3] = 0;
      buf[base + 4] = 1;
      buf[base + 5] = 0;
    }
    buf[base + 6] = speed;
    this._queuedEvents++;
  }

  /**
   * Records a collision event into the pre-allocated ring buffer if `impactSpeed >= minImpactSpeed`.
   */
  public recordCollision(
    px: number,
    py: number,
    pz: number,
    nx: number,
    ny: number,
    nz: number,
    impactSpeed: number,
  ): void {
    if (impactSpeed < this.minImpactSpeed) return;
    if (this._queuedEvents >= this.maxEventsPerFrame) return;

    const base = this._queuedEvents * EVENT_STRIDE;
    const buf = this._eventBuffer;
    buf[base] = px;
    buf[base + 1] = py;
    buf[base + 2] = pz;
    buf[base + 3] = nx;
    buf[base + 4] = ny;
    buf[base + 5] = nz;
    buf[base + 6] = impactSpeed;
    this._queuedEvents++;
  }

  /**
   * Drains all buffered events and emits secondary bursts into `target`. Zero heap allocations.
   * @returns Number of child particles actually spawned into `target`.
   */
  public flush(): number {
    const count = this._queuedEvents;
    if (count === 0) return 0;
    this._queuedEvents = 0;

    const buf = this._eventBuffer;
    const burst = this.burstCount;
    const halfAngle = this.coneHalfAngle;
    const [minSpeed, maxSpeed] = this.speedRange;
    const [minLife, maxLife] = this.lifeRange;
    const [minSize, maxSize] = this.sizeRange;
    const rng = this._rng;
    const origin = this._scratchOrigin;
    const axis = this._scratchAxis;
    const pos = this._scratchPos;
    const vel = this._scratchVel;
    const color = this.color;
    const target = this.target;

    let spawned = 0;

    for (let e = 0; e < count; e++) {
      const base = e * EVENT_STRIDE;
      origin.x = buf[base]!;
      origin.y = buf[base + 1]!;
      origin.z = buf[base + 2]!;
      axis.x = buf[base + 3]!;
      axis.y = buf[base + 4]!;
      axis.z = buf[base + 5]!;

      for (let b = 0; b < burst; b++) {
        const speed = minSpeed + (maxSpeed - minSpeed) * rng();
        const life = minLife + (maxLife - minLife) * rng();
        const size = minSize + (maxSize - minSize) * rng();

        sampleCone(pos, vel, rng, origin, axis, halfAngle, speed, 0);

        const idx = target.emit({
          position: pos,
          velocity: vel,
          color,
          size,
          alpha: 1.0,
          life: 0,
          maxLife: life,
        });
        if (idx >= 0) {
          spawned++;
        }
      }
    }

    return spawned;
  }
}
