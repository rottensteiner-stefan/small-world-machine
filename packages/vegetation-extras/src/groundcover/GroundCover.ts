/**
 * Camera-centred procedural ground-cover ring (ADR 0059 step 1b, source B — CPU-generated).
 *
 * Generates instance-field records for a ring of grass/cover tiles around a moving camera and
 * writes them in place into a preallocated `Float32Array` (zero-GC hot path). The showcase feeds
 * the records into a SECOND `InstanceFieldSystem` via `uploadRecords()` every frame; the frozen
 * P1 cull/compaction (frustum + projected size + optional HZB) consumes whatever bytes are
 * present, so the ring needs no engine feature and runs on every tier.
 *
 * Temporal stability (no swimming): every blade's position, yaw, scale and occupancy rank are a
 * pure hash of `(seed, tileX, tileZ, slot)` — a blade never moves between frames and never
 * changes its per-frame accept/reject order. Only the per-tile DISTANCE-thinning threshold moves
 * with the camera (stochastic accept, monotonically decreasing toward the ring edge, documented
 * V1 approximation — no blade-width compensation, no temporal smoothing yet). The ring edge is
 * additionally faded by the field lane's own projected-size cull far before `radius`.
 *
 * @fixed Record layout is the frozen engine contract: position (3 f32) + packed pose u32
 *         (`packInstancePose`); the ring never allocates after construction.
 */
import { packInstancePose } from "@small-world-machine/engine/core/InstanceField.js";

export interface GroundCoverOptions {
  /** Ring outer radius in metres. Default 160. */
  radius?: number;
  /** Tile edge length in metres. Default 5. */
  cellSize?: number;
  /** Nominal blade slots per tile (occupancy is hash-varied around this). Default 12. */
  bladesPerTile?: number;
  /** Deterministic base hash seed. Default 1. */
  seed?: number;
  /** Distance (m) within which tiles are emitted at full density (no thinning). Default 60. */
  fullDensityRadius?: number;
  /** Occupancy multiplier at the ring edge (thinning floor, > 0). Default 0.3. */
  minDensity?: number;
  /** Blades inside this disc around the camera are dropped (personal-space cut). Default 2. */
  cameraClearRadius?: number;
  /** Prototype-relative scale range of an emitted blade. Default [0.6, 1.6]. */
  scaleRange?: readonly [number, number];
}

const DEFAULT_RADIUS = 160;
const DEFAULT_CELL_SIZE = 5;
const DEFAULT_BLADES_PER_TILE = 12;
const DEFAULT_SEED = 1;
const DEFAULT_FULL_DENSITY_RADIUS = 60;
const DEFAULT_MIN_DENSITY = 0.3;
const DEFAULT_CAMERA_CLEAR_RADIUS = 2;
const DEFAULT_SCALE_RANGE: readonly [number, number] = [0.6, 1.6];
/** Occupancy variance per tile (hash-derived density multiplier, stable). */
const TILE_DENSITY_MIN = 0.7;
const TILE_DENSITY_MAX = 1.35;

/** Stable 32-bit integer hash of three integers (avalanche mix; allocation-free). */
function hash3(a: number, b: number, c: number): number {
  let h = Math.imul((a | 0) + 0x9e3779b1, 0x85ebca77);
  h = Math.imul(h ^ ((b | 0) + 0xc2b2ae3d), 0x27d4eb2f);
  h = Math.imul(h ^ ((c | 0) + 0x165667b1), 0x165667b1);
  h = (h ^ (h >>> 15)) >>> 0;
  return h >>> 0;
}

/** Stable 32-bit integer hash of four integers (channel separation via a mixing suffix). */
function hash4(w: number, x: number, y: number, z: number): number {
  let h = hash3(w, x, y);
  h = Math.imul(h ^ (z | 0), 0x85ebca6b);
  h = (h ^ (h >>> 13)) >>> 0;
  return h >>> 0;
}

/** Unit hash in [0, 1). */
function hash01(value: number): number {
  return value / 0x100000000;
}

export class GroundCover {
  /** Preallocated record stream (position xyz + packed pose per blade); read by the field feed. */
  public readonly records: Float32Array;

  public readonly radius: number;
  public readonly cellSize: number;
  public readonly seed: number;
  public readonly bladesPerTile: number;

  /** Slot grid edge = smallest square grid covering `bladesPerTile` slots. */
  public readonly slotsPerTile: number;
  /** Worst-case record capacity = every slot of every in-range tile occupied. */
  public readonly capacity: number;
  /** Record count written by the last {@link update} call. */
  public count = 0;

  private readonly _fullDensityRadius: number;
  private readonly _minDensity: number;
  private readonly _cameraClearRadius: number;
  private readonly _scaleMin: number;
  private readonly _scaleSpan: number;
  private readonly _tileRadius: number;

  constructor(options: GroundCoverOptions = {}) {
    const radius = options.radius ?? DEFAULT_RADIUS;
    const cellSize = options.cellSize ?? DEFAULT_CELL_SIZE;
    const bladesPerTile = Math.max(1, Math.floor(options.bladesPerTile ?? DEFAULT_BLADES_PER_TILE));
    this.radius = Math.max(cellSize * 2, radius);
    this.cellSize = cellSize;
    this.seed = Math.floor(options.seed ?? DEFAULT_SEED);
    this.bladesPerTile = bladesPerTile;
    const grid = Math.max(1, Math.ceil(Math.sqrt(bladesPerTile)));
    this.slotsPerTile = grid * grid;
    this._fullDensityRadius = Math.max(0, options.fullDensityRadius ?? DEFAULT_FULL_DENSITY_RADIUS);
    this._minDensity = Math.min(1, Math.max(0.05, options.minDensity ?? DEFAULT_MIN_DENSITY));
    this._cameraClearRadius = Math.max(0, options.cameraClearRadius ?? DEFAULT_CAMERA_CLEAR_RADIUS);
    const scale = options.scaleRange ?? DEFAULT_SCALE_RANGE;
    this._scaleMin = scale[0];
    this._scaleSpan = Math.max(0, scale[1] - scale[0]);

    // Worst case = the whole disc inside `radius` (cameraClear is tiny, ignorable): every tile
    // of a bounding square of width 2·radius fully occupied. Over-allocate is safe (capacity is
    // a preallocated buffer upper bound, never written beyond).
    this._tileRadius = Math.ceil(this.radius / cellSize);
    this.capacity = (2 * this._tileRadius + 1) * (2 * this._tileRadius + 1) * this.slotsPerTile;
    this.records = new Float32Array(this.capacity * 4);
  }

  /**
   * Re-generates the camera-centred ring into {@link records} (in place, zero allocation) and
   * returns the new record count (mirrored in {@link count}).
   * @param cameraX world X of the ring centre (camera position)
   * @param cameraZ world Z of the ring centre
   */
  public update(cameraX: number, cameraZ: number): number {
    const rec = this.records;
    const cell = this.cellSize;
    const slots = this.slotsPerTile;
    const seed = this.seed;
    const cameraClear = this._cameraClearRadius;
    const fullR = this._fullDensityRadius;
    const radius = this.radius;
    const minDensity = this._minDensity;
    const span = Math.max(1e-6, radius - fullR);
    let out = 0;

    const tx0 = Math.floor((cameraX - radius) / cell);
    const tx1 = Math.floor((cameraX + radius) / cell);
    const tz0 = Math.floor((cameraZ - radius) / cell);
    const tz1 = Math.floor((cameraZ + radius) / cell);

    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const tileX = (tx + 0.5) * cell;
        const tileZ = (tz + 0.5) * cell;
        const dx = tileX - cameraX;
        const dz = tileZ - cameraZ;
        const d2 = dx * dx + dz * dz;
        if (d2 > radius * radius || d2 < cameraClear * cameraClear) continue;
        const dist = Math.sqrt(d2);

        // Stable per-tile thinning + density variance (never a function of the slot).
        const tileK =
          TILE_DENSITY_MIN +
          hash01(hash4(seed, tx, tz, 0x10f0)) * (TILE_DENSITY_MAX - TILE_DENSITY_MIN);
        const t = dist <= fullR ? 0 : Math.min(1, (dist - fullR) / span);
        // Smoothstep falloff: full density at t=0, thinning floor `minDensity` at t=1.
        const thin = t <= 0 ? 1 : minDensity + (1 - minDensity) * (t * t * (3 - 2 * t));
        if (thin <= 0) continue;
        const threshold = thin * tileK;

        for (let s = 0; s < slots; s++) {
          const slotKey = s; // unique per tile; 4 hash channels below reuse it with suffixes
          if (hash01(hash4(seed, tx, tz, slotKey)) >= threshold) continue;
          if (out >= this.capacity) break;
          const jx = hash01(hash4(seed, tx, tz, slotKey + 0x100000));
          const jz = hash01(hash4(seed, tx, tz, slotKey + 0x200000));
          const px = tileX + (jx - 0.5) * cell;
          const pz = tileZ + (jz - 0.5) * cell;
          const yaw01 = hash01(hash4(seed, tx, tz, slotKey + 0x300000));
          const scale01 = hash01(hash4(seed, tx, tz, slotKey + 0x400000));
          const o = out * 4;
          rec[o] = px;
          rec[o + 1] = 0;
          rec[o + 2] = pz;
          rec[o + 3] = packInstancePose(
            yaw01 * Math.PI * 2,
            this._scaleMin + scale01 * this._scaleSpan,
          );
          out++;
        }
        if (out >= this.capacity) break;
      }
      if (out >= this.capacity) break;
    }
    this.count = out;
    return out;
  }
}
