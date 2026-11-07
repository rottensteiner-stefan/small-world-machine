import { TextureFilter, TextureWrap } from "../../enums/index.js";

/**
 * Configuration options for a {@link VolumetricTexture}.
 */
export interface VolumetricTextureOptions {
  /** The magnification filter (defaults to LINEAR for smooth volumetric sampling). */
  magFilter?: TextureFilter;
  /** The minification filter (defaults to LINEAR). */
  minFilter?: TextureFilter;
  /** The wrapping mode for the U axis (defaults to CLAMP_TO_EDGE). */
  addressModeU?: TextureWrap;
  /** The wrapping mode for the V axis (defaults to CLAMP_TO_EDGE). */
  addressModeV?: TextureWrap;
  /** The wrapping mode for the W axis (defaults to CLAMP_TO_EDGE). */
  addressModeW?: TextureWrap;
}

/**
 * A user-authored 3D data texture (RGBA8, unflipped) for the volumetric fog system.
 *
 * It is the "density mask" of ADR 0031's roadmap (HDRP-style volumetric texture) and carries a
 * per-cell albedo, so local material properties are no longer forced to a single global value:
 *   - R: per-voxel density factor (0..1 softens/voids fog inside the mapped box, >1 amplifies it).
 *   - G: per-voxel single-scattering albedo (0 = pure absorption, 1 = pure scattering).
 *   - B, A: reserved, ignored by the fog passes.
 *
 * Memory layout is D3D-style bottom-up: `data[((z * depth) + y) * width + x]` addresses a texel
 * with `x` along the mask's local X, `y` along its local Z-up axis (row 0 at the bottom) and `z`
 * along its local depth. Upload uses no flip on either renderer, so row 0 always maps to `v = 0`.
 *
 * The consuming passes sample it inside a world-aligned box (element-level) or a FogVolume's local
 * box (volume-level) and clamp at the box boundary; out-of-box cells keep the unmodulated medium.
 */
export class VolumetricTexture {
  /** Number of voxels along the local X axis. */
  public readonly width: number;
  /** Number of voxels along the local vertical axis (row count). */
  public readonly height: number;
  /** Number of voxels along the local depth axis (slice count). */
  public readonly depth: number;
  /** RGBA8 texel data, `width * height * depth` texels (4 bytes each). Row 0 is bottom-up. */
  public readonly data: Uint8Array;
  /** Whether the texture holds usable data and may be uploaded. */
  public isLoaded: boolean;
  /** Set to `true` after mutating `data` in place to force a GPU re-upload next frame. */
  public needsUpdate: boolean = false;

  /** The magnification filter. */
  public magFilter: TextureFilter;
  /** The minification filter. */
  public minFilter: TextureFilter;
  /** The wrapping mode for the U axis. */
  public addressModeU: TextureWrap;
  /** The wrapping mode for the V axis. */
  public addressModeV: TextureWrap;
  /** The wrapping mode for the W axis. */
  public addressModeW: TextureWrap;

  protected constructor(
    data: Uint8Array,
    width: number,
    height: number,
    depth: number,
    options: VolumetricTextureOptions = {},
  ) {
    this.data = data;
    this.width = width;
    this.height = height;
    this.depth = depth;
    this.isLoaded = data.byteLength === width * height * depth * 4;
    this.needsUpdate = false;
    this.magFilter = options.magFilter ?? TextureFilter.LINEAR;
    this.minFilter = options.minFilter ?? TextureFilter.LINEAR;
    this.addressModeU = options.addressModeU ?? TextureWrap.CLAMP_TO_EDGE;
    this.addressModeV = options.addressModeV ?? TextureWrap.CLAMP_TO_EDGE;
    this.addressModeW = options.addressModeW ?? TextureWrap.CLAMP_TO_EDGE;
  }

  /**
   * Creates a volumetric texture from raw RGBA8 data.
   * @param data The RGBA8 texel data, `width * height * depth` texels (row 0 bottom-up).
   * @param width Voxel count along X.
   * @param height Voxel count along the vertical axis (rows).
   * @param depth Voxel count along the depth axis (slices).
   * @param options Optional configuration options.
   * @returns A new VolumetricTexture instance.
   */
  public static fromData(
    data: Uint8Array,
    width: number,
    height: number,
    depth: number,
    options: VolumetricTextureOptions = {},
  ): VolumetricTexture {
    return new VolumetricTexture(data, width, height, depth, options);
  }

  /**
   * Creates a fully scattering, neutral 1x1x1 identity volume. Useful as a placeholder to keep a
   * mask slot bound without affecting density or albedo.
   * @returns A new 1x1x1 VolumetricTexture with R=1, G=1.
   */
  public static identity(): VolumetricTexture {
    return new VolumetricTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, 1);
  }

  /**
   * Releases the CPU-side voxel data. GPU copies are owned by the fog passes and are freed when
   * the passes are destroyed; this only marks the texture as not loaded so consumers fall back to
   * their unmodulated path.
   */
  public dispose(): void {
    this.isLoaded = false;
  }
}
