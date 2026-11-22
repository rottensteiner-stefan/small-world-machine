import type { BoundingVolume } from "./BoundingVolume.js";
import type { Topology } from "../enums/index.js";

/** Per-vertex displacement deltas for one morph target (glTF 2.0 `primitive.targets`). */
export interface MorphTargetData {
  /** Position deltas (3 floats per vertex: dx, dy, dz). */
  positions?: Float32Array | undefined;
  /** Normal deltas (3 floats per vertex: dnx, dny, dnz). */
  normals?: Float32Array | undefined;
  /** Tangent xyz deltas (3 floats per vertex: dtx, dty, dtz, per glTF 2.0 spec). */
  tangents?: Float32Array | undefined;
}

export interface GeometryDataInterface {
  /** Vertex position data (x, y, z). Mandatory. */
  vertices: Float32Array;
  /** Optional index data. If provided, indexed rendering is used. */
  indices?: Uint16Array | Uint32Array | undefined;
  /** Optional index data for wireframe rendering. */
  wireframeIndices?: Uint16Array | Uint32Array | undefined;
  /** Optional normal data (nx, ny, nz). */
  normals?: Float32Array | undefined;
  /**
   * Optional tangent data, 4 components per vertex `(tx, ty, tz, w)`.
   * `w = ±1` is the bitangent handedness (MikkTSpace/glTF convention,
   * `B = cross(N, T) * w`). CPU-generated tangents derive `w` from the Lengyel
   * `tan1/tan2` pair; glTF `TANGENT.w` is preserved verbatim when authored.
   */
  tangents?: Float32Array | undefined;
  /** Optional texture coordinate data (u, v). */
  uvs?: Float32Array | undefined;
  /** Optional secondary texture coordinate data (`TEXCOORD_1`: u1, v1). */
  uvs1?: Float32Array | undefined;
  /** Optional per-vertex color data (r, g, b, a). */
  colors?: Float32Array | undefined;
  /**
   * @domain Optional per-vertex material layer (one float per vertex, integral values): index into
   *         an instance field's `albedoArray` (ADR 0059 field lane). Ignored by every other path;
   *         absent = layer 0.
   */
  materialLayers?: Float32Array | undefined;
  /** Optional skinning bone index data (4 joint IDs per vertex). */
  joints?: Float32Array | Uint16Array | undefined;
  /** Optional skinning bone weight data (4 weights per vertex). */
  weights?: Float32Array | undefined;
  /** Optional morph target displacement arrays (glTF `primitive.targets`). */
  morphTargets?: MorphTargetData[] | undefined;
  /** Optional human-readable names for morph targets (glTF `mesh.extras.targetNames`). */
  morphTargetNames?: string[] | undefined;
  /** The topology of the geometry (e.g., TRIANGLE_LIST or LINE_LIST). */
  topology?: Topology;
  /**
   * Flag to indicate that the vertex/normal/tangent buffers need to be re-uploaded to the GPU.
   * Set this to true after modifying the TypedArrays in-place.
   */
  needsUpdate?: boolean;
  getBoundingVolume(): BoundingVolume;
}
