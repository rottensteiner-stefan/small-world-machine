import type { BlockRegistry } from "../BlockRegistry.js";
import { faceAxisForNormal } from "../BlockRegistry.js";
import { Chunk } from "../Chunk.js";

/**
 * Output of the mesher: typed vertex/index arrays shaped exactly like the engine's
 * `GeometryDataInterface` but WITHOUT any engine import -- pure data so it stays testable in
 * node and structured-clone-able for the M1 worker meshing handoff (the mesh worker receives
 * this shape back via `postMessage`).
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
export interface FaceTemplate {
  normal: readonly [number, number, number];
  tangentA: readonly [number, number, number];
  tangentB: readonly [number, number, number];
  /** Offset added to the block base so the quad sits on the outward face plane. */
  displacement: readonly [number, number, number];
  neighborOffset: readonly [number, number, number];
}

/**
 * All six face templates. Exposed for the winding test (and imported by the mesh worker --
 * the worker must never duplicate this table).
 */
export const FACES: readonly FaceTemplate[] = [
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

/**
 * M1 neighbor-seam convention (dossier §4.2 M1 "keine Naht"). A chunk that would mesh a face on
 * its border must consult the ADJACENT chunk's block data instead of assuming air -- but it must
 * never import the neighbor chunk wholesale. The protocol therefore passes, per neighbor, only
 * the single 16×16 border plane facing this chunk (256 block ids) as an opaque `Uint8Array`.
 *
 * A rim is indexed with the two FREE local axes of the neighbor in a fixed (B, C) order:
 *
 *   - px / nx (normal axis x)   -> B = y, C = z,  rim[...] = neighbor.voxels[localX + z*16 + y*256]
 *   - py / ny (normal axis y)   -> B = x, C = z,  rim[...] = neighbor.voxels[localX + z*16 + y*256]
 *   - pz / nz (normal axis z)   -> B = x, C = y,  rim[...] = neighbor.voxels[localX + z*16 + y*256]
 *
 * Byte index = B + C*SIZE. Both the mesher (inside the worker) and the rim builder (main
 * thread, see `buildNeighborRims`) resolve this table -- a mismatch would instantly show up as a
 * seam/crack, which the seam-parity test pins.
 */
export const RIM_INDEX_ORDER: Readonly<
  Record<FaceDir, { readonly b: "x" | "y" | "z"; readonly c: "x" | "y" | "z" }>
> = {
  px: { b: "y", c: "z" },
  nx: { b: "y", c: "z" },
  py: { b: "x", c: "z" },
  ny: { b: "x", c: "z" },
  pz: { b: "x", c: "y" },
  nz: { b: "x", c: "y" },
};

/** Which of the six axis-neighbors a border cell points at. */
export type FaceDir = "px" | "nx" | "py" | "ny" | "pz" | "nz";

/** Maps a face's `neighborOffset` to its `FaceDir` (single source of truth for both directions). */
export function faceDirForOffset(offset: readonly [number, number, number]): FaceDir {
  if (offset[0] !== 0) return offset[0]! > 0 ? "px" : "nx";
  if (offset[1] !== 0) return offset[1]! > 0 ? "py" : "ny";
  return offset[2]! > 0 ? "pz" : "nz";
}

/**
 * Serializable registry subset the mesher needs: opacity (for culling) and the atlas layer per
 * face axis. Deliberately NOT the `BlockRegistry` class -- this plain array survives structured
 * clone into the mesh worker, and keeps the worker free of app imports beyond the pure mesher.
 */
export interface MeshBlockDescriptorEntry {
  id: number;
  opaque: boolean;
  /** Whether a player AABB collides with the block (used by the M1 sweep; ignored by the mesher). */
  collidable: boolean;
  /** Atlas layer per face axis in `FACE_AXIS` order (UP=0, DOWN=1, SIDE=2), see `layersFor`. */
  layers: readonly [number, number, number];
}

/** Builds the transferable descriptor from a registry. `Map` is avoided on purpose (transport). */
export function descriptorFromRegistry(registry: BlockRegistry): MeshBlockDescriptorEntry[] {
  return registry.definitions().map((def) => ({
    id: def.id,
    opaque: !def.transparent,
    collidable: def.collidable,
    layers: layersFor(def),
  }));
}

function layersFor(def: {
  faceLayers: { top: number; bottom: number; side: number };
}): readonly [number, number, number] {
  return [def.faceLayers.top, def.faceLayers.bottom, def.faceLayers.side];
}

/**
 * Extracts the 16×16 border plane of `neighborVoxels` (a full chunk, Chunk.SIZE³) that faces
 * THIS chunk across the given direction. The returned plane is indexed per `RIM_INDEX_ORDER` and
 * is what gets handed to the worker (M1 seam culling). Pure copy -- never aliases the source.
 */
export function buildNeighborRim(neighborVoxels: Uint8Array, dir: FaceDir): Uint8Array {
  const size = Chunk.SIZE;
  const rim = new Uint8Array(size * size);
  for (let c = 0; c < size; c++) {
    for (let b = 0; b < size; b++) {
      // Local coordinate of the plane inside the neighbor:
      //   px -> x=0   nx -> x=size-1   py -> y=0   ny -> y=size-1   pz -> z=0   nz -> z=size-1
      let lx = b;
      let ly = c;
      let lz = b;
      switch (dir) {
        case "px":
          lx = 0;
          ly = b;
          lz = c;
          break;
        case "nx":
          lx = size - 1;
          ly = b;
          lz = c;
          break;
        case "py":
          lx = b;
          ly = 0;
          lz = c;
          break;
        case "ny":
          lx = b;
          ly = size - 1;
          lz = c;
          break;
        case "pz":
          lx = b;
          ly = c;
          lz = 0;
          break;
        case "nz":
          lx = b;
          ly = c;
          lz = size - 1;
          break;
      }
      rim[b + c * size] = neighborVoxels[lx + lz * size + ly * size * size]!;
    }
  }
  return rim;
}

/**
 * Input of the pure mesher. `voxels` is the chunk's raw block-id buffer (Chunk.SIZE³),
 * `descriptor` the transferable registry subset, `neighbors` the optional border planes of the
 * six axis-neighbors. A missing neighbor plane means "air" (a world/vertical edge), which keeps
 * the M0 single-chunk semantics (border faces exposed) intact when meshing without neighbors.
 */
export interface MeshBuildInput {
  voxels: Uint8Array;
  descriptor: readonly MeshBlockDescriptorEntry[];
  neighbors?: Partial<Record<FaceDir, Uint8Array>>;
}

/**
 * Naive visible-face mesher (dossier §1.4 method (b), the production baseline; greedy is a later
 * milestone -- M5, §4.4 #3). Pure function: no engine import, no class, no global state -- this
 * exact code path runs on the main thread (unit tests, foreground fallback) AND inside the mesh
 * worker (M1). Faces are emitted only where the neighbor cell is non-opaque; neighbor cells on
 * the chunk border resolve through the `neighbors` rim planes so chunk boundaries cull exactly
 * like interior faces (no cracks, no seams, no double faces).
 *
 * The derived `cross(tangentA, tangentB) === normal` constraint guarantees correct winding for
 * the engine's back-face culling by construction (asserted in `NaiveMesher.test.ts`).
 */
export function buildMesh(input: MeshBuildInput): VoxelMeshData {
  const size = Chunk.SIZE;
  if (input.voxels.length !== size * size * size) {
    throw new Error(
      `[buildMesh] expected a ${size}^3 voxel buffer (${size * size * size} bytes), got ${input.voxels.length}`,
    );
  }

  const descriptor = new Map<number, MeshBlockDescriptorEntry>();
  for (const entry of input.descriptor) descriptor.set(entry.id, entry);
  const neighbors: Partial<Record<FaceDir, Uint8Array>> = input.neighbors ?? {};

  /** Whether the cell at (x,y,z) -- local OR across a border -- is opaque. Missing neighbor
   *  data and unknown ids read as non-opaque (the cell does not cull). */
  const isSolidAt = (x: number, y: number, z: number): boolean => {
    if (x < 0 || y < 0 || z < 0 || x >= size || y >= size || z >= size) {
      const dir = faceDirForOffset([
        Math.sign(x) as 1 | 0 | -1,
        Math.sign(y) as 1 | 0 | -1,
        Math.sign(z) as 1 | 0 | -1,
      ]);
      const rim = neighbors[dir];
      if (!rim) return false; // no neighbor data -> exposed (M0 edge semantics)
      const order = RIM_INDEX_ORDER[dir];
      const b = order.b === "x" ? x : order.b === "y" ? y : z;
      const c = order.c === "x" ? x : order.c === "y" ? y : z;
      const id = rim[b + c * size];
      if (id === undefined) return false;
      return descriptor.get(id)?.opaque ?? false;
    }
    return descriptor.get(input.voxels[x + z * size + y * size * size]!)?.opaque ?? false;
  };

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
        const id = input.voxels[x + z * size + y * size * size]!;
        if (!(descriptor.get(id)?.opaque ?? false)) continue;

        for (const face of FACES) {
          const nx = x + face.neighborOffset[0]!;
          const ny = y + face.neighborOffset[1]!;
          const nz = z + face.neighborOffset[2]!;
          if (isSolidAt(nx, ny, nz)) continue;

          const axis = faceAxisForNormal(face.normal[1]!);
          const layers = descriptor.get(id)!.layers;
          const layer = layers[axis]!;
          visibleFaces.push({ x, y, z, face, layer });
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

/**
 * M0-compatible convenience wrapper around `buildMesh` (kept so the committed M0 tests and any
 * demo path that meshes on the main thread keep working unchanged). Meshes a `Chunk` WITHOUT
 * neighbor data -- border faces therefore count as exposed, exactly the M0 single-chunk
 * contract. M1 production code calls `buildMesh` directly (with neighbor rims, in the worker).
 */
export class NaiveMesher {
  /** All six face templates -- re-exported so existing tests keep reading this table. */
  public static readonly FACES: readonly FaceTemplate[] = FACES;

  private readonly _registry: BlockRegistry;

  constructor(registry: BlockRegistry) {
    this._registry = registry;
  }

  /** Meshes a chunk into plain typed arrays (no neighbor awareness -- border = exposed). */
  public build(chunk: Chunk): VoxelMeshData {
    return buildMesh({ voxels: chunk.voxels, descriptor: descriptorFromRegistry(this._registry) });
  }
}
