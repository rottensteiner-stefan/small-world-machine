import type { GltfJson } from "./types.js";
import { GltfBinaryParser } from "./GltfBinaryParser.js";
import type { GeometryDataInterface } from "../../interfaces/index.js";
import { ModelGeometry } from "../../geometry/index.js";
import { Topology } from "../../enums/index.js";
import { getGltfExtensions } from "./GltfExtensionRegistry.js";
import type { GltfPrimitiveDef, GltfReadContext } from "./GltfExtensionPlugin.js";

/**
 * Parser for glTF primitive vertex attributes and index buffers into ModelGeometry.
 */
export class GltfGeometryParser {
  /**
   * Converts a glTF mesh primitive into GeometryDataInterface.
   */
  public static async parseGeometry(
    primitive: GltfPrimitiveDef,
    json: GltfJson,
    buffers: ArrayBuffer[],
    ctx?: GltfReadContext,
  ): Promise<GeometryDataInterface | null> {
    const readCtx: GltfReadContext = ctx ?? { json, state: new Map() };

    // 1. Check if any registered extension decodes this geometry (e.g. KHR_draco_mesh_compression)
    for (const plugin of getGltfExtensions()) {
      if (plugin.decodeGeometry) {
        const decoded = await plugin.decodeGeometry(primitive, readCtx, buffers);
        if (decoded) return decoded;
      }
    }

    // glTF primitive modes: 0 POINTS, 1 LINES, 2 LINE_LOOP, 3 LINE_STRIP, 4 TRIANGLES (default),
    // 5 TRIANGLE_STRIP, 6 TRIANGLE_FAN. Strips, fans and line loops/strips are re-indexed into a
    // plain triangle / line list below. POINTS are skipped with a warning (the WebGL tiers have no
    // point primitive path), so one stray primitive does not abort the whole asset.
    const mode = primitive.mode ?? 4;
    if (!Number.isInteger(mode) || mode < 0 || mode > 6) {
      throw new Error(`[GltfGeometryParser] Invalid primitive mode ${mode}.`);
    }
    if (mode === 0) {
      console.warn(
        "[GltfGeometryParser] Skipping POINTS primitive (point rendering is not supported).",
      );
      return null;
    }

    // 2. Standard uncompressed buffer accessor path
    const attributes = primitive.attributes;
    if (!attributes || attributes["POSITION"] === undefined || !json.accessors) return null;

    const posAccessor = json.accessors[attributes["POSITION"]];
    // POSITION is the one attribute whose quantized (normalized integer) storage must be
    // dequantized into unit space; NORMAL/TANGENT/etc. keep their normalized domain.
    const positions = GltfBinaryParser.getBufferData(posAccessor, json, buffers, {
      dequantize: true,
    });
    if (!positions) return null;

    // glTF 2.0 `TANGENT` is a VEC4 whose w component is the bitangent handedness
    // (MikkTSpace). It is forwarded verbatim (incl. w) so DCC-baked tangents are
    // neither dropped nor recomputed by the CPU generator.
    const tangents =
      attributes["TANGENT"] !== undefined
        ? GltfBinaryParser.getBufferData(json.accessors[attributes["TANGENT"]], json, buffers)
        : undefined;

    const normals =
      attributes["NORMAL"] !== undefined
        ? GltfBinaryParser.getBufferData(json.accessors[attributes["NORMAL"]], json, buffers)
        : undefined;
    const uvs =
      attributes["TEXCOORD_0"] !== undefined
        ? GltfBinaryParser.getBufferData(json.accessors[attributes["TEXCOORD_0"]], json, buffers)
        : undefined;
    const indices =
      primitive.indices !== undefined
        ? GltfBinaryParser.getBufferData(json.accessors[primitive.indices], json, buffers)
        : undefined;
    const joints =
      attributes["JOINTS_0"] !== undefined
        ? GltfBinaryParser.getBufferData(json.accessors[attributes["JOINTS_0"]], json, buffers)
        : undefined;
    const weights =
      attributes["WEIGHTS_0"] !== undefined
        ? GltfBinaryParser.getBufferData(json.accessors[attributes["WEIGHTS_0"]], json, buffers)
        : undefined;

    let finalIndices: Uint16Array | Uint32Array;
    if (indices) {
      if (indices instanceof Uint8Array) {
        finalIndices = new Uint16Array(indices);
      } else if (indices instanceof Uint16Array || indices instanceof Uint32Array) {
        finalIndices = indices;
      } else {
        throw new Error(
          `[GltfGeometryParser] Invalid index component type: indices must be unsigned integer (Uint8Array, Uint16Array, or Uint32Array).`,
        );
      }
    } else {
      finalIndices = new Uint16Array(0);
    }

    const isLines = mode >= 1 && mode <= 3;
    if (mode === 5 || mode === 6) {
      finalIndices = GltfGeometryParser._toTriangleList(
        mode,
        indices ? finalIndices : undefined,
        positions.length / 3,
      );
    } else if (isLines) {
      finalIndices = GltfGeometryParser._toLineList(
        mode as 1 | 2 | 3,
        indices ? finalIndices : undefined,
        positions.length / 3,
      );
    }

    let finalJoints: Float32Array | Uint16Array | undefined;
    if (joints) {
      if (joints instanceof Uint8Array) {
        finalJoints = new Uint16Array(joints);
      } else if (joints instanceof Uint16Array || joints instanceof Float32Array) {
        finalJoints = joints;
      } else {
        finalJoints = new Uint16Array(joints);
      }
    }

    let finalWeights: Float32Array | undefined;
    if (weights) {
      finalWeights = weights instanceof Float32Array ? weights : new Float32Array(weights);
    }

    const posArray = positions instanceof Float32Array ? positions : new Float32Array(positions);
    const uvArray = uvs
      ? uvs instanceof Float32Array
        ? uvs
        : new Float32Array(uvs)
      : new Float32Array(0);
    const normArray = normals
      ? normals instanceof Float32Array
        ? normals
        : new Float32Array(normals)
      : new Float32Array(0);
    const tanArray = tangents
      ? tangents instanceof Float32Array
        ? tangents
        : new Float32Array(tangents)
      : undefined;

    // Header min/max are trustworthy ONLY for unquantized Float32 POSITION: the accessor
    // bounds live in the dequantized domain, and only Float32 (unnormalized) POSITION
    // reaches this parser without a rescale. Quantized/other inputs keep the CPU scan.
    let headerBounds: { min: [number, number, number]; max: [number, number, number] } | undefined;
    if (
      posAccessor &&
      posAccessor.componentType === 5126 &&
      !posAccessor.normalized &&
      posAccessor.min !== undefined &&
      posAccessor.max !== undefined &&
      posAccessor.min.length >= 3 &&
      posAccessor.max.length >= 3
    ) {
      headerBounds = {
        min: [posAccessor.min[0]!, posAccessor.min[1]!, posAccessor.min[2]!],
        max: [posAccessor.max[0]!, posAccessor.max[1]!, posAccessor.max[2]!],
      };
    }

    return new ModelGeometry(posArray, uvArray, normArray, finalIndices, {
      ...(tanArray ? { tangents: tanArray } : {}),
      ...(headerBounds ? { headerBounds } : {}),
      ...(finalJoints || finalWeights ? { joints: finalJoints, weights: finalWeights } : {}),
      ...(isLines ? { topology: Topology.LINE_LIST } : {}),
    }).getGeometryData();
  }

  /**
   * Re-indexes a TRIANGLE_STRIP (5) or TRIANGLE_FAN (6) into a plain triangle list. Without an
   * index accessor the vertices are consumed in order. Strip triangles alternate their winding, so
   * every odd one is flipped to keep all faces front-facing.
   */
  private static _toTriangleList(
    mode: 5 | 6,
    source: Uint16Array | Uint32Array | undefined,
    vertexCount: number,
  ): Uint16Array | Uint32Array {
    const count = source ? source.length : vertexCount;
    const triangles = Math.max(0, count - 2);
    const out =
      vertexCount > 65535 ? new Uint32Array(triangles * 3) : new Uint16Array(triangles * 3);
    const at = (i: number): number => (source ? source[i]! : i);
    for (let t = 0; t < triangles; t++) {
      const o = t * 3;
      if (mode === 6) {
        out[o] = at(0);
        out[o + 1] = at(t + 1);
        out[o + 2] = at(t + 2);
      } else if (t % 2 === 0) {
        out[o] = at(t);
        out[o + 1] = at(t + 1);
        out[o + 2] = at(t + 2);
      } else {
        out[o] = at(t + 1);
        out[o + 1] = at(t);
        out[o + 2] = at(t + 2);
      }
    }
    return out;
  }

  /**
   * Re-indexes LINES (1), LINE_LOOP (2) or LINE_STRIP (3) into a plain line list (index pairs).
   * Without an index accessor the vertices are consumed in order. A trailing unpaired LINES index
   * is dropped.
   */
  private static _toLineList(
    mode: 1 | 2 | 3,
    source: Uint16Array | Uint32Array | undefined,
    vertexCount: number,
  ): Uint16Array | Uint32Array {
    const count = source ? source.length : vertexCount;
    const segments =
      mode === 1 ? Math.floor(count / 2) : Math.max(0, mode === 2 ? count : count - 1);
    const out = vertexCount > 65535 ? new Uint32Array(segments * 2) : new Uint16Array(segments * 2);
    const at = (i: number): number => (source ? source[i]! : i);
    for (let s = 0; s < segments; s++) {
      if (mode === 1) {
        out[s * 2] = at(s * 2);
        out[s * 2 + 1] = at(s * 2 + 1);
      } else {
        out[s * 2] = at(s);
        out[s * 2 + 1] = at((s + 1) % count);
      }
    }
    return out;
  }
}
