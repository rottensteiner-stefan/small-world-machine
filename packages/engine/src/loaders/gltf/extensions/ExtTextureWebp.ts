import { Texture } from "../../../core/textures/Texture.js";
import { GltfMaterialParser } from "../GltfMaterialParser.js";
import type { GltfExtensionPlugin } from "../GltfExtensionPlugin.js";

/**
 * `EXT_texture_webp` -- Khronos glTF 2.0 extension for WebP texture support.
 *
 * When present on a texture definition, points to an alternate WebP image source
 * (`extensions.EXT_texture_webp.source`) instead of the fallback image (`textureDef.source`).
 */
export const extTextureWebp: GltfExtensionPlugin = {
  name: "EXT_texture_webp",

  async resolveTexture(textureDef, ctx, folderPath, buffers, assetManager) {
    const ext = textureDef.extensions?.["EXT_texture_webp"] as { source?: number } | undefined;
    if (ext?.source === undefined) return undefined;

    const json = ctx.json;
    if (!json.images) return null;

    const imageDef = json.images[ext.source];
    if (!imageDef) return null;

    const img = await GltfMaterialParser.loadImageDef(
      imageDef,
      json,
      folderPath,
      buffers,
      assetManager,
      "image/webp",
    );
    return img ? Texture.fromImage(img) : null;
  },
};
