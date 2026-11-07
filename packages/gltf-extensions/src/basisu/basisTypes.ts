/**
 * Minimal typed view over the Emscripten `basis_transcoder` module exported by
 * `vendor/basis/basis_transcoder.js`. Only the members the transcoder path needs
 * are declared; everything else stays intentionally generic.
 */
export interface BasisModule {
  initializeBasis(): void;
  readonly BasisFile: new (...args: unknown[]) => unknown;
  readonly KTX2File: new (data: Uint8Array) => KTX2File;
  readonly onRuntimeInitialized: unknown;
}

/**
 * Basis Universal transcoder texture format identifiers, matching the official
 * `KTX2Loader.TranscoderFormat` mapping. These are plain integers passed to
 * `getImageTranscodedSizeInBytes` / `transcodeImage`; the emscripten
 * `transcoder_texture_format` enum object on the module is a class instance and
 * not numerically usable, so the constants are kept as literals here.
 *
 * Block-compressed outputs are *hardware* formats uploaded to the GPU as-is; the
 * byte length of one level is `ceil(width/4)*ceil(height/4)*bytesPerBlock`.
 */
export const BasisTranscoderFormat = {
  /** ETC1, RGB, 0.5 bytes/texel -- the smallest ETC1S destination. */
  ETC1: 0,
  /** ETC2, RGBA, 1 byte/texel -- WebGL2 core. */
  ETC2: 1,
  /** BC1 (DXT1), RGB, 0.5 bytes/texel -- only valid for UASTC sources. */
  BC1: 2,
  /** BC3 (DXT5), RGBA, 1 byte/texel -- S3TC devices. */
  BC3: 3,
  /** BC7, RGBA, 1 byte/texel -- highest quality (BPTC / WebGPU bc). */
  BC7: 7,
  /** ASTC 4x4, RGBA, 1 byte/texel -- mobile-oriented. */
  ASTC_4x4: 10,
  /** Uncompressed RGBA8, 4 bytes/texel -- always available fallback. */
  RGBA32: 13,
} as const;

/** Numeric Basis Universal transcoder texture format id (see `BasisTranscoderFormat`). */
export type BasisTranscoderFormatId =
  (typeof BasisTranscoderFormat)[keyof typeof BasisTranscoderFormat];

/**
 * The `KTX2File` class from the Basis Universal transcoder wrapping a
 * supercompressed KTX2 payload. Instances must be `close()`d after use.
 */
export interface KTX2File {
  isValid(): boolean;
  isUASTC(): boolean;
  isETC1S(): boolean;
  isHDR(): boolean;
  getWidth(): number;
  getHeight(): number;
  getLayers(): number;
  getLevels(): number;
  getFaces(): number;
  getHasAlpha(): boolean;
  startTranscoding(): boolean;
  getImageTranscodedSizeInBytes(level: number, layer: number, face: number, format: number): number;
  transcodeImage(
    dst: Uint8Array,
    level: number,
    layer: number,
    face: number,
    format: number,
    decodeFlags: number,
    x: number,
    y: number,
  ): boolean;
  getDFDFlags(): number;
  getImageLevelInfo(
    level: number,
    layer: number,
    face: number,
  ): { width: number; height: number; origWidth: number; origHeight: number };
  close(): void;
}

/** A decoded image plane for one mip level / layer / face. */
export interface BasisDecodedImage {
  mipLevel: number;
  width: number;
  height: number;
  /** Which transcoder format `data` is encoded in (see `BasisDecodedImage.format`). */
  format: number;
  /**
   * Tightly packed plane data: RGBA8 (4 bytes per texel) or block-compressed
   * (`ceil(width/4) * ceil(height/4) * bytesPerBlock` for the format's id).
   */
  data: Uint8Array;
}

export interface BasisDecodeResult {
  width: number;
  height: number;
  hadAlpha: boolean;
  images: BasisDecodedImage[];
}
