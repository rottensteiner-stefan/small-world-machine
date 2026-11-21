import type {
  GltfExtensionPlugin,
  GltfTextureDef,
  GltfReadContext,
  Texture,
  AssetManager,
} from "@small-world-machine/engine";
import type { BasisTranscodeOptions } from "./BasisTranscoder.js";
import { BasisTranscoder } from "./BasisTranscoder.js";

export interface KhrTextureBasisuDef {
  source: number;
}

export type KhrTextureBasisuOptions = BasisTranscodeOptions;

/**
 * Creates an instance-isolated `KHR_texture_basisu` plugin with its own transcoder options
 * (capabilities, format, custom WASM bytes or handler) for multi-engine isolation.
 */
export function createKhrTextureBasisuPlugin(
  options?: KhrTextureBasisuOptions,
): GltfExtensionPlugin {
  return {
    name: "KHR_texture_basisu",

    async resolveTexture(
      textureDef: GltfTextureDef,
      ctx: GltfReadContext,
      folderPath: string,
      buffers: ArrayBuffer[],
      assetManager: AssetManager,
    ): Promise<Texture | null> {
      const basisuDef = textureDef.extensions?.KHR_texture_basisu as
        KhrTextureBasisuDef | undefined;
      if (!basisuDef || basisuDef.source === undefined || !ctx.json.images) {
        return null;
      }

      const imageDef = ctx.json.images[basisuDef.source];
      if (!imageDef) return null;

      // Case 1: Image provided via bufferView
      if (imageDef.bufferView !== undefined && ctx.json.bufferViews) {
        const bv = ctx.json.bufferViews[imageDef.bufferView];
        if (bv) {
          const buffer = buffers[bv.buffer];
          if (buffer) {
            const byteOffset = bv.byteOffset ?? 0;
            const chunk = buffer.slice(byteOffset, byteOffset + bv.byteLength);
            return BasisTranscoder.transcode(chunk, imageDef.mimeType ?? "image/ktx2", options);
          }
        }
      }

      // Case 2: Image provided via external URI
      if (imageDef.uri) {
        const url = imageDef.uri.startsWith("data:") ? imageDef.uri : folderPath + imageDef.uri;
        const arrayBuffer = await assetManager.loadBinary(url, undefined, ctx.signal);
        return BasisTranscoder.transcode(arrayBuffer, imageDef.mimeType ?? "image/ktx2", options);
      }

      return null;
    },
  };
}

/**
 * `KHR_texture_basisu` -- Khronos standard extension for Basis Universal / KTX2 compressed textures.
 * Intercepts texture resolution via the `resolveTexture` hook and transcodes the compressed image data.
 */
export const khrTextureBasisu: GltfExtensionPlugin = createKhrTextureBasisuPlugin();
