import BasisGlue from "../../vendor/basis/basis_transcoder.js?raw";
import basisWasmUrl from "../../vendor/basis/basis_transcoder.wasm?url";
import {
  BasisDecodeResult,
  BasisModule,
  BasisTranscoderFormat,
  BasisTranscoderFormatId,
  KTX2File,
} from "./basisTypes.js";

export interface BasisWasmConfig {
  /** Optional alternate .wasm bytes to load instead of the vendored copy. */
  wasmBinary?: ArrayBuffer;
}

/**
 * Loads the vendored official Basis Universal WebAssembly transcoder and uses it
 * to inflate + transcode `KHR_texture_basisu` KTX2 payloads. The output is either
 * RGBA8 (the universal fallback) or a hardware block-compressed format (BC7/ASTC/
 * ETC2/...) chosen by the caller -- only valid according to what the eventual
 * renderer/device can upload. The WASM module is instantiated exactly once per
 * context and reused across transcode calls. This deliberately delegates the
 * (very intricate) ETC1S/UASTC decoding to the official binary instead of
 * re-implementing it.
 */
export class BasisWasmTranscoder {
  // Cached per binary reference, not globally: several SmallWorldMachine sessions on one page may each
  // configure their own `wasmBinary`, and a single shared static slot would let one session's
  // `getModule()` call invalidate/replace the module another session is still using (the old
  // `_modulePromise`/`_wasmBinary` pair had exactly this cross-instance clobbering). The default
  // vendored binary is cached under `null` (the fetch is shared page-wide anyway), so distinct
  // binaries never fight over the cache; ones with the same reference still share one module.
  private static readonly _modules = new Map<ArrayBuffer | null, Promise<BasisModule>>();

  /**
   * Returns the initialized transcode module for the given configuration's binary (or the
   * vendored default when `wasmBinary` is not supplied), loading + instantiating the WASM on
   * first use. Safe to call concurrently; the promise is cached per binary reference.
   */
  public static async getModule(config?: BasisWasmConfig): Promise<BasisModule> {
    const key = config?.wasmBinary ?? null;
    let cached = this._modules.get(key);
    if (!cached) {
      cached = this._initModule(config).catch((error: unknown) => {
        // Never leave a rejected promise cached: a later retry must perform a fresh load
        // instead of re-observing the same failure (same invariant the AssetManager enforces).
        this._modules.delete(key);
        throw error;
      });
      this._modules.set(key, cached);
    }
    return cached;
  }

  private static async _initModule(config?: BasisWasmConfig): Promise<BasisModule> {
    // The vendored file is an Emscripten factory: strip the trailing CJS/AMD
    // export footer (this project is ESM) and invoke the remaining expression
    // to obtain the module factory function. The glue's Node branch calls
    // `require("fs")/require("path")` only to *build* lazy binary-load closures;
    // those are never invoked because `wasmBinary` is always supplied, so a
    // minimal stub is injected instead of a real CommonJS loader.
    const factorySource = BasisGlue.replace(/if \(typeof exports === 'object'[\s\S]*$/, "");
    // trusted vendored source
    const factory = new Function("require", "__dirname", `${factorySource}\n;return BASIS;`)(
      (id: string): Record<string, unknown> =>
        id === "fs"
          ? { readFileSync: (): void => void 0, statSync: (): void => void 0 }
          : id === "path"
            ? {
                normalize: (p: string): string => p,
                join: (...parts: string[]): string => parts.join("/"),
              }
            : {},
      "",
    ) as (opts: Record<string, unknown>) => unknown;

    const wasmBinary = config?.wasmBinary ?? (await this._loadVendoredWasm());

    // The bindings returned by the Emscripten factory only gain their API surface after full
    // initialization -- and `onRuntimeInitialized` may fire synchronously during the factory call
    // (pre-cached binary) or asynchronously. To avoid both a temporal-dead-zone read of a partially
    // initialized local and a read of an uninitialized module, the module reference is captured on
    // an outer object whose property is always safe to read, and the readiness signal is only used
    // to gate the promise. The resolved module is then fully ready.
    const holder: { module?: BasisModule } = {};
    const module = await new Promise<BasisModule | undefined>((resolve, reject) => {
      try {
        holder.module = factory({
          wasmBinary,
          onRuntimeInitialized: () => resolve(holder.module),
        }) as BasisModule;
      } catch (err) {
        reject(err as Error);
      }
    });

    if (!module) {
      throw new Error("[BasisWasmTranscoder] Transcode module never reported initialization ready");
    }
    module.initializeBasis();
    return module;
  }

  private static async _loadVendoredWasm(): Promise<ArrayBuffer> {
    const res = await fetch(basisWasmUrl);
    if (!res.ok) {
      throw new Error(
        `[BasisWasmTranscoder] Failed to load vendored basis_transcoder.wasm (${res.status})`,
      );
    }
    return res.arrayBuffer();
  }

  /**
   * Transcodes every mip level of the given KTX2 buffer to planes in the requested
   * output format.
   * @param ktx2 The raw KTX2 file bytes (Basis Universal supercompressed).
   * @param config Optional config -- may pin the output format (default RGBA32).
   * @param config.format Target transcoder format id; if unspecified RGBA32 is used.
   * @returns Decoded planes for all mips/faces/layers, tagged with their format.
   */
  public static async transcode(
    ktx2: Uint8Array,
    config?: BasisWasmConfig & { format?: BasisTranscoderFormatId },
  ): Promise<BasisDecodeResult> {
    const module = await this.getModule(config);
    const { format = BasisTranscoderFormat.RGBA32 } = config ?? {};
    const file: KTX2File = new module.KTX2File(ktx2);

    try {
      const isUastc = file.isUASTC();
      if (!isUastc && !file.isETC1S()) {
        throw new Error(
          "[BasisWasmTranscoder] KTX2 uses an unsupported basis encoding (expected ETC1S or UASTC)",
        );
      }

      // BC1 (DXT1) carries no alpha channel; the transcoder only emits BC1 for
      // UASTC sources (ETC1S has no valid BC1 mapping). Guard against requesting
      // an invalid combination.
      if (format === BasisTranscoderFormat.BC1 && !isUastc) {
        throw new Error(
          "[BasisWasmTranscoder] BC1 output is only supported for UASTC sources (ETC1S needs ETC2/BC3/BC7/ASTC)",
        );
      }

      // `isValid()` is a no-op stub in the vendored build, so a failed
      // `startTranscoding()` is the authoritative signal for an unreadable file.
      if (!file.startTranscoding()) {
        throw new Error("[BasisWasmTranscoder] Invalid or unsupported .ktx2 file");
      }

      const width = file.getWidth();
      const height = file.getHeight();
      const levelCount = file.getLevels();
      const layerCount = file.getLayers() || 1;
      const faceCount = file.getFaces();

      const images: BasisDecodeResult["images"] = [];

      for (let level = 0; level < levelCount; level++) {
        for (let layer = 0; layer < layerCount; layer++) {
          for (let face = 0; face < faceCount; face++) {
            const levelInfo = file.getImageLevelInfo(level, layer, face);
            const byteLength = file.getImageTranscodedSizeInBytes(level, layer, face, format);
            const data = new Uint8Array(byteLength);
            const ok = file.transcodeImage(data, level, layer, face, format, 0, -1, -1);
            if (!ok) {
              throw new Error(
                `[BasisWasmTranscoder] .transcodeImage failed (level ${level}, layer ${layer}, face ${face})`,
              );
            }
            images.push({
              mipLevel: level,
              width: levelInfo.origWidth,
              height: levelInfo.origHeight,
              format,
              data,
            });
          }
        }
      }

      return { width, height, hadAlpha: file.getHasAlpha(), images };
    } finally {
      file.close();
    }
  }
}
