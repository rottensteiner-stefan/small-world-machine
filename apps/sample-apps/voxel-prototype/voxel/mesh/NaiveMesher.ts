import type { BlockRegistry } from "../BlockRegistry.js";
import { faceAxisForNormal } from "../BlockRegistry.js";
import { Chunk } from "../Chunk.js";

/**
 * Output of `NaiveMesher.build`: typed vertex/index arrays shaped exactly like the engine's
 * `GeometryDataInterface` but WITHOUT any engine import -- pure data so it stays testable in
 * node and structured-clone-able for the future M1 worker meshing handoff
 * (`postMessage`-Transferables, auto-extracted by the engine's `ThreadPool`).
 *
 * Per-vertex `colors` packs the atlas layer in `.r` (the engine binds `colors` at the fixed
 * attribute location 11 / `a_color`, read by the block shader); `.g/.b/.a` are left at 1.
 */
export interface VoxelMeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  indices: Uint16Array | Uint32Array;
  triangleCount: number;
}

/** A face template: outward normal N, and tangent axes (TA, TB) with `cross(TA, TB) === N`.
 * A block at (x, y, z) occupies the unit cube [x, x+1] × [y, y+1] × [z, z+1]; `displacement`
 * moves the corner `(cu, cv) ∈ {0,1}²` basis onto the correct OUTWARD boundary plane, so the
 * quad corners always lie on the voxel's own faces -- never shifted into a neighbour cell
 * (regression: an all-zero/degenerate mesh would leave every triangle with zero area). */
interface FaceTemplate {
  normal: readonly [number, number, number];
  tangentA: readonly [number, number, number];
  tangentB: readonly [number, number, number];
  /** Offset added to the block base so the quad sits on the outward face plane. */
  displacement: readonly [number, number, number];
  neighborOffset: readonly [number, number, number];
}

/**
 * Naive visible-face mesher (dossier §1.4 method (b), the production baseline; greedy is a
 * later milestone). M0 scope: single static chunk, main thread, no skirt data -- hence any
 * face on the chunk border counts as exposed (out-of-bounds reads `BLOCK_AIR`). The derived
 * `cross(tangentA, tangentB) === normal` constraint guarantees correct winding for the
 * engine's back-face culling by construction (asserted in `NaiveMesher.test.ts`).
 */
export class NaiveMesher {
  /** All six face templates. Exposed for the winding test. */
  public static readonly FACES: readonly FaceTemplate[] = [
    // +X -- plane x+1
    {
      normal: [1, 0, 0],
      tangentA: [0, 1, 0],
      tangentB: [0, 0, 1],
      displacement: [1, 0, 0],
      neighborOffset: [1, 0, 0],
    },
    // -X -- plane x
    {
      normal: [-1, 0, 0],
      tangentA: [0, 0, 1],
      tangentB: [0, 1, 0],
      displacement: [0, 0, 0],
      neighborOffset: [-1, 0, 0],
    },
    // +Y -- plane y+1
    {
      normal: [0, 1, 0],
      tangentA: [0, 0, 1],
      tangentB: [1, 0, 0],
      displacement: [0, 1, 0],
      neighborOffset: [0, 1, 0],
    },
    // -Y -- plane y
    {
      normal: [0, -1, 0],
      tangentA: [1, 0, 0],
      tangentB: [0, 0, 1],
      displacement: [0, 0, 0],
      neighborOffset: [0, -1, 0],
    },
    // +Z -- plane z+1
    {
      normal: [0, 0, 1],
      tangentA: [1, 0, 0],
      tangentB: [0, 1, 0],
      displacement: [0, 0, 1],
      neighborOffset: [0, 0, 1],
    },
    // -Z -- plane z
    {
      normal: [0, 0, -1],
      tangentA: [0, 1, 0],
      tangentB: [1, 0, 0],
      displacement: [0, 0, 0],
      neighborOffset: [0, 0, -1],
    },
  ];

  private readonly _registry: BlockRegistry;

  constructor(registry: BlockRegistry) {
    this._registry = registry;
  }

  /**
   * Meshes a chunk into plain typed arrays. Faces are emitted only where the neighbor cell
   * is `BLOCK_AIR` or a transparent block (naive visible-face culling).
   */
  public build(chunk: Chunk): VoxelMeshData {
    const size = Chunk.SIZE;
    const visibleFaces: Array<{
      x: number;
      y: number;
      z: number;
      face: FaceTemplate;
      layer: number;
    }> = [];

    // Pass 1 -- collect visible faces (also sizes the output arrays exactly).
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        for (let x = 0; x < size; x++) {
          const id = chunk.getBlock(x, y, z);
          if (!this._registry.isOpaque(id)) continue;

          for (const face of NaiveMesher.FACES) {
            const nx = x + face.neighborOffset[0]!;
            const ny = y + face.neighborOffset[1]!;
            const nz = z + face.neighborOffset[2]!;
            if (this._registry.isOpaque(chunk.getBlock(nx, ny, nz))) continue;

            const axis = faceAxisForNormal(face.normal[1]!);
            visibleFaces.push({ x, y, z, face, layer: this._registry.faceLayer(id, axis) });
          }
        }
      }
    }

    const vertexCount = visibleFaces.length * 4;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const colors = new Float32Array(vertexCount * 4);
    const indices =
      vertexCount > 65535
        ? new Uint32Array(visibleFaces.length * 6)
        : new Uint16Array(visibleFaces.length * 6);

    // Pass 2 -- emit geometry. Each face spans the full atlas swatch (uv 0..1); the atlas
    // layer travels in `colors.r`. Winding follows the (TA, TB) basis so `cross` of the
    // first triangle equals the outward normal (front faces under back-face culling).
    let vi = 0;
    let ii = 0;
    for (let f = 0; f < visibleFaces.length; f++) {
      const entry = visibleFaces[f]!;
      const { x, y, z, face, layer } = entry;
      const n = face.normal;
      const ta = face.tangentA;
      const tb = face.tangentB;

      // Quad corners in (u, v) parameter space: (0,0), (1,0), (1,1), (0,1).
      const corners: readonly [number, number][] = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ];
      for (let k = 0; k < 4; k++) {
        const cu = corners[k]![0];
        const cv = corners[k]![1];
        positions[(vi + k) * 3 + 0] = x + face.displacement[0]! + ta[0]! * cu + tb[0]! * cv;
        positions[(vi + k) * 3 + 1] = y + face.displacement[1]! + ta[1]! * cu + tb[1]! * cv;
        positions[(vi + k) * 3 + 2] = z + face.displacement[2]! + ta[2]! * cu + tb[2]! * cv;
      }
      for (let k = 0; k < 4; k++) {
        normals[(vi + k) * 3] = n[0]!;
        normals[(vi + k) * 3 + 1] = n[1]!;
        normals[(vi + k) * 3 + 2] = n[2]!;
      }
      // UV corners match the parameter corners (full swatch per face).
      for (let k = 0; k < 4; k++) {
        uvs[(vi + k) * 2] = corners[k]![0];
        uvs[(vi + k) * 2 + 1] = corners[k]![1];
      }
      for (let k = 0; k < 4; k++) {
        colors[(vi + k) * 4] = layer;
        colors[(vi + k) * 4 + 1] = 1;
        colors[(vi + k) * 4 + 2] = 1;
        colors[(vi + k) * 4 + 3] = 1;
      }

      // Two triangles, CCW in the (TA, TB) parameter plane (== facing outward).
      indices[ii++] = vi;
      indices[ii++] = vi + 1;
      indices[ii++] = vi + 2;
      indices[ii++] = vi;
      indices[ii++] = vi + 2;
      indices[ii++] = vi + 3;
      vi += 4;
    }

    return { positions, normals, uvs, colors, indices, triangleCount: visibleFaces.length * 2 };
  }
}
