import { CompressedTextureFormat } from "@small-world-machine/engine";
import type { BasisDecodedImage, BasisTranscoderFormatId } from "./basisTypes.js";
import { BasisTranscoderFormat } from "./basisTypes.js";

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
 * Memoized best block format for this page. `undefined` = not yet probed, `null` = no block
 * format usable (callers fall back to RGBA8). Device capabilities do not change at runtime, so
 * the {@link detectBestBlockFormatUncached} probe runs at most once per page.
 */
let cachedBlockFormat: BasisTranscoderFormatId | null | undefined;

/**
 * Returns the memoized best block format, probing once on first use. Keeps a page decoding many
 * KTX2 textures to a single transient probe context instead of one per transcode.
 */
export function detectBestBlockFormat(): BasisTranscoderFormatId | null {
  if (cachedBlockFormat !== undefined) return cachedBlockFormat;
  cachedBlockFormat = detectBestBlockFormatUncached();
  return cachedBlockFormat;
}

/**
 * Synchronously probes the current device for the best block-compressed output
 * format the *rendering* stack can consume, so KTX2 data can be kept GPU-compressed
 * instead of being decompressed to RGBA8. This inspects generic WebGL2 capability
 * surfaced by the browser: ETC2 is core (mandatory) in WebGL2, while BC7 (BPTC)
 * and ASTC require device/extension capability. On WebGPU the matching features
 * are requested by the renderer, which validates availability at upload time.
 * Returns `null` when no block format is usable -- callers then fall back to RGBA8.
 *
 * K01 (a): the decoded bytes fan out to whichever renderer the APP uses, and a WebGL1 context on
 * the same page/device cannot consume every WebGL2 candidate -- ETC2/EAC is WebGL2-core-only
 * (`WEBGL_compressed_texture_etc` is rarely exposed on WebGL1) and BC7 needs
 * `EXT_texture_compression_bptc`. The candidate is therefore cross-checked against a hidden WebGL1
 * probe; when WebGL1 cannot consume it, `null` is returned so the caller decodes to RGBA8 -- correct
 * on every tier -- instead of handing WebGL1 a block format its upload path cannot consume (white
 * placeholder bug, see `WebGLTextureManager._getWebGLTexture100`).
 */
function detectBestBlockFormatUncached(): BasisTranscoderFormatId | null {
  const canvas = tryHiddenWebGl2();
  if (!canvas) {
    // No WebGL2 at all (WebGL1-only device): there is no upper tier to serve, and WebGL1 has no
    // ETC2 core -- the pre-K01 behavior (RGBA8 fallback) stays correct and universal.
    return null;
  }

  // Same throwaway-probe rule as `DeviceCaps` in the engine: the hidden probe context MUST be
  // explicitly released via `WEBGL_lose_context` right after reading it, and the result memoized,
  // so a page decoding many KTX2 textures does not create one unreleased WebGL context per
  // transcode. Unreleased probes permanently consume the browser's per-page context cap (Chrome:
  // 16); on a machine already near the limit (concurrent engine instances / Electron apps), the
  // browser evicts the OLDEST context -- the LIVE render context -- leaving a blank/white frame
  // (reproduced headless: Showcase 50's Basis transcode path alone pushed a page past the cap).
  // Assigned on every path of the if/else-if/else below (TS flow analysis); no initializer -- the
  // eslint no-useless-assignment guard rejects a never-read initial value here.
  let candidate: BasisTranscoderFormatId | null;
  try {
    // BPTC (BC7) is the highest-quality desktop format (WebGL2 extension).
    if (canvas.getExtension("EXT_texture_compression_bptc")) candidate = BasisTranscoderFormat.BC7;
    // ASTC is the mobile-oriented equivalent (extension, not core).
    else if (canvas.getExtension("WEBGL_compressed_texture_astc")) {
      candidate = BasisTranscoderFormat.ASTC_4x4;
    }
    // ETC2 is core in WebGL2 -- always available when a WebGL2 context exists.
    else candidate = BasisTranscoderFormat.ETC2;
  } finally {
    canvas.getExtension("WEBGL_lose_context")?.loseContext();
  }

  const webgl1 = tryHiddenWebGl1();
  if (webgl1) {
    try {
      if (!webGl1Consumes(webgl1, candidate)) candidate = null;
    } finally {
      webgl1.getExtension("WEBGL_lose_context")?.loseContext();
    }
  }
  return candidate;
}

/** True when the given WebGL1 context can upload `format` through its extension surface. */
function webGl1Consumes(
  gl: WebGLRenderingContext,
  format: BasisTranscoderFormatId | null,
): boolean {
  switch (format) {
    case BasisTranscoderFormat.BC7:
      return Boolean(
        gl.getExtension("EXT_texture_compression_bptc") ??
        gl.getExtension("WEBGL_compressed_texture_bptc"),
      );
    case BasisTranscoderFormat.ASTC_4x4:
      return Boolean(gl.getExtension("WEBGL_compressed_texture_astc"));
    case BasisTranscoderFormat.ETC2:
      // ETC2/EAC is core in WebGL2 only; browsers may optionally expose the extension on WebGL1.
      return Boolean(gl.getExtension("WEBGL_compressed_texture_etc"));
    default:
      // null (RGBA8 fallback) and BC1/BC3 (S3TC) all have working WebGL1 upload paths.
      return true;
  }
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

/** Creates a throwaway WebGL1 context used purely for capability introspection (K01). */
function tryHiddenWebGl1(): WebGLRenderingContext | null {
  if (typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    return canvas.getContext("webgl", {
      failIfMajorPerformanceCaveat: true,
      antialias: false,
      depth: false,
      stencil: false,
    }) as WebGLRenderingContext | null;
  } catch {
    return null;
  }
}
