import { BLOCK_AIR } from "./BlockRegistry.js";
import { Chunk } from "./Chunk.js";
import type {
  CornerDir,
  FaceDir,
  MeshBlockDescriptorEntry,
  VoxelMeshData,
} from "./mesh/NaiveMesher.js";
import { buildNeighborCorner, buildNeighborRim } from "./mesh/NaiveMesher.js";
import type { MeshClient, MeshOutcome } from "./worker/MeshWorkerProtocol.js";

/**
 * M1 world/store backbone (dossier §3.2 `ChunkWorld`): owns the chunk map, the lifecycle state
 * machine (REQUESTED -> DATA -> MEShing -> READY -> UNLOAD), the streaming focus, the
 * neighbor-gated mesh dispatch and the exact-once seam contract. PURE LOGIC -- no `Object3D`, no
 * scene, no DOM, no engine import -- so the whole streaming/lifecycle can be unit-tested in node
 * against the same pure backend the worker runs (`MeshClient`).
 *
 * Thread/worker roles (dossier §5 S2): the main thread ONLY decides and dispatches. World
 * generation and mesh building never run here; a generated buffer is stored as `Chunk`-data, a
 * meshed outcome is handed to the callback (`ChunkWorldHost` creates/removes `Object3D`s).
 *
 * Seam guarantee (M1 "keine Naht"): a chunk is only meshed once its four horizontal AXIS
 * neighbors have DATA (minNeighborsToMesh, dossier §3.2). The worker then receives only the
 * neighbor border planes, and `buildMesh` culls boundary faces exactly-once (pinned by
 * `SeamMeshing.test.ts`). M2 extends the gate to the four horizontal DIAGONAL neighbors whose
 * AO corner columns (16 bytes each) keep vertex occlusion byte-identical across 4-chunk seams.
 */

/** Internal lifecycle used by the streaming state machine. */
type Phase = "generating" | "data" | "meshing" | "ready";

interface ChunkRecord {
  cx: number;
  cz: number;
  phase: Phase;
  chunk: Chunk | null; // non-null once phase >= "data"
  /** Set while a mesh is in flight if an edit mutated the voxels; the loop remeshes afterwards. */
  dirty: boolean;
}

export interface ChunkWorldCallbacks {
  /** A chunk finished meshing on the worker; the host glue creates the render node. */
  onMeshReady(cx: number, cz: number, mesh: VoxelMeshData): void;
  /** A ready chunk is being evicted; the host glue removes its render node. */
  onUnload(cx: number, cz: number): void;
}

export interface ChunkWorldOptions {
  /** The background work source (worker client in production, foreground double in tests). */
  client: MeshClient;
  /** Serializable registry subset (opacity for meshing, collidability for the player sweep). */
  descriptor: readonly MeshBlockDescriptorEntry[];
  /** World seed handed to the worker's own `TerrainGenerator`. */
  seed: number;
  /** Streaming add radius (Chebyshev, in chunks). Data is generated within it. Default 6. */
  generateRadius?: number;
  /** Suspension distance where a ready chunk is dropped (hysteresis: must be > generateRadius). */
  unloadRadius?: number;
  /** Generate/mesh dispatches budgeted per `update()` call. Default 16. */
  maxTasksPerTick?: number;
  /** Host glue (render-node lifecycle) -- injected, kept out of this pure module. */
  callbacks: ChunkWorldCallbacks;
}

export interface ChunkWorldStats {
  /** Chunks whose block data exists (including meshed ones). */
  generated: number;
  /** Chunks currently being generated or meshed (in flight). */
  inFlight: number;
  /** Chunks meshed and ready (hosted). */
  ready: number;
  /** Worker-side meshing wall time of the last completed mesh (ms). */
  meshMsLast: number;
  /** Cumulative worker-side meshing wall time (ms). 0 while nothing meshed. */
  meshMsTotal: number;
  /** Successful block edits since creation (M2, for the stats overlay + QA gate). */
  edits: number;
}

const CHUNK_SIZE = Chunk.SIZE;
function keyOf(cx: number, cz: number): string {
  return `${cx},${cz}`;
}
function chebyshev(a: number, b: number, x: number, y: number): number {
  return Math.max(Math.abs(a - x), Math.abs(b - y));
}

/** Neighbor offsets a chunk needs meshed before it can be meshed itself: the four horizontal
 *  axis-neighbors (seam-culling rims) PLUS the four horizontal diagonals (M2 AO corner columns).
 *  All 8 live in the SAME Chebyshev ring, so this can never change the reachable mesh region
 *  (meshed radius stays generateRadius-1) -- it only guarantees the AO corner data exists every
 *  time a chunk meshes, keeping vertex AO byte-identical across 4-chunk seams. */
const MESH_NEIGHBORS: readonly [number, number][] = [
  [-1, 0], // -X  (axial)
  [1, 0], // +X  (axial)
  [0, -1], // -Z  (axial)
  [0, 1], // +Z  (axial)
  [-1, -1], // -X,-Z  (diagonal)
  [1, -1], // +X,-Z  (diagonal)
  [-1, 1], // -X,+Z  (diagonal)
  [1, 1], // +X,+Z  (diagonal)
];

/** Maps a neighbor offset to the rim direction of that neighbor's plane FACING this chunk.
 *  Axial offsets only (diagonals have no face plane -- their data arrives as corner columns). */
function rimDirForNeighbor(dx: number, dz: number): FaceDir {
  // -X neighbor -> this chunk reads its localX=15 plane; +X -> localX=0; -Z -> localZ=15; +Z -> localZ=0.
  if (dx === -1) return "nx";
  if (dx === 1) return "px";
  if (dz === -1) return "nz";
  return "pz"; // dz === 1
}

/** Maps a diagonal neighbor offset to the `CornerDir` whose corner faces THIS chunk (the corner
 *  column handed to the AO of this chunk's 4-corner faces). Diagonal offsets only; the naming
 *  matches `CORNER_COLUMNS` in the pure mesher. */
function cornerDirForNeighbor(dx: number, dz: number): CornerDir {
  if (dx === -1) return dz === -1 ? "nn" : "np";
  return dz === -1 ? "pn" : "pp"; // dx === 1
}

export class ChunkWorld {
  private readonly _client: MeshClient;
  private readonly _collidable: ReadonlySet<number>;
  private readonly _callbacks: ChunkWorldCallbacks;
  private readonly _generateRadius: number;
  private readonly _unloadRadius: number;
  private readonly _maxTasksPerTick: number;

  private readonly _chunks: Map<string, ChunkRecord> = new Map();
  private _focusCx: number = 0;
  private _focusCz: number = 0;
  private _focusSet: boolean = false;
  private _meshMsTotal: number = 0;
  private _meshMsLast: number = 0;
  private _editCount: number = 0;

  constructor(options: ChunkWorldOptions) {
    this._client = options.client;
    this._collidable = new Set(options.descriptor.filter((e) => e.collidable).map((e) => e.id));
    this._callbacks = options.callbacks;
    this._generateRadius = options.generateRadius ?? 6;
    this._unloadRadius = options.unloadRadius ?? this._generateRadius + 2;
    if (this._unloadRadius <= this._generateRadius) {
      throw new Error(
        "[ChunkWorld] unloadRadius must exceed generateRadius (load/unload hysteresis)",
      );
    }
    this._maxTasksPerTick = options.maxTasksPerTick ?? 16;
    // Wire the background roles with the world seed + block semantics (fire-and-forget: the
    // worker processes messages in order, so configure always precedes the first task).
    this._client.configure(options.seed, options.descriptor);
  }

  /** Centers streaming on a world-space position (the player's feet). Cheap, call every frame. */
  public setFocus(wx: number, wz: number): void {
    this._focusCx = Math.floor(wx / CHUNK_SIZE);
    this._focusCz = Math.floor(wz / CHUNK_SIZE);
    this._focusSet = true;
  }

  /** The chunk the streaming window is currently centered on. Additive accessor for tests and
   *  the QA gate (proves the focus follows the player across chunk borders). */
  public getFocusChunk(): { cx: number; cz: number } {
    return { cx: this._focusCx, cz: this._focusCz };
  }

  /** One streaming tick -- bounded dispatch of generate/mesh tasks and unload beyond the radius. */
  public update(): void {
    if (!this._focusSet) return;
    const fx = this._focusCx;
    const fz = this._focusCz;

    // 1. Evict far chunks (only after their host was removed).
    for (const [key, rec] of Array.from(this._chunks)) {
      if (chebyshev(rec.cx, rec.cz, fx, fz) > this._unloadRadius) {
        if (rec.phase === "ready") this._callbacks.onUnload(rec.cx, rec.cz);
        this._chunks.delete(key);
      }
    }

    // 2. Generate/mesh inside the radius, nearest rings first (deterministic order, budgeted).
    let dispatched = 0;
    ring: for (let r = 0; r <= this._generateRadius; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (dispatched >= this._maxTasksPerTick) break ring;
          const cx = fx + dx;
          const cz = fz + dz;
          const rec = this._chunks.get(keyOf(cx, cz));
          if (!rec) {
            this._requestGenerate(cx, cz);
            dispatched++;
            continue;
          }
          if (rec.phase === "data" && this._tryMesh(cx, cz, rec)) {
            dispatched++;
          }
        }
      }
    }
  }

  /** World-space voxel lookup used by the player sweep. Unloaded chunk / out of column -> air. */
  public getWorldBlock(wx: number, wy: number, wz: number): number {
    const rec = this._chunks.get(keyOf(Math.floor(wx / CHUNK_SIZE), Math.floor(wz / CHUNK_SIZE)));
    if (!rec?.chunk) return BLOCK_AIR;
    const lx = ((Math.floor(wx) % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((Math.floor(wz) % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    // `Chunk.getBlock` reads out-of-band Y as air.
    return rec.chunk.getBlock(lx, Math.floor(wy), lz);
  }

  /** Whether a world cell is solid for the player sweep (registry `collidable`, not opacity). */
  public isSolidAt(wx: number, wy: number, wz: number): boolean {
    return this._collidable.has(this.getWorldBlock(wx, wy, wz));
  }

  /**
   * M2 block editing (dossier §4.2): writes a block id into the loaded column at world
   * coordinates and schedules the BOUNDED 1-chunk remesh (own chunk + horizontal neighbors whose
   * rim plane contains the edited cell -- max 5). REMESH IS DEFERRED to the streaming loop:
   * phase "ready" -> "data" (the next `update()` ring re-meshes it with current voxels + rims;
   * the edited chunk is always within reach -> ring 0/1, highest priority); phase "meshing" ->
   * only `dirty` (the in-flight result is dropped in `_onMeshReady` and the loop remeshes after
   * -- "exactly ONE valid mesh wins"). Deliberately NOT the cross-thread 3x3 view of M5: every
   * re-dispatch is an independent local `MeshClient.mesh` with fresh buffers, the worker stays
   * edit-unaware by construction.
   *
   * `id = 0` is BLOCK_AIR (break). Out-of-band Y (outside the 16-column height) or an unloaded
   * column is a no-op (returns false) -- a raycast can never target unloaded cells, because
   * unloaded columns read as air.
   */
  public setBlock(wx: number, wy: number, wz: number, id: number): boolean {
    if (wy < 0 || wy >= CHUNK_SIZE) return false;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const rec = this._chunks.get(keyOf(cx, cz));
    if (!rec?.chunk) return false;
    const lx = ((Math.floor(wx) % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((Math.floor(wz) % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const current = rec.chunk.getBlock(lx, Math.floor(wy), lz);
    if (current === id) return false;
    rec.chunk.setBlock(lx, Math.floor(wy), lz, id);
    this._editCount++;
    this._scheduleRemesh(cx, cz, lx, lz);
    return true;
  }

  public getStats(): ChunkWorldStats {
    let generated = 0;
    let inFlight = 0;
    let ready = 0;
    for (const rec of this._chunks.values()) {
      if (rec.phase === "generating" || rec.phase === "meshing") inFlight++;
      if (rec.phase === "data" || rec.phase === "meshing" || rec.phase === "ready") generated++;
      if (rec.phase === "ready") ready++;
    }
    return {
      generated,
      inFlight,
      ready,
      meshMsLast: this._meshMsLast,
      meshMsTotal: this._meshMsTotal,
      edits: this._editCount,
    };
  }

  public destroy(): void {
    for (const rec of this._chunks.values()) {
      if (rec.phase === "ready") this._callbacks.onUnload(rec.cx, rec.cz);
    }
    this._chunks.clear();
    this._client.destroy();
  }

  // --- internals ---

  private _requestGenerate(cx: number, cz: number): void {
    const rec: ChunkRecord = { cx, cz, phase: "generating", chunk: null, dirty: false };
    this._chunks.set(keyOf(cx, cz), rec);
    this._client
      .generate(cx, cz)
      .then((data) => this._onData(cx, cz, data))
      .catch((err: unknown) => this._onError(cx, cz, err));
  }

  private _onData(cx: number, cz: number, data: Uint8Array): void {
    const rec = this._chunks.get(keyOf(cx, cz));
    if (!rec || rec.phase !== "generating") return; // evicted meanwhile
    const chunk = new Chunk();
    chunk.voxels.set(data);
    rec.chunk = chunk;
    rec.phase = "data";
    // Try to mesh this chunk (neighbors may already be ready) and unblock any neighbor that was
    // waiting on OUR data.
    this._tryMesh(cx, cz, rec);
    for (const [dx, dz] of MESH_NEIGHBORS) {
      const nrec = this._chunks.get(keyOf(cx + dx, cz + dz));
      if (nrec && nrec.phase === "data") this._tryMesh(cx + dx, cz + dz, nrec);
    }
  }

  /** M2 edit remesh scheduling (see `setBlock`): own chunk + every horizontal neighbor whose rim
   *  plane contains the edited local cell. A corner cell touches two neighbors; a pure-interior
   *  cell touches none. A "data"/"generating" mate needs no action -- its future mesh reads the
   *  already-current voxels, so it is correct by construction. */
  private _scheduleRemesh(cx: number, cz: number, lx: number, lz: number): void {
    const schedule = (x: number, z: number): void => {
      const rec = this._chunks.get(keyOf(x, z));
      if (!rec?.chunk) return;
      if (rec.phase === "ready") {
        rec.phase = "data"; // streaming loop remeshes it next tick
      } else if (rec.phase === "meshing") {
        rec.dirty = true; // in-flight result must not apply stale geometry
      }
    };
    schedule(cx, cz);
    if (lx === 0) schedule(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) schedule(cx + 1, cz);
    if (lz === 0) schedule(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) schedule(cx, cz + 1);
  }

  /**
   * Dispatches a mesh task once the chunk has data AND all EIGHT horizontal neighbors (4 axials
   * for seam culling + 4 diagonals for seam-exact AO corner columns) have data. Returns false
   * while waiting -- the streaming loop retries. This is minNeighborsToMesh, now also the M2 AO
   * seam contract: without the diagonals a 4-chunk-corner vertex could only approximate its AO
   * sample, which would show as a bright leak exactly on the seam plane it is meant to hide.
   */
  private _tryMesh(cx: number, cz: number, rec: ChunkRecord): boolean {
    if (rec.phase !== "data" || !rec.chunk) return false;
    const rims: Partial<Record<FaceDir, Uint8Array>> = {};
    const corners: Partial<Record<CornerDir, Uint8Array>> = {};
    for (const [dx, dz] of MESH_NEIGHBORS) {
      const nrec = this._chunks.get(keyOf(cx + dx, cz + dz));
      if (!nrec?.chunk) return false; // not all neighbors have data yet -- wait (minNeighborsToMesh)
      if (dx === 0 || dz === 0) {
        const dir = rimDirForNeighbor(dx, dz);
        rims[dir] = buildNeighborRim(nrec.chunk.voxels, dir);
      } else {
        const dir = cornerDirForNeighbor(dx, dz);
        corners[dir] = buildNeighborCorner(nrec.chunk.voxels, dir);
      }
    }
    rec.phase = "meshing";
    const voxels = rec.chunk.voxels;
    this._client
      .mesh(cx, cz, voxels, rims, corners)
      .then((outcome: MeshOutcome) => this._onMeshReady(cx, cz, outcome))
      .catch((err: unknown) => this._onError(cx, cz, err));
    return true;
  }

  private _onMeshReady(cx: number, cz: number, outcome: MeshOutcome): void {
    const rec = this._chunks.get(keyOf(cx, cz));
    if (!rec || rec.phase !== "meshing") return;
    if (rec.dirty) {
      // The voxels were edited while this mesh was in flight -> the result is stale relative to
      // the current data. Do not apply it; hand the chunk back to the streaming loop, which
      // remeshes it with the edited data (dirty flag cleared -- "exactly ONE valid mesh wins").
      rec.dirty = false;
      rec.phase = "data";
      return;
    }
    rec.phase = "ready";
    this._meshMsLast = outcome.meshMs;
    this._meshMsTotal += outcome.meshMs;
    this._callbacks.onMeshReady(cx, cz, outcome.mesh);
  }

  private _onError(cx: number, cz: number, err: unknown): void {
    // Keep the world robust: drop the record so the next tick regenerates it (transient worker
    // errors self-heal). Persistent bugs surface in the console.
    this._chunks.delete(keyOf(cx, cz));
    console.warn(`[ChunkWorld] task failed for chunk (${cx}, ${cz}):`, err);
  }
}
