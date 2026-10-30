import type { CornerDir, FaceDir, MeshBlockDescriptorEntry } from "../mesh/NaiveMesher.js";
import type {
  MeshClient,
  MeshOutcome,
  MeshWorkerRequest,
  MeshWorkerResponse,
} from "./MeshWorkerProtocol.js";

/**
 * M7 production `MeshClient`: a small POOL of dedicated mesh workers behind the UNCHANGED
 * `MeshClient` contract. `ChunkWorld` consumes the exact same surface as the single-worker M1
 * client, so the streaming/lifecycle logic never learns about parallelism -- it is purely a
 * transport concern inside this class.
 *
 * Design (backlog "voxel multi-worker pool"):
 *  - `workerCount` independent `mesh.worker.ts` module workers. World generation and mesh building
 *    stay off the main thread; each worker keeps the M1 two-role split (`generate`/`mesh`).
 *  - Task ids are GLOBALLY unique across the whole pool. A per-worker counter would collide as
 *    soon as two workers answered with the same id -- responses are routed per arena instead, so
 *    id space is shared safely.
 *  - Tasks are round-robined over the live arenas. Each worker executes its own queue serially,
 *    so `workerCount` arenas yield up to `workerCount` concurrent mesh tasks without races.
 *  - A crashing arena (`onerror`) rejects only its in-flight tasks and is replaced in-place by a
 *    freshly spawned, re-configured worker. The world's fail-soft `_onError` path regenerates the
 *    affected chunk via the streaming loop; the pool keeps its size and routing stays sound.
 *  - `workerCount` and `createWorker` are injectable so routing/error logic is deterministically
 *    node-testable without a real `Worker` (which does not exist in node).
 */

/** Structural worker surface this pool needs. The real `Worker` satisfies it structurally. */
interface WorkerLike {
  postMessage(message: MeshWorkerRequest): void;
  terminate(): void;
  onmessage: ((ev: { data: MeshWorkerResponse }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

/** One in-flight task on exactly one arena (its responses are routed by that arena's closure). */
type PendingTask =
  | { kind: "data"; resolve: (value: Uint8Array) => void; reject: (reason: unknown) => void }
  | { kind: "mesh"; resolve: (value: MeshOutcome) => void; reject: (reason: unknown) => void };

interface Arena {
  worker: WorkerLike;
  pending: Map<number, PendingTask>;
}

export interface MeshWorkerPoolOptions {
  /** Number of worker arenas. Default: clamp(hardwareConcurrency - 1, 1, 4). */
  workerCount?: number;
  /** Injectable worker factory (node tests). Defaults to a real Vite module worker. */
  createWorker?: () => WorkerLike;
}

/** Production worker spawn -- the lexical `new Worker(new URL(...))` form is exactly what Vite's
 *  module-worker transform detects and emits as its own chunk (same proof as M1). The cast spans
 *  the DOM `Worker` surface (overloaded `postMessage`, `this`-typed handlers) to the narrowed
 *  structural `WorkerLike` this class needs. */
function spawnModuleWorker(): WorkerLike {
  return new Worker(new URL("./mesh.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as WorkerLike;
}

function defaultWorkerCount(): number {
  if (typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number") {
    const n = navigator.hardwareConcurrency;
    if (Number.isFinite(n) && n >= 1) return Math.min(4, Math.max(1, Math.floor(n) - 1));
  }
  return 2; // unknown/headless environment: small pool, still exercises the pool path
}

export class MeshWorkerPoolClient implements MeshClient {
  private readonly _arenas: Arena[] = [];
  private readonly _createWorker: () => WorkerLike;
  private _nextId: number = 1;
  private _roundRobin: number = 0;
  private _configured: boolean = false;
  private _seed: number = 0;
  private _descriptor: readonly MeshBlockDescriptorEntry[] = [];
  private _destroyed: boolean = false;

  constructor(options: MeshWorkerPoolOptions = {}) {
    const workerCount = Math.max(1, Math.floor(options.workerCount ?? defaultWorkerCount()));
    this._createWorker = options.createWorker ?? spawnModuleWorker;
    for (let i = 0; i < workerCount; i++) this._spawnArena();
  }

  /** Number of live worker arenas (QA/stats proof the pool is active, not a single worker). */
  public get workerCount(): number {
    return this._arenas.length;
  }

  public configure(seed: number, descriptor: readonly MeshBlockDescriptorEntry[]): void {
    this._seed = seed;
    this._descriptor = descriptor;
    this._configured = true;
    for (const arena of this._arenas) {
      arena.worker.postMessage({ kind: "init", seed, descriptor });
    }
  }

  public generate(cx: number, cz: number): Promise<Uint8Array> {
    const arena = this._nextArena();
    const id = this._nextId++;
    return new Promise<Uint8Array>((resolve, reject) => {
      arena.pending.set(id, { kind: "data", resolve, reject });
      arena.worker.postMessage({ kind: "generate", id, cx, cz });
    });
  }

  public mesh(
    cx: number,
    cz: number,
    voxels: Uint8Array,
    neighbors: Partial<Record<FaceDir, Uint8Array>>,
    neighborCorners?: Partial<Record<CornerDir, Uint8Array>>,
    useGreedy: boolean = true,
  ): Promise<MeshOutcome> {
    const arena = this._nextArena();
    const id = this._nextId++;
    return new Promise<MeshOutcome>((resolve, reject) => {
      arena.pending.set(id, { kind: "mesh", resolve, reject });
      arena.worker.postMessage({
        kind: "mesh",
        id,
        cx,
        cz,
        voxels,
        neighbors,
        // `exactOptionalPropertyTypes`: only include the optional key when actually provided.
        ...(neighborCorners !== undefined ? { neighborCorners } : {}),
        useGreedy,
      });
    });
  }

  public destroy(): void {
    this._destroyed = true;
    for (const arena of this._arenas) {
      arena.worker.terminate();
      for (const task of arena.pending.values()) {
        task.reject(new Error("mesh worker pool destroyed"));
      }
      arena.pending.clear();
    }
    this._arenas.length = 0;
  }

  // --- internals ---

  private _spawnArena(): void {
    const arena: Arena = { worker: this._createWorker(), pending: new Map() };
    arena.worker.onmessage = (ev: { data: MeshWorkerResponse }): void =>
      this._onArenaMessage(arena, ev.data);
    arena.worker.onerror = (ev: unknown): void => this._onArenaError(arena, ev);
    if (this._configured) {
      arena.worker.postMessage({ kind: "init", seed: this._seed, descriptor: this._descriptor });
    }
    this._arenas.push(arena);
  }

  private _nextArena(): Arena {
    if (this._destroyed) throw new Error("[MeshWorkerPoolClient] used after destroy()");
    const count = this._arenas.length;
    if (count === 0) throw new Error("[MeshWorkerPoolClient] no worker arenas");
    const arena = this._arenas[this._roundRobin % count]!;
    this._roundRobin = (this._roundRobin + 1) % count;
    return arena;
  }

  private _onArenaMessage(arena: Arena, msg: MeshWorkerResponse): void {
    const task = arena.pending.get(msg.id);
    if (!task) return; // stale/unknown id (e.g. worker crashed mid-batch)
    arena.pending.delete(msg.id);
    switch (msg.kind) {
      case "data": {
        const taskData = task as Extract<PendingTask, { kind: "data" }>;
        taskData.resolve(msg.voxels);
        break;
      }
      case "mesh-result": {
        const taskMesh = task as Extract<PendingTask, { kind: "mesh" }>;
        taskMesh.resolve(msg.outcome);
        break;
      }
      case "error":
        task.reject(new Error(`[mesh] ${msg.message}`));
        break;
    }
  }

  private _onArenaError(arena: Arena, _ev: unknown): void {
    for (const task of arena.pending.values()) {
      task.reject(new Error("mesh worker crashed"));
    }
    arena.pending.clear();
    this._replaceArena(arena);
  }

  private _replaceArena(arena: Arena): void {
    // Terminate the crashed worker and put a freshly configured replacement at the same slot so
    // the pool keeps its size and the round-robin index never drifts.
    arena.worker.terminate();
    const worker = this._createWorker();
    worker.onmessage = (ev: { data: MeshWorkerResponse }): void =>
      this._onArenaMessage(arena, ev.data);
    worker.onerror = (ev: unknown): void => this._onArenaError(arena, ev);
    if (this._configured) {
      worker.postMessage({ kind: "init", seed: this._seed, descriptor: this._descriptor });
    }
    arena.worker = worker;
  }
}
