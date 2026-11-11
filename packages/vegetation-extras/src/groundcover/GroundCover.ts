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
import { packInstancePose } from "@small-world-machine/engine";

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
  let h = hash3(w, x, y) ^ (z | 0);
  // Full murmur3 fmix32 avalanche. A single multiply leaves the high bits (the ones `hash01`
  // reads) LINEAR in a small consecutive `z` (slot key), so per-slot jitter channels became
  // collinear and blades lined up on a few diagonals per tile (visible streaks/patches).
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Unit hash in [0, 1). */
function hash01(value: number): number {
  return value / 0x100000000;
}

export class GroundCover {
  /** Preallocated record stream (position xyz + packed pose per blade); read by the field feed. */
  public readonly records: Float32Array;
  /** u32 view over {@link records}: the packed pose word (`w`) is a BIT PATTERN the shader reads
   *  via `bitcast<u32>`, never a numeric float -- it must be written through this view. */
  private readonly _recordBits: Uint32Array;

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
  /** @derived Nominal blade occupancy share of the slot grid (`bladesPerTile / slotsPerTile`, ≤ 1);
   * scales the per-tile accept threshold so every slot grid emits `bladesPerTile` blades on average. */
  private readonly _baseSlotCoverage: number;

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
    this._baseSlotCoverage = bladesPerTile / this.slotsPerTile;
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
    this._recordBits = new Uint32Array(this.records.buffer);
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
    const cameraClear2 = cameraClear * cameraClear;
    const maxR2 = this.radius * this.radius;
    const fullR = this._fullDensityRadius;
    const minDensity = this._minDensity;
    const baseCoverage = this._baseSlotCoverage;
    const halfCell = cell * 0.5;
    const span = Math.max(1e-6, this.radius - fullR);
    let out = 0;

    const tx0 = Math.floor((cameraX - this.radius) / cell);
    const tx1 = Math.floor((cameraX + this.radius) / cell);
    const tz0 = Math.floor((cameraZ - this.radius) / cell);
    const tz1 = Math.floor((cameraZ + this.radius) / cell);

    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const tileX = (tx + 0.5) * cell;
        const tileZ = (tz + 0.5) * cell;
        const dx = tileX - cameraX;
        const dz = tileZ - cameraZ;
        const ax = Math.abs(dx);
        const az = Math.abs(dz);
        // Conservative tile cull only: the NEAREST tile corner outside the ring (whole tile too
        // far) or the FARTHEST corner inside the camera-clear disc (whole tile dropped anyway).
        // Exact per-blade gates below make the precise decisions -- tiles never pop as a block.
        const nearX = Math.max(0, ax - halfCell);
        const nearZ = Math.max(0, az - halfCell);
        if (nearX * nearX + nearZ * nearZ > maxR2) continue;
        const farX = ax + halfCell;
        const farZ = az + halfCell;
        if (farX * farX + farZ * farZ < cameraClear2) continue;
        const dist = Math.sqrt(dx * dx + dz * dz);

        // Stable per-tile thinning + density variance (never a function of the slot).
        const tileK =
          TILE_DENSITY_MIN +
          hash01(hash4(seed, tx, tz, 0x10f0)) * (TILE_DENSITY_MAX - TILE_DENSITY_MIN);
        const t = dist <= fullR ? 0 : Math.min(1, (dist - fullR) / span);
        // Smoothstep falloff: FULL density at t=0, thinning floor `minDensity` at t=1 (INVERTED
        // from the pre-audit form that thinned near the camera and densified toward the ring).
        const s = t * t * (3 - 2 * t);
        const thin = 1 - (1 - minDensity) * s;
        // Slot-grid coverage: `slotsPerTile` rounds up to a square (ceil(sqrt(bladesPerTile)))^2,
        // so the accept probability must scale by bladesPerTile / slotsPerTile or non-square
        // blade counts would over-spawn ~+33% inside the full-density disc.
        const threshold = baseCoverage * thin * tileK;

        for (let s = 0; s < slots; s++) {
          const slotKey = s; // unique per tile; 4 hash channels below reuse it with suffixes
          if (hash01(hash4(seed, tx, tz, slotKey)) >= threshold) continue;
          if (out >= this.capacity) break;
          const jx = hash01(hash4(seed, tx, tz, slotKey + 0x100000));
          const jz = hash01(hash4(seed, tx, tz, slotKey + 0x200000));
          const px = tileX + (jx - 0.5) * cell;
          const pz = tileZ + (jz - 0.5) * cell;
          // Exact per-blade distance gates: blades inside the camera-clear disc or past the outer
          // ring are dropped individually -- even at tile corners the clear disc empties smoothly.
          const bx = px - cameraX;
          const bz = pz - cameraZ;
          const bladeDist2 = bx * bx + bz * bz;
          if (bladeDist2 < cameraClear2 || bladeDist2 > maxR2) continue;
          const yaw01 = hash01(hash4(seed, tx, tz, slotKey + 0x300000));
          const scale01 = hash01(hash4(seed, tx, tz, slotKey + 0x400000));
          const o = out * 4;
          rec[o] = px;
          rec[o + 1] = 0;
          rec[o + 2] = pz;
          // Bit pattern, not a number: `rec[o + 3] = packed` would store the float VALUE of the
          // u32 and the shader's `bitcast<u32>` would decode a garbage scale (giant blades).
          this._recordBits[o + 3] = packInstancePose(
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
