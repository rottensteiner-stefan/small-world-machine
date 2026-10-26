import { Texture } from "../../../core/textures/Texture.js";
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

    let url = "";
    let objectUrl = false;

    if (imageDef.uri) {
      if (imageDef.uri.startsWith("data:")) {
        url = imageDef.uri;
      } else {
        url = folderPath + imageDef.uri;
      }
    } else if (imageDef.bufferView !== undefined && json.bufferViews) {
      const bv = json.bufferViews[imageDef.bufferView];
      if (bv) {
        const buffer = buffers[bv.buffer];
        if (buffer) {
          const byteOffset = bv.byteOffset || 0;
          const chunk = buffer.slice(byteOffset, byteOffset + bv.byteLength);
          const blob = new Blob([chunk], { type: imageDef.mimeType || "image/webp" });
          url = URL.createObjectURL(blob);
          objectUrl = true;
        }
      }
    }

    if (!url) return null;

    try {
      // glTF 2.0 defines texture coordinates with origin (0, 0) at the upper-left corner of the image,
      // so glTF textures must NOT be flipped on decode (flipY = false).
      const img = await assetManager.loadImage(url, undefined, false);
      return Texture.fromImage(img);
    } finally {
      if (objectUrl) URL.revokeObjectURL(url);
    }
  },
};
