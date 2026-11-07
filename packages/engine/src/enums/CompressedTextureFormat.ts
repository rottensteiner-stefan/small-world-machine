/**
 * GPU block-compressed texture formats, used for textures that are uploaded
 * directly in their compressed form (e.g. KTX2 / `KHR_texture_basisu`) instead
 * of being decompressed to RGBA8. The underlying GPU resources stay compressed,
 * saving VRAM at the cost of supporting only what the active renderer/device
 * can upload (see `Texture.compressedImage`).
 */
export const CompressedTextureFormat = {
  /** BC1 (DXT1), RGB, 0.5 bytes/texel -- requires a S3TC/BPTEC-capable context. */
  BC1_RGB: "bc1_rgb",
  /** BC3 (DXT5), RGBA, 1 byte/texel -- requires a S3TC-capable context. */
  BC3_RGBA: "bc3_rgba",
  /** BC7, RGBA, 1 byte/texel -- highest quality (BPTEC/WebGPU `texture-compression-bc`). */
  BC7_RGBA: "bc7_rgba",
  /** ASTC 4x4, RGBA, 1 byte/texel -- mobile-oriented block format. */
  ASTC_4x4_RGBA: "astc_4x4_rgba",
  /** ETC2, RGBA, 1 byte/texel -- core in WebGL2, no extension required there. */
  ETC2_RGBA8: "etc2_rgba8",
} as const;

/** Type definition for CompressedTextureFormat. */
export type CompressedTextureFormat =
  (typeof CompressedTextureFormat)[keyof typeof CompressedTextureFormat];
