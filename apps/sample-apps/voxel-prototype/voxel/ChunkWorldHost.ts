import { Object3D } from "@small-world-machine/engine";
import type { Scene } from "@small-world-machine/engine";
import { Chunk } from "./Chunk.js";
import type { BlockMaterial } from "./material/BlockMaterial.js";
import type { VoxelMeshData } from "./mesh/NaiveMesher.js";
import { VoxelChunkGeometry } from "./mesh/VoxelChunkGeometry.js";

/**
 * App-level host glue between the pure `ChunkWorld` (lifecycle + dispatch) and the engine scene
 * (dossier §3.2 "Chunk-Object3D-Host-Verwaltung", §5 S2: main thread ONLY decides and hosts).
 *
 * The worker returns neighbour-aware mesh DATA; this class materializes it as the standard
 * "one `Object3D` per chunk" pattern (bounds, frustum culling, static draw) -- exactly the M0
 * contract, now in the streaming life of the world. The node's world origin is
 * `(cx * Chunk.SIZE, 0, cz * Chunk.SIZE)` because the mesher emits LOCAL chunk coordinates
 * (0..SIZE on X/Z). KEEP THIS CLASS THIN: all logic lives in `ChunkWorld` / the pure mesher;
 * this only turns a structured-cloned outcome into a scene node and back.
 */
export class ChunkWorldHost {
  private readonly _scene: Scene;
  private readonly _material: BlockMaterial;
  private readonly _nodes = new Map<string, Object3D>();
  private _triangleCount: number = 0;

  constructor(scene: Scene, material: BlockMaterial) {
    this._scene = scene;
    this._material = material;
  }

  /** Number of chunks currently hosted in the scene. */
  public get nodeCount(): number {
    return this._nodes.size;
  }

  /** Total triangles across all hosted chunk meshes (for the stats overlay). */
  public get triangleCount(): number {
    return this._triangleCount;
  }

  /**
   * Hosts a freshly meshed chunk. Ignored if (cx, cz) is already hosted (the ChunkWorld phase
   * machine guarantees exactly-once, so this only guards against a duplicated callback).
   */
  public onMeshReady(cx: number, cz: number, mesh: VoxelMeshData): void {
    const key = ChunkWorldHost._key(cx, cz);
    if (this._nodes.has(key)) return; // defensive: exactly-once is ChunkWorld's contract

    const node = new Object3D(`chunk_${cx}_${cz}`);
    node.geometry = new VoxelChunkGeometry(mesh).getGeometryData();
    node.material = this._material;
    node.position.set(cx * Chunk.SIZE, 0, cz * Chunk.SIZE);
    node.frustumCulled = true;
    node.computeBounds();
    this._scene.add(node);
    this._nodes.set(key, node);
    this._triangleCount += mesh.triangleCount;
  }

  /** Evicts the hosted node for (cx, cz) when the world unloads the chunk. */
  public onUnload(cx: number, cz: number): void {
    const node = this._nodes.get(ChunkWorldHost._key(cx, cz));
    if (!node) return; // a chunk may be evicted before it ever meshed
    this._scene.remove(node);
    this._nodes.delete(ChunkWorldHost._key(cx, cz));
  }

  /** Removes every hosted node (teardown). */
  public destroy(): void {
    for (const node of this._nodes.values()) {
      this._scene.remove(node);
    }
    this._nodes.clear();
    this._triangleCount = 0;
  }

  private static _key(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }
}
