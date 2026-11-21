import type {
  GltfExtensionPlugin,
  GltfPrimitiveDef,
  GltfReadContext,
  GeometryDataInterface,
} from "@small-world-machine/engine";
import type { DracoAttributeMapping, DracoDecodeOptions } from "./DracoDecoder.js";
import { DracoDecoder } from "./DracoDecoder.js";

export interface DracoExtensionDef {
  bufferView: number;
  attributes: DracoAttributeMapping;
}

export type KhrDracoOptions = DracoDecodeOptions;

/**
 * Creates an instance-isolated `KHR_draco_mesh_compression` plugin with its own decoder options
 * (e.g. custom WASM bytes or handler) so multiple engine instances on one page never share state.
 */
export function createKhrDracoMeshCompressionPlugin(
  options?: KhrDracoOptions,
): GltfExtensionPlugin {
  return {
    name: "KHR_draco_mesh_compression",

    async decodeGeometry(
      primitive: GltfPrimitiveDef,
      ctx: GltfReadContext,
      buffers: ArrayBuffer[],
    ): Promise<GeometryDataInterface | null> {
      const dracoDef = primitive.extensions?.KHR_draco_mesh_compression as
        DracoExtensionDef | undefined;
      if (!dracoDef || dracoDef.bufferView === undefined || !ctx.json.bufferViews) {
        return null;
      }

      const bv = ctx.json.bufferViews[dracoDef.bufferView];
      if (!bv) return null;

      const buffer = buffers[bv.buffer];
      if (!buffer) return null;

      const byteOffset = bv.byteOffset ?? 0;
      const chunk = buffer.slice(byteOffset, byteOffset + bv.byteLength);

      return DracoDecoder.decode(chunk, dracoDef.attributes ?? {}, options);
    },
  };
}

/**
 * `KHR_draco_mesh_compression` -- Khronos standard extension for Draco geometry compression.
 * Intercepts primitive parsing via the `decodeGeometry` hook and decompresses the bitstream
 * into a Small World Machine `GeometryDataInterface`.
 */
export const khrDracoMeshCompression: GltfExtensionPlugin = createKhrDracoMeshCompressionPlugin();
