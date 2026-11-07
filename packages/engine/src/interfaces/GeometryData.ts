import type { BoundingVolume } from "./BoundingVolume.js";
import type { Topology } from "../enums/index.js";

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
  /** Optional per-vertex color data (r, g, b, a). */
  colors?: Float32Array | undefined;
  /** Optional skinning bone index data (4 joint IDs per vertex). */
  joints?: Float32Array | Uint16Array | undefined;
  /** Optional skinning bone weight data (4 weights per vertex). */
  weights?: Float32Array | undefined;
  /** The topology of the geometry (e.g., TRIANGLE_LIST or LINE_LIST). */
  topology?: Topology;
  /**
   * Flag to indicate that the vertex/normal/tangent buffers need to be re-uploaded to the GPU.
   * Set this to true after modifying the TypedArrays in-place.
   */
  needsUpdate?: boolean;
  getBoundingVolume(): BoundingVolume;
}
