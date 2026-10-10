import { CompressedTextureFormat } from "@small-world-machine/engine";
import { BasisDecodedImage, BasisTranscoderFormat, BasisTranscoderFormatId } from "./basisTypes.js";

/**
 * Maps a Basis Universal transcoder output format id to the engine's
 * `CompressedTextureFormat`. RGBA32 has no engine equivalent (it is uploaded as
 * a plain RGBA8 texture) and yields `null`.
 */
export function engineFormatForBasisFormat(
  format: BasisTranscoderFormatId,
): CompressedTextureFormat | null {
  switch (format) {
    case BasisTranscoderFormat.ETC2:
      return CompressedTextureFormat.ETC2_RGBA8;
    case BasisTranscoderFormat.BC1:
      return CompressedTextureFormat.BC1_RGB;
    case BasisTranscoderFormat.BC3:
      return CompressedTextureFormat.BC3_RGBA;
    case BasisTranscoderFormat.BC7:
      return CompressedTextureFormat.BC7_RGBA;
    case BasisTranscoderFormat.ASTC_4x4:
      return CompressedTextureFormat.ASTC_4x4_RGBA;
    default:
      // ETC1 is covered by ETC2; RGBA32 falls back to a plain (uncompressed) upload.
      return null;
  }
}

/**
 * Provides the block-compressed bytes for every mip level of a 2D texture in
 * level order (layer 0 / face 0), suitable for `Texture.compressedImage.mipData`.
 * Throws for multi-image KTX2 (cube/layer) payloads, which the compressed upload
 * path does not support yet.
 */
export function mipChainFromImages(images: BasisDecodedImage[]): Uint8Array[] {
  const base = images.filter((image) => image.mipLevel === 0);
  if (base.length !== 1) {
    throw new Error(
      `[BasisTranscoder] Only single-image (2D) KTX2 payloads map to a compressed texture chain (found ${base.length} base images)`,
    );
  }
  const levelCount = Math.max(...images.map((image) => image.mipLevel)) + 1;
  const mipData: Uint8Array[] = [];
  for (let level = 0; level < levelCount; level++) {
    const plane = images.find((image) => image.mipLevel === level);
    if (!plane) {
      throw new Error(`[BasisTranscoder] Compressed mip chain is missing level ${level}`);
    }
    mipData.push(plane.data);
  }
  return mipData;
}

/**
 * Synchronously probes the current device for the best block-compressed output
 * format the *rendering* stack can consume, so KTX2 data can be kept GPU-compressed
 * instead of being decompressed to RGBA8. This inspects generic WebGL2 capability
 * surfaced by the browser: ETC2 is core (mandatory) in WebGL2, while BC7 (BPTC)
 * and ASTC require device/extension capability. On WebGPU the matching features
 * are requested by the renderer, which validates availability at upload time.
 * Returns `null` when no block format is usable -- callers then fall back to RGBA8.
 */
export function detectBestBlockFormat(): BasisTranscoderFormatId | null {
  const canvas = tryHiddenWebGl2();
  if (!canvas) return null;

  // BPTC (BC7) is the highest-quality desktop format (WebGL2 extension).
  if (canvas.getExtension("EXT_texture_compression_bptc")) return BasisTranscoderFormat.BC7;

  // ASTC is the mobile-oriented equivalent (extension, not core).
  if (canvas.getExtension("WEBGL_compressed_texture_astc")) return BasisTranscoderFormat.ASTC_4x4;

  // ETC2 is core in WebGL2 -- always available when a WebGL2 context exists.
  return BasisTranscoderFormat.ETC2;
}

/** Creates a throwaway WebGL2 context used purely for capability introspection. */
function tryHiddenWebGl2(): WebGL2RenderingContext | null {
  if (typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    return canvas.getContext("webgl2", {
      failIfMajorPerformanceCaveat: true,
      antialias: false,
      depth: false,
      stencil: false,
    }) as WebGL2RenderingContext | null;
  } catch {
    return null;
  }
}
