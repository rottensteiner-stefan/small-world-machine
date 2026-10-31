import { AbstractGeometry } from "./AbstractGeometry.js";
import { Topology } from "../enums/index.js";
import { BoundingBox } from "../physix/index.js";
import { Vector3D } from "../math/index.js";

/**
 * Options for configuring skinning data on a ModelGeometry.
 */
export interface ModelGeometryOptions {
  /** Skinning joint indices (4 IDs per vertex). */
  joints?: number[] | Float32Array | Uint16Array | undefined;
  /** Skinning joint weights (4 weights per vertex). */
  weights?: number[] | Float32Array | undefined;
  /**
   * Optional vertex tangents, 4 components per vertex `(tx, ty, tz, w)` with
   * `w = ±1` bitangent handedness (glTF `TANGENT` passthrough). When provided,
   * these are used verbatim — the CPU generator is NOT invoked — so 4 floats per
   * vertex are expected.
   */
  tangents?: number[] | Float32Array | undefined;
  /**
   * Optional pre-built wireframe line-segment indices. When provided, `getGeometryData()`
   * uses them directly instead of running `computeWireframeIndices()` on the main thread.
   */
  wireframeIndices?: Uint16Array | Uint32Array | undefined;
  /**
   * Authoritative bounds from the source-file header (glTF `accessor.min/max`),
   * used instead of a CPU vertex scan. ONLY valid for unquantized Float32
   * POSITION; callers must not pass it for quantized accessors, whose header
   * bounds are in the dequantized domain while the buffer is still scaled.
   */
  headerBounds?: { min: [number, number, number]; max: [number, number, number] } | undefined;
  /**
   * How `indices` are to be read: `TRIANGLE_LIST` (default) or `LINE_LIST` (index pairs, drawn as
   * line segments; normals default to up and no tangents are derived). Any other topology throws:
   * the renderers only consume these two for model geometry.
   */
  topology?: Topology | undefined;
}

/**
 * A geometry implementation for externally loaded models (e.g. from OBJ files).
 * Holds raw data provided during construction.
 */
export class ModelGeometry extends AbstractGeometry {
  /**
   * Creates a new ModelGeometry from provided raw data.
   * @param vertices Raw vertex positions.
   * @param uvs Raw texture coordinates.
   * @param normals Raw vertex normals.
   * @param indices Raw triangle indices.
   * @param options Optional configuration including skinning joints and weights.
   */
  constructor(
    vertices: number[] | Float32Array,
    uvs: number[] | Float32Array,
    normals: number[] | Float32Array,
    indices: number[] | Uint16Array | Uint32Array,
    options: ModelGeometryOptions = {},
  ) {
    super();
    const topology = options.topology ?? Topology.TRIANGLE_LIST;
    if (topology !== Topology.TRIANGLE_LIST && topology !== Topology.LINE_LIST) {
      throw new Error(`[ModelGeometry] Unsupported topology "${topology}".`);
    }
    this._isLineGeometry = topology === Topology.LINE_LIST;
    this._vertices = vertices instanceof Float32Array ? vertices : new Float32Array(vertices);
    this._uvs = uvs instanceof Float32Array ? uvs : new Float32Array(uvs);
    this._normals = normals instanceof Float32Array ? normals : new Float32Array(normals);

    if (options?.joints) {
      this._joints =
        options.joints instanceof Float32Array ? options.joints : new Float32Array(options.joints);
    }
    if (options?.weights) {
      this._weights =
        options.weights instanceof Float32Array
          ? options.weights
          : new Float32Array(options.weights);
    }
    if (options?.tangents) {
      this._tangents =
        options.tangents instanceof Float32Array
          ? options.tangents
          : new Float32Array(options.tangents);
    }
    if (options?.wireframeIndices) {
      this._wireframeIndices = options.wireframeIndices;
    }
    if (options?.headerBounds) {
      const hb = options.headerBounds;
      this._cachedBoundingVolume = new BoundingBox(
        new Vector3D(hb.min[0], hb.min[1], hb.min[2]),
        new Vector3D(hb.max[0], hb.max[1], hb.max[2]),
      );
    }

    if (indices instanceof Uint16Array || indices instanceof Uint32Array) {
      this._indices = indices;
    } else {
      this._indices = this._createIndexArray(indices.length);
      this._indices.set(indices);
    }

    // If the model doesn't provide normals, compute them automatically.
    if (0 === this._normals.length) {
      if (this._isLineGeometry) {
        // Index pairs are not triangles: skip the face-normal pass, default to up.
        this._normals = new Float32Array(this._vertices.length);
        for (let i = 1; i < this._normals.length; i += 3) this._normals[i] = 1;
      } else {
        this.computeNormals();
      }
    }
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    // Data is provided in constructor.
  }
}
