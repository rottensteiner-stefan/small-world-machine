import {
  GltfExtensionPlugin,
  GltfPrimitiveDef,
  GltfReadContext,
  GeometryDataInterface,
} from "@small-world-machine/engine";
import { DracoDecoder, DracoAttributeMapping } from "./DracoDecoder.js";

export interface DracoExtensionDef {
  bufferView: number;
  attributes: DracoAttributeMapping;
}

/**
 * `KHR_draco_mesh_compression` -- Khronos standard extension for Draco geometry compression.
 * Intercepts primitive parsing via the `decodeGeometry` hook and decompresses the bitstream
 * into a Small World Machine `GeometryDataInterface`.
 */
export const khrDracoMeshCompression: GltfExtensionPlugin = {
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

    return DracoDecoder.decode(chunk, dracoDef.attributes ?? {});
  },
};
