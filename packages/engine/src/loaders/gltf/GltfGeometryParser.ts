import type { GltfJson } from "./types.js";
import { GltfBinaryParser } from "./GltfBinaryParser.js";
import type { GeometryDataInterface } from "../../interfaces/index.js";
import { ModelGeometry } from "../../geometry/index.js";
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

    // Check for supported primitive mode (glTF default is 4 = TRIANGLES)
    if (primitive.mode !== undefined && primitive.mode !== 4) {
      throw new Error(
        `[GltfGeometryParser] Unsupported primitive mode ${primitive.mode}. Only TRIANGLES (mode 4) is currently supported.`,
      );
    }

    // 2. Standard uncompressed buffer accessor path
    const attributes = primitive.attributes;
    if (!attributes || attributes["POSITION"] === undefined || !json.accessors) return null;

    const positions = GltfBinaryParser.getBufferData(
      json.accessors[attributes["POSITION"]],
      json,
      buffers,
    );
    if (!positions) return null;

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

    return new ModelGeometry(
      posArray,
      uvArray,
      normArray,
      finalIndices,
      finalJoints || finalWeights
        ? {
            joints: finalJoints,
            weights: finalWeights,
          }
        : undefined,
    ).getGeometryData();
  }
}
