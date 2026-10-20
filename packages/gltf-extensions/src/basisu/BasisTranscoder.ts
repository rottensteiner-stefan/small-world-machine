import { Texture } from "@small-world-machine/engine";
import { BasisWasmTranscoder } from "./BasisWasmTranscoder.js";
import type { BasisDecodeResult, BasisTranscoderFormatId } from "./basisTypes.js";
import { BasisTranscoderFormat } from "./basisTypes.js";
import {
  detectBestBlockFormat,
  engineFormatForBasisFormat,
  mipChainFromImages,
} from "./compressedFormats.js";

export interface BasisTranscodeOptions {
  format?: "rgba8" | "bc7" | "astc" | "etc2" | "dxt" | "auto";
  mipmaps?: boolean;
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
    if (this._customHandler) {
      return this._customHandler(buffer, mimeType, options);
    }

    if (this._isKtx2(buffer)) {
      const requestedFormat = this._resolveFormat(options?.format);
      const wasmBinary = this._config.wasmBinary;
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
      return await Texture.fromUrl(url, { flipY: false });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Resolves the requested output format id, probing the device for "auto" (the default). */
  private static _resolveFormat(format: BasisTranscodeOptions["format"]): BasisTranscoderFormatId {
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
        return detectBestBlockFormat() ?? BasisTranscoderFormat.RGBA32;
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
        mipData: mipChainFromImages(result.images),
      });
    }

    // Uncompressed RGBA8 fallback: wrap in a canvas-backed Texture.
    return this._planeToTexture(plane.width, plane.height, plane.data, _options);
  }

  private static _isKtx2(buffer: ArrayBuffer): boolean {
    if (buffer.byteLength < 12) return false;
    const view = new DataView(buffer);
    // KTX2 Identifier: 0xAB 'K' 'T' 'X' ' ' '2' '0' 0xBB 0x0D 0x0A 0x1A 0x0A
    return (
      view.getUint8(0) === 0xab &&
      view.getUint8(1) === 0x4b &&
      view.getUint8(2) === 0x54 &&
      view.getUint8(3) === 0x58 &&
      view.getUint8(4) === 0x20 &&
      view.getUint8(5) === 0x32 &&
      view.getUint8(6) === 0x30 &&
      view.getUint8(7) === 0xbb
    );
  }

  /**
   * Wraps one decoded RGBA8 plane in a Texture. Requires a 2D canvas context
   * (available in any browser); in canvasless environments (e.g. some unit tests)
   * this falls back to an empty texture placeholder.
   */
  private static _planeToTexture(
    width: number,
    height: number,
    rgba: Uint8Array,
    options?: BasisTranscodeOptions,
  ): Texture {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const imageData = ctx.createImageData(width, height);
        imageData.data.set(rgba);
        ctx.putImageData(imageData, 0, 0);
        return Texture.fromCanvas(canvas, { generateMipmaps: options?.mipmaps ?? true });
      }
    } catch {
      // No DOM/canvas available (unit tests / SSR).
    }
    return Texture.empty({ generateMipmaps: options?.mipmaps ?? true });
  }
}
