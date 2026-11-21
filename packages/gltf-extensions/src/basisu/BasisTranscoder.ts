import { Texture } from "@small-world-machine/engine";
import { BasisWasmTranscoder, hasKtx2Identifier } from "./BasisWasmTranscoder.js";
import type { BasisDecodeResult, BasisTranscoderFormatId } from "./basisTypes.js";
import { BasisTranscoderFormat } from "./basisTypes.js";
import type { BlockFormatCapabilities } from "./compressedFormats.js";
import { detectBestBlockFormat, engineFormatForBasisFormat } from "./compressedFormats.js";
import { flippedCompressedMipChain } from "./compressedMirror.js";

export interface BasisTranscodeOptions {
  format?: "rgba8" | "bc7" | "astc" | "etc2" | "dxt" | "auto";
  mipmaps?: boolean;
  /** Optional active renderer capabilities for tier-accurate auto format selection. */
  capabilities?: BlockFormatCapabilities;
  /** Per-call alternate `.wasm` bytes (overrides static config for multi-engine isolation). */
  wasmBinary?: ArrayBuffer | undefined;
  /** Per-call custom transcode handler (overrides static handler for multi-engine isolation). */
  customHandler?: BasisTranscodeHandler | undefined;
}

export type BasisTranscodeHandler = (
  buffer: ArrayBuffer,
  mimeType?: string,
  options?: BasisTranscodeOptions,
) => Promise<Texture> | Texture;

export interface BasisTranscoderConfig {
  transcoderPath?: string;
  workerLimit?: number;
  /**
   * Explicit `.wasm` bytes to load instead of the bundled copy. Mainly useful in
   * non-browser environments (unit tests, SSR) where fetching the `?url` asset
   * is unavailable.
   */
  wasmBinary?: ArrayBuffer;
  /** Optional default renderer capabilities used when `options.capabilities` is omitted. */
  capabilities?: BlockFormatCapabilities;
}

/**
 * BasisTranscoder handles KTX2 / Basis Universal compressed texture transcoding.
 *
 * By default it uses the vendored, official Basis Universal WebAssembly transcoder
 * to inflate supercompressed KTX2 payloads and keep them GPU block-compressed:
 * the device's best supported hardware format (ETC2/BC7/ASTC) is detected via a
 * capability probe, and the decoded bytes are wrapped in a `Texture.compressedImage`
 * chain for direct compressed upload. When no block format is usable or `"rgba8"`
 * is requested, it falls back to decompressing to RGBA8. Third-party applications
 * can override this via `BasisTranscoder.setTranscodeHandler(handler)`.
 */
export class BasisTranscoder {
  private static _config: BasisTranscoderConfig = {};
  private static _customHandler: BasisTranscodeHandler | null = null;

  /**
   * Configures transcoder paths and options.
   */
  public static setConfig(config: BasisTranscoderConfig): void {
    this._config = { ...this._config, ...config };
  }

  /**
   * Returns current transcoder configuration.
   */
  public static getConfig(): Readonly<BasisTranscoderConfig> {
    return this._config;
  }

  /**
   * Sets a custom transcode handler used instead of the built-in WASM transcoder.
   */
  public static setTranscodeHandler(handler: BasisTranscodeHandler | null): void {
    this._customHandler = handler;
  }

  /**
   * Transcodes a Basis Universal or KTX2 buffer into a Small World Machine Texture.
   */
  public static async transcode(
    buffer: ArrayBuffer,
    mimeType: string = "image/ktx2",
    options?: BasisTranscodeOptions,
  ): Promise<Texture> {
    const customHandler = options?.customHandler ?? this._customHandler;
    if (customHandler) {
      return customHandler(buffer, mimeType, options);
    }

    if (this._isKtx2(buffer)) {
      const requestedFormat = this._resolveFormat(
        options?.format,
        options?.capabilities ?? this._config.capabilities,
      );
      const wasmBinary = options?.wasmBinary ?? this._config.wasmBinary;
      const result = await BasisWasmTranscoder.transcode(new Uint8Array(buffer), {
        format: requestedFormat,
        ...(wasmBinary ? { wasmBinary } : {}),
      });
      return this._resultToTexture(result, options, requestedFormat);
    }

    // Not a KTX2 bitstream: hand the bytes to a plain image loader (PNG/JPEG/WebP via a blob URL).
    const blob = new Blob([buffer], { type: mimeType });
    const url = URL.createObjectURL(blob);
    try {
      // K02: flipY true matches the engine's "Human Convention First" default (`Texture.fromUrl`
      // defaults to flipping decode output); the previous explicit `flipY: false` rendered
      // non-KTX2 payloads vertically inverted against every PNG/JPEG asset in the pipeline.
      return await Texture.fromUrl(url, { flipY: true });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Resolves the requested output format id, probing the device for "auto" (the default). */
  private static _resolveFormat(
    format: BasisTranscodeOptions["format"],
    capabilities?: BlockFormatCapabilities,
  ): BasisTranscoderFormatId {
    switch (format) {
      case "rgba8":
        return BasisTranscoderFormat.RGBA32;
      case "bc7":
        return BasisTranscoderFormat.BC7;
      case "astc":
        return BasisTranscoderFormat.ASTC_4x4;
      case "etc2":
        return BasisTranscoderFormat.ETC2;
      case "dxt":
        return BasisTranscoderFormat.BC3;
      case "auto":
      case undefined:
        return detectBestBlockFormat(capabilities) ?? BasisTranscoderFormat.RGBA32;
      default: {
        const exhaustive: never = format;
        throw new Error(`[BasisTranscoder] Unknown format ${exhaustive}`);
      }
    }
  }

  private static _resultToTexture(
    result: BasisDecodeResult,
    _options: BasisTranscodeOptions | undefined,
    format: BasisTranscoderFormatId,
  ): Texture {
    const plane = result.images.find((image) => image.mipLevel === 0);
    if (!plane) {
      throw new Error("[BasisTranscoder] KTX2 file contained no usable image plane");
    }

    // Block-compressed output -> explicit GPU mip chain. ETC1 maps onto ETC2
    // (identical block layout for our purposes), RGBA32 falls back to uncompressed.
    const compressedFormat = engineFormatForBasisFormat(
      format === BasisTranscoderFormat.ETC1 ? BasisTranscoderFormat.ETC2 : format,
    );
    if (compressedFormat) {
      return Texture.fromCompressed({
        format: compressedFormat,
        width: plane.width,
        height: plane.height,
        // K02: the compressed chain gets the same vertical decode flip as the RGBA8
        // path (`_planeToTexture` below) and every `Texture.fromUrl` asset, so the
        // asset orientation matches across all tiers and formats. The mirror is
        // per-format (BC1/BC3/BC7/ASTC/ETC2) and keeps the blocks compressed.
        mipData: flippedCompressedMipChain(result.images, compressedFormat),
      });
    }

    // Uncompressed RGBA8 fallback: preserve all KTX2 mip levels 0..N via Texture.fromRawMipChain
    // (lossless, zero DOM canvas dependency, works across WebGPU/WebGL2/WebGL1/headless tests).
    return this._rgbaChainToTexture(result.images, _options);
  }

  private static _isKtx2(buffer: ArrayBuffer): boolean {
    return hasKtx2Identifier(new Uint8Array(buffer));
  }

  /** Vertically flips an RGBA8 plane in place to match `Texture.fromUrl`'s decode orientation (K02). */
  private static _flipRgbaPlaneInPlace(width: number, height: number, rgba: Uint8Array): void {
    const stride = width * 4;
    for (let top = 0, bottom = height - 1; top < bottom; top++, bottom--) {
      const topStart = top * stride;
      const bottomStart = bottom * stride;
      for (let i = 0; i < stride; i++) {
        const tmp = rgba[topStart + i]!;
        rgba[topStart + i] = rgba[bottomStart + i]!;
        rgba[bottomStart + i] = tmp;
      }
    }
  }

  /**
   * Preserves all decoded RGBA8 mip levels (`0..N`) from the KTX2 payload in a `Texture.rawMipChain`,
   * applying the K02 vertical decode flip to every level before handing the bytes to the renderer.
   */
  private static _rgbaChainToTexture(
    images: BasisDecodeResult["images"],
    options?: BasisTranscodeOptions,
  ): Texture {
    const base = images.find((image) => image.mipLevel === 0);
    if (!base) {
      throw new Error("[BasisTranscoder] KTX2 file contained no usable base RGBA8 plane");
    }

    const levelCount =
      options?.mipmaps === false ? 1 : Math.max(...images.map((image) => image.mipLevel)) + 1;
    const mipData: Uint8Array[] = [];
    for (let level = 0; level < levelCount; level++) {
      const img = images.find((candidate) => candidate.mipLevel === level);
      if (!img) break;
      this._flipRgbaPlaneInPlace(img.width, img.height, img.data);
      mipData.push(img.data);
    }

    return Texture.fromRawMipChain(
      {
        width: base.width,
        height: base.height,
        mipData,
      },
      options?.mipmaps === undefined ? undefined : { generateMipmaps: options.mipmaps },
    );
  }
}
