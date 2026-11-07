import type { AbstractMaterial } from "@small-world-machine/engine";
import { BasicMaterial, Color, InstancedMesh, Plane, Vector3D } from "@small-world-machine/engine";

/**
 * Facing mode for trail ribbon segments.
 * - `camera`: each segment rotates into the camera-plane (full camera-aligned billboarding).
 * - `upLocked`: ribbons stay horizontal (rotate around world +Y only); more stable on trails
 *   that curl vertically.
 */
export type TrailBillboardMode = "camera" | "upLocked";

/**
 * Configuration options for {@link ParticleTrailRenderer}.
 */
export interface ParticleTrailRendererOptions {
  /** Name of the underlying InstancedMesh. Defaults to "ParticleTrailRenderer". */
  name?: string;
  /**
   * Material for the ribbon segments. Must consume the instance color (the base shaders
   * multiply it under `USE_INSTANCE_COLOR`). Defaults to a transparent alpha-blended
   * `BasicMaterial` with a white tint.
   */
  material?: AbstractMaterial | undefined;
  /**
   * Ring capacity: the maximum number of history samples retained before the oldest is
   * overwritten. Defaults to 512.
   * @domain trail ring capacity (>1)
   */
  maxHistory?: number | undefined;
  /** Full ribbon width in meters at the freshest segment. Defaults to 0.2. */
  width?: number | undefined;
  /**
   * Minimum node movement between recorded samples (world meters). Smaller values produce
   * denser, smoother ribbons for high-speed nodes. Defaults to 0.05.
   * @domain sample spacing (meters, >0)
   */
  minStep?: number | undefined;
  /** Seconds a sample lives before its segment fades out completely. Defaults to 0.8. */
  fadeTime?: number | undefined;
  /** Segment facing, see {@link TrailBillboardMode}. Defaults to `"camera"`. */
  billboard?: TrailBillboardMode | undefined;
  /** Base tint multiplied with the per-segment tail fade. Defaults to white. */
  color?: Color | undefined;
  /** Master opacity of the whole ribbon (0..1). Defaults to 1. */
  alpha?: number | undefined;
}

/**
 * Camera-aligned ribbon trail behind a tracked node, rendered as an `InstancedMesh` of one quad
 * per segment (two triangles each). History lives in a fixed-capacity ring of `Float32Array`
 * buffers; every `update` is zero-allocation. Each frame the live segment range is compacted
 * into the instance-matrix/color prefix and `instanceCount` is set to that live count, so the
 * existing stream contract (partial high-water upload + zero-count draw skip on all renderers)
 * applies unchanged -- a trail with no history draws nothing.
 *
 * The per-segment instance matrix maps the unit `Plane` to a segment between two consecutive
 * history samples: column 2 = segment direction scaled by its length, column 0 = camera-aligned
 * width basis (trig-free, same math family as `ParticleMeshRenderer`), translation = segment
 * midpoint. The instanced color alpha carries the tail fade, and the width is folded by the same
 * fade so the ribbon tapers instead of ending in a hard transparent edge.
 *
 * @invariant TRAIL-ZERO-ALLOC: `update` performs zero heap allocation (ring, compaction and
 *   basis math all write into preallocated typed arrays).
 * @invariant TRAIL-GEOMETRY-VALID: every emitted segment connects exactly two consecutive live
 *   history samples (its translation is the midpoint of those samples and its length axis spans
 *   them), so the ribbon is a connected chain with no gaps or duplicated vertices.
 */
export class ParticleTrailRenderer {
  public readonly mesh: InstancedMesh;

  /** @domain number of live history samples retained (ring capacity). */
  public readonly maxHistory: number;
  /** @domain full ribbon width in meters at the freshest segment. */
  public width: number;
  /** @domain minimum node movement between recorded samples (meters). */
  public minStep: number;
  /** @domain seconds a sample lives before it fades out. */
  public fadeTime: number;
  /** @domain billboard facing mode (`"camera"` | `"upLocked"`). */
  public billboard: TrailBillboardMode;
  /** @domain base ribbon tint. */
  public color: Color;
  /** @domain master ribbon opacity in [0,1]. */
  public alpha: number;

  private readonly _points: Float32Array;
  private readonly _ages: Float32Array;
  /** Ring index of the newest sample (conceptually `-1` while empty: the first write lands at 0). */
  private _head = 0;
  /** Ring index of the oldest live sample. */
  private _tail = 0;
  /**
   * Number of live samples. Ring invariant: live samples live at moments `tail..head` (mod n) in
   * insertion order; `_head` is initialized to `n - 1` so the first record writes slot 0.
   */
  private _count = 0;
  private _hasLast = false;
  private readonly _lastRecorded: Vector3D;
  private readonly _dir: Vector3D;
  private readonly _right: Vector3D;
  private readonly _up: Vector3D;
  private readonly _toCam: Vector3D;
  private readonly _mid: Vector3D;
  private readonly _upAxis: Vector3D;

  constructor(options: ParticleTrailRendererOptions = {}) {
    this.maxHistory = Math.max(2, Math.floor(options.maxHistory ?? 512));
    this.width = Math.max(0, options.width ?? 0.2);
    this.minStep = Math.max(1e-4, options.minStep ?? 0.05);
    this.fadeTime = Math.max(1e-3, options.fadeTime ?? 0.8);
    this.billboard = options.billboard ?? "camera";
    this.color = new Color(1, 1, 1, 1).copyFrom(options.color ?? new Color(1, 1, 1, 1));
    this.alpha = Math.min(1, Math.max(0, options.alpha ?? 1));

    let material = options.material;
    if (!material) {
      const m = new BasicMaterial({ color: new Color(1, 1, 1, 1) });
      m.transparent = true;
      material = m;
    }

    const unitPlane = new Plane({ width: 1, height: 1 }).getGeometryData();
    this.mesh = new InstancedMesh(
      options.name ?? "ParticleTrailRenderer",
      unitPlane,
      material,
      this.maxHistory - 1,
    );
    // A 1x1 centered quad already spans two units; normalize the local extent so the instance
    // matrix rows are world meters directly.
    this.mesh.instanceMatrices.fill(0);
    this.mesh.initInstanceData(4); // r, g, b, a per segment
    this.mesh.useInstanceDataAsColor = true;

    this._points = new Float32Array(this.maxHistory * 3);
    this._ages = new Float32Array(this.maxHistory);
    // The ring is empty when `_count === 0`; with _head = n-1 the first record writes slot 0.
    this._head = this.maxHistory - 1;
    this._lastRecorded = new Vector3D(0, 0, 0);
    this._dir = new Vector3D(0, 0, 0);
    this._right = new Vector3D(0, 0, 0);
    this._up = new Vector3D(0, 0, 0);
    this._toCam = new Vector3D(0, 0, 0);
    this._mid = new Vector3D(0, 0, 0);
    this._upAxis = new Vector3D(0, 1, 0);
  }

  /**
   * Number of live history samples (read-only). Zero live samples draw nothing.
   */
  public get liveSamples(): number {
    return this._count;
  }

  /**
   * Advances the trail by one tick: ages every sample, drops expired ones, records a new sample
   * when the node moved at least `minStep` since the last recorded one, then rebuilds the live
   * segments into the instance buffers.
   *
   * @param deltaTime Seconds; 0 freezes the trail (no aging, no recording).
   * @param nodePosition Current world position of the tracked node.
   * @param cameraPosition World position of the camera (for camera-aligned facing).
   */
  public update(deltaTime: number, nodePosition: Vector3D, cameraPosition: Vector3D): void {
    const n = this.maxHistory;

    // --- Age + expire (drop from the tail). ---
    if (deltaTime > 0) {
      for (let k = 0; k < this._count; k++) {
        const idx = (this._tail + k) % n;
        this._ages[idx] = this._ages[idx]! + deltaTime;
      }
      while (this._count > 0 && this._ages[this._tail]! > this.fadeTime) {
        this._tail = (this._tail + 1) % n;
        this._count--;
      }
    }

    // --- Record a new sample when the node moved far enough. ---
    const dx = nodePosition.x - this._lastRecorded.x;
    const dy = nodePosition.y - this._lastRecorded.y;
    const dz = nodePosition.z - this._lastRecorded.z;
    const moved = !this._hasLast || dx * dx + dy * dy + dz * dz >= this.minStep * this.minStep;
    if (deltaTime > 0 && moved) {
      const slot = (this._head + 1) % n;
      if (this._count === n) {
        this._tail = (this._tail + 1) % n;
      } else {
        this._count++;
      }
      this._head = slot;
      const o = slot * 3;
      this._points[o] = nodePosition.x;
      this._points[o + 1] = nodePosition.y;
      this._points[o + 2] = nodePosition.z;
      this._ages[slot] = 0;
      this._lastRecorded.copyFrom(nodePosition);
      this._hasLast = true;
    }

    // --- Rebuild live segments into the instance prefix (zero allocation). ---
    const live = this._count;
    let written = 0; // compacted write index: degenerate segments are skipped, not left stale
    const matrices = this.mesh.instanceMatrices;
    const instanceData = this.mesh.instanceData;

    for (let k = 1; k < live; k++) {
      // Consecutive samples only: segment k spans sample (k-1) -> sample k.
      const sIdx = (this._tail + k - 1) % n;
      const eIdx = (this._tail + k) % n;
      const s = sIdx * 3;
      const e = eIdx * 3;

      const sx = this._points[s]!;
      const sy = this._points[s + 1]!;
      const sz = this._points[s + 2]!;
      const ex = this._points[e]!;
      const ey = this._points[e + 1]!;
      const ez = this._points[e + 2]!;

      // Segment direction + length.
      this._dir.set(ex - sx, ey - sy, ez - sz);
      const length = this._dir.length();
      if (length < 1e-6) {
        continue;
      }
      const invL = 1 / length;
      this._dir.scale(invL);

      // Tail fade: 1 at the head, 0 right before the sample expires.
      const age = Math.max(this._ages[sIdx]!, this._ages[eIdx]!);
      const fade = Math.max(0, Math.min(1, 1 - age / this.fadeTime));
      const segWidth = this.width * fade;

      // Camera-aligned width basis (trig-free).
      this._mid.set(sx + ex, sy + ey, sz + ez).scale(0.5);
      this._toCam.set(
        cameraPosition.x - this._mid.x,
        cameraPosition.y - this._mid.y,
        cameraPosition.z - this._mid.z,
      );
      if (this.billboard === "upLocked") {
        this._right.set(
          this._dir.y * this._upAxis.z - this._dir.z * this._upAxis.y,
          this._dir.z * this._upAxis.x - this._dir.x * this._upAxis.z,
          this._dir.x * this._upAxis.y - this._dir.y * this._upAxis.x,
        );
        if (this._right.lengthSq() < 1e-8) {
          this._right.set(1, 0, 0);
        }
      } else {
        this._right.set(
          this._dir.y * this._toCam.z - this._dir.z * this._toCam.y,
          this._dir.z * this._toCam.x - this._dir.x * this._toCam.z,
          this._dir.x * this._toCam.y - this._dir.y * this._toCam.x,
        );
        if (this._right.lengthSq() < 1e-8) {
          // Camera sits on the trail line: fall back to a horizontal width basis.
          this._right.set(
            this._dir.y * this._upAxis.z - this._dir.z * this._upAxis.y,
            this._dir.z * this._upAxis.x - this._dir.x * this._upAxis.z,
            this._dir.x * this._upAxis.y - this._dir.y * this._upAxis.x,
          );
        }
        if (this._right.lengthSq() < 1e-8) {
          // Vertical trail as seen from the line: any perpendicular direction stays visible.
          this._right.set(1, 0, 0);
        }
      }
      const invR = 1 / Math.sqrt(this._right.lengthSq());
      this._right.scale(invR);

      // Local +Y = segment direction (completes the ribbon frame).
      this._up.set(this._dir.x, this._dir.y, this._dir.z);

      const off = written * 16;
      const wx = this._right.x * segWidth;
      const wy = this._right.y * segWidth;
      const wz = this._right.z * segWidth;
      const ux = this._up.x * length;
      const uy = this._up.y * length;
      const uz = this._up.z * length;

      matrices[off] = wx;
      matrices[off + 1] = wy;
      matrices[off + 2] = wz;
      matrices[off + 3] = 0;
      matrices[off + 4] = ux;
      matrices[off + 5] = uy;
      matrices[off + 6] = uz;
      matrices[off + 7] = 0;
      matrices[off + 8] = 0;
      matrices[off + 9] = 0;
      matrices[off + 10] = segWidth;
      matrices[off + 11] = 0;
      matrices[off + 12] = this._mid.x;
      matrices[off + 13] = this._mid.y;
      matrices[off + 14] = this._mid.z;
      matrices[off + 15] = 1;

      if (instanceData) {
        const cOff = written * 4;
        instanceData[cOff] = this.color.r;
        instanceData[cOff + 1] = this.color.g;
        instanceData[cOff + 2] = this.color.b;
        instanceData[cOff + 3] = fade * this.alpha;
      }
      written++;
    }

    this.mesh.instanceCount = written;
    this.mesh.instanceMatrixNeedsUpdate = true;
    if (instanceData) {
      this.mesh.instanceDataNeedsUpdate = true;
    }
  }

  /**
   * Removes the ribbon mesh from its parent node. Safe to call twice.
   *
   * Resets the ring to the same state as construction (`_head = maxHistory - 1`), so a reused
   * trail object writes its first sample into slot 0 again -- matching the constructor invariant
   * and keeping `_tail` pointing at a freshly-written slot (no stale first segment).
   */
  public dispose(): void {
    this.mesh.instanceCount = 0;
    this.mesh.parent?.remove(this.mesh);
    this._count = 0;
    this._head = this.maxHistory - 1;
    this._tail = 0;
    this._hasLast = false;
  }
}
