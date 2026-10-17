export enum PerformanceTier {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
}

/**
 * Supported boolean features for device capability detection.
 */
export enum DeviceFeature {
  WEBGL1 = "WEBGL1",
  WEBGL2 = "WEBGL2",
  WEBGPU = "WEBGPU",
  CANVAS_ROUND_RECT = "CANVAS_ROUND_RECT",
  OFFSCREEN_CANVAS = "OFFSCREEN_CANVAS",
  TOUCH = "TOUCH",
  GAMEPAD = "GAMEPAD",
  FLOAT_TEXTURES = "FLOAT_TEXTURES",
  COMPRESSED_TEXTURES = "COMPRESSED_TEXTURES",
  ASYNC = "ASYNC",
  WASM = "WASM",
  WORKERS = "WORKERS",
  DEVICE_ORIENTATION = "DEVICE_ORIENTATION",
  DEVICE_MOTION = "DEVICE_MOTION",
  GENERIC_SENSORS = "GENERIC_SENSORS",
  /** `navigator.connection` (Network Information API) -- Chrome/Edge only, absent on Firefox/Safari. */
  NETWORK_INFO = "NETWORK_INFO",
}

/**
 * Supported numeric limits for hardware detection.
 */
export enum DeviceLimit {
  MAX_TEXTURE_SIZE = "MAX_TEXTURE_SIZE",
  MAX_ANISOTROPY = "MAX_ANISOTROPY",
  MAX_UNIFORM_BUFFER_SIZE = "MAX_UNIFORM_BUFFER_SIZE",
  MAX_MSAA_SAMPLES = "MAX_MSAA_SAMPLES",
  MAX_VERTEX_ATTRIBUTES = "MAX_VERTEX_ATTRIBUTES",
  /**
   * Merged (`Math.max()`'d) across whichever of WebGL1/WebGL2 the probes in `init()` found --
   * informational only. A renderer doing an actual bounds-check against the units it can really
   * bind must use its own `WEBGL1_.../WEBGL2_...` variant below instead: WebGL2/GLES3 guarantees
   * more units than WebGL1/GLES2, so on a device where WebGL2 reports more, this merged value can
   * silently exceed what an actually-active WebGL1 context supports.
   *
   * There is deliberately no `WEBGPU_MAX_TEXTURE_IMAGE_UNITS` sibling: "texture image units" (a
   * flat set of global slots bound via `gl.activeTexture()`) is a WebGL-only concept. WebGPU's
   * equivalent per-stage texture budget is `WEBGPU_MAX_SAMPLED_TEXTURES_PER_STAGE` below --
   * named after its own spec limit (`maxSampledTexturesPerShaderStage`) rather than this one,
   * since WebGPU's binding model (separate texture/sampler/bind-group/binding budgets) doesn't
   * map onto WebGL's texture-unit model.
   */
  MAX_TEXTURE_IMAGE_UNITS = "MAX_TEXTURE_IMAGE_UNITS",
  WEBGL1_MAX_TEXTURE_IMAGE_UNITS = "WEBGL1_MAX_TEXTURE_IMAGE_UNITS",
  WEBGL2_MAX_TEXTURE_IMAGE_UNITS = "WEBGL2_MAX_TEXTURE_IMAGE_UNITS",
  MAX_VERTEX_UNIFORM_VECTORS = "MAX_VERTEX_UNIFORM_VECTORS",
  MAX_FRAGMENT_UNIFORM_VECTORS = "MAX_FRAGMENT_UNIFORM_VECTORS",
  /** WebGL2-only: max layers in a `TEXTURE_2D_ARRAY` (used by this engine's `TextureArray`/terrain atlasing). */
  MAX_TEXTURE_ARRAY_LAYERS = "MAX_TEXTURE_ARRAY_LAYERS",
  /** WebGL2-only: max simultaneous framebuffer color attachments (multiple-render-target/deferred rendering). */
  MAX_COLOR_ATTACHMENTS = "MAX_COLOR_ATTACHMENTS",
  /**
   * WebGPU's own per-fragment-stage sampled-texture budget (`maxSampledTexturesPerShaderStage`)
   * -- the WebGPU counterpart to `WEBGL1_.../WEBGL2_MAX_TEXTURE_IMAGE_UNITS` above, deliberately
   * named and tracked separately rather than folded into `MAX_TEXTURE_IMAGE_UNITS`: that field is
   * `Math.max()`'d across WebGL1/WebGL2 probes taken unconditionally at `init()`, regardless of
   * which renderer ends up active, so a higher WebGL number can silently mask a lower real WebGPU
   * one (exactly how a 20-texture WebGPU bind group went undetected on a device whose WebGL2
   * context happened to report 32 units).
   */
  WEBGPU_MAX_SAMPLED_TEXTURES_PER_STAGE = "WEBGPU_MAX_SAMPLED_TEXTURES_PER_STAGE",
  WEBGPU_MAX_SAMPLERS_PER_STAGE = "WEBGPU_MAX_SAMPLERS_PER_STAGE",
  WEBGPU_MAX_BIND_GROUPS = "WEBGPU_MAX_BIND_GROUPS",
  WEBGPU_MAX_BINDINGS_PER_BIND_GROUP = "WEBGPU_MAX_BINDINGS_PER_BIND_GROUP",
  WEBGPU_MAX_UNIFORM_BUFFER_BINDING_SIZE = "WEBGPU_MAX_UNIFORM_BUFFER_BINDING_SIZE",
  WEBGPU_MAX_STORAGE_BUFFER_BINDING_SIZE = "WEBGPU_MAX_STORAGE_BUFFER_BINDING_SIZE",
  WEBGPU_MAX_COMPUTE_WORKGROUP_STORAGE_SIZE = "WEBGPU_MAX_COMPUTE_WORKGROUP_STORAGE_SIZE",
  WEBGPU_MAX_TEXTURE_DIMENSION_2D = "WEBGPU_MAX_TEXTURE_DIMENSION_2D",
}

/**
 * Per-instance hardware and browser feature detection. Construct one per engine instance (see
 * `RendererContext.deviceCaps`) so multiple `SmallWorldMachine`s on one page each get their own, correctly
 * probed capabilities instead of sharing a single process-wide result.
 */
export class DeviceCaps {
  private _isInitialized: boolean = false;

  // Renderers
  private _hasWebGL1: boolean = false;
  private _hasWebGL2: boolean = false;
  private _hasWebGPU: boolean = false;

  // Canvas & Browser Features
  private _hasCanvasRoundRect: boolean = false;
  private _hasOffscreenCanvas: boolean = false;
  private _hasTouch: boolean = false;
  private _hasGamepad: boolean = false;

  // Hardware Limits
  private _maxTextureSize: number = 0;
  private _maxAnisotropy: number = 1;
  private _maxUniformBufferSize: number = 0;
  private _maxMsaaSamples: number = 1;
  private _maxVertexAttributes: number = 0;
  private _maxTextureImageUnits: number = 0;
  private _webgl1MaxTextureImageUnits: number = 0;
  private _webgl2MaxTextureImageUnits: number = 0;
  private _maxVertexUniformVectors: number = 0;
  private _maxFragmentUniformVectors: number = 0;
  private _maxTextureArrayLayers: number = 0;
  private _maxColorAttachments: number = 0;
  private _webgpuMaxSampledTexturesPerStage: number = 0;
  private _webgpuMaxSamplersPerStage: number = 0;
  private _webgpuMaxBindGroups: number = 0;
  private _webgpuMaxBindingsPerBindGroup: number = 0;
  private _webgpuMaxUniformBufferBindingSize: number = 0;
  private _webgpuMaxStorageBufferBindingSize: number = 0;
  private _webgpuMaxComputeWorkgroupStorageSize: number = 0;
  private _webgpuMaxTextureDimension2D: number = 0;

  // Specialized Features
  private _hasFloatTextures: boolean = false;
  private _hasCompressedTextures: boolean = false;
  private _gpuModel: string = "Unknown";
  private _gpuVendor: string = "Unknown";
  private _hasAsync: boolean = false;
  private _hasWasm: boolean = false;
  private _hasWorkers: boolean = false;
  private _hasDeviceOrientation: boolean = false;
  private _hasDeviceMotion: boolean = false;
  private _hasGenericSensors: boolean = false;
  private _hasNetworkInfo: boolean = false;
  private _networkInfo: { effectiveType: string; downlink: number; saveData: boolean } | undefined =
    undefined;

  /**
   * Initializes the feature detection.
   * This is called automatically by the Engine, but can be called manually.
   */
  public init(): void {
    if (this._isInitialized) return;

    // 1. Basic Browser & Platform Checks
    this._hasCanvasRoundRect =
      typeof CanvasRenderingContext2D !== "undefined" &&
      typeof CanvasRenderingContext2D.prototype.roundRect === "function";
    this._hasOffscreenCanvas = typeof OffscreenCanvas !== "undefined";
    this._hasTouch =
      typeof window !== "undefined" &&
      ("ontouchstart" in window ||
        (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0));
    this._hasGamepad = typeof navigator !== "undefined" && !!navigator.getGamepads;

    try {
      this._hasAsync = typeof new Function("return async () => {}")() === "function";
    } catch {
      this._hasAsync = false;
    }
    this._hasWasm =
      typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function";
    this._hasWorkers = typeof Worker !== "undefined";
    this._hasDeviceOrientation =
      typeof window !== "undefined" && "DeviceOrientationEvent" in window;
    this._hasDeviceMotion = typeof window !== "undefined" && "DeviceMotionEvent" in window;
    this._hasGenericSensors = typeof window !== "undefined" && "Sensor" in window;

    const connection = (
      navigator as unknown as {
        connection?: { effectiveType: string; downlink: number; saveData: boolean };
      }
    ).connection;
    this._hasNetworkInfo = !!connection;
    if (connection) {
      this._networkInfo = {
        effectiveType: connection.effectiveType,
        downlink: connection.downlink,
        saveData: connection.saveData,
      };
    }

    // 2. Check WebGL support & limits
    // WebGL 1 -- this probe context is purely throwaway (created only to read GPU limits/
    // extensions), so it MUST be explicitly released via WEBGL_lose_context in a `finally` right
    // after reading it, rather than left for the GC to reclaim eventually: every `SmallWorldMachine`
    // instance gets its own private `DeviceCaps` (see `RendererContext`), so a page creating
    // several engine instances at once (e.g. a comparison showcase running N side-by-side
    // instances) previously leaked 2 never-released contexts per instance until the browser's
    // per-page WebGL context cap was hit and started evicting live rendering contexts.
    let gl: WebGLRenderingContext | null = null;
    try {
      const gl1Canvas = document.createElement("canvas");
      gl = (gl1Canvas.getContext("webgl") ||
        gl1Canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
      this._hasWebGL1 = !!gl;
      if (gl) {
        this._maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        this._maxVertexAttributes = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
        this._maxTextureImageUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
        this._webgl1MaxTextureImageUnits = this._maxTextureImageUnits;
        this._maxVertexUniformVectors = gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS);
        this._maxFragmentUniformVectors = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS);

        // Check Anisotropy
        const extAni =
          gl.getExtension("EXT_texture_filter_anisotropic") ||
          gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic") ||
          gl.getExtension("MOZ_EXT_texture_filter_anisotropic");
        if (extAni) {
          this._maxAnisotropy = gl.getParameter(extAni.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
        }

        // Check Float Textures
        this._hasFloatTextures = !!gl.getExtension("OES_texture_float");

        // Check Compressed Textures (Standard S3TC)
        this._hasCompressedTextures = !!gl.getExtension("WEBGL_compressed_texture_s3tc");

        // Check GPU Model & Vendor
        const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
        if (debugInfo) {
          this._gpuModel = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
          this._gpuVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
        }
      }
    } catch {
      this._hasWebGL1 = false;
    } finally {
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    }

    // WebGL 2 -- same throwaway-probe-context concern as WebGL 1 above.
    let gl2: WebGL2RenderingContext | null = null;
    try {
      const gl2Canvas = document.createElement("canvas");
      gl2 = gl2Canvas.getContext("webgl2") as WebGL2RenderingContext | null;
      this._hasWebGL2 = !!gl2;
      if (gl2) {
        this._maxTextureSize = Math.max(
          this._maxTextureSize,
          gl2.getParameter(gl2.MAX_TEXTURE_SIZE),
        );
        this._maxUniformBufferSize = gl2.getParameter(gl2.MAX_UNIFORM_BLOCK_SIZE);
        this._maxMsaaSamples = gl2.getParameter(gl2.MAX_SAMPLES);
        this._webgl2MaxTextureImageUnits = gl2.getParameter(gl2.MAX_TEXTURE_IMAGE_UNITS);
        this._maxTextureImageUnits = Math.max(
          this._maxTextureImageUnits,
          this._webgl2MaxTextureImageUnits,
        );
        this._maxVertexUniformVectors = Math.max(
          this._maxVertexUniformVectors,
          gl2.getParameter(gl2.MAX_VERTEX_UNIFORM_VECTORS),
        );
        this._maxFragmentUniformVectors = Math.max(
          this._maxFragmentUniformVectors,
          gl2.getParameter(gl2.MAX_FRAGMENT_UNIFORM_VECTORS),
        );
        this._maxTextureArrayLayers = gl2.getParameter(gl2.MAX_ARRAY_TEXTURE_LAYERS);
        this._maxColorAttachments = gl2.getParameter(gl2.MAX_COLOR_ATTACHMENTS);
        this._hasFloatTextures = true; // Required by spec in WebGL2
      }
    } catch {
      this._hasWebGL2 = false;
    } finally {
      gl2?.getExtension("WEBGL_lose_context")?.loseContext();
    }

    // 3. Initial WebGPU check (Limits will be updated by Renderer asynchronously)
    this._hasWebGPU = !!(navigator as unknown as { gpu: unknown }).gpu;

    this._isInitialized = true;
  }

  /**
   * Updates hardware limits. Used by renderers to provide more precise values.
   */
  public updateLimits(limits: {
    maxTextureSize?: number;
    maxUniformBufferSize?: number;
    maxAnisotropy?: number;
    maxMsaaSamples?: number;
    maxTextureImageUnits?: number;
    maxVertexUniformVectors?: number;
    maxFragmentUniformVectors?: number;
    webgpuMaxSampledTexturesPerStage?: number;
    webgpuMaxSamplersPerStage?: number;
    webgpuMaxBindGroups?: number;
    webgpuMaxBindingsPerBindGroup?: number;
    webgpuMaxUniformBufferBindingSize?: number;
    webgpuMaxStorageBufferBindingSize?: number;
    webgpuMaxComputeWorkgroupStorageSize?: number;
    webgpuMaxTextureDimension2D?: number;
  }): void {
    if (limits.maxTextureSize)
      this._maxTextureSize = Math.max(this._maxTextureSize, limits.maxTextureSize);
    if (limits.maxUniformBufferSize)
      this._maxUniformBufferSize = Math.max(
        this._maxUniformBufferSize,
        limits.maxUniformBufferSize,
      );
    if (limits.maxAnisotropy)
      this._maxAnisotropy = Math.max(this._maxAnisotropy, limits.maxAnisotropy);
    if (limits.maxMsaaSamples)
      this._maxMsaaSamples = Math.max(this._maxMsaaSamples, limits.maxMsaaSamples);
    if (limits.maxTextureImageUnits)
      this._maxTextureImageUnits = Math.max(
        this._maxTextureImageUnits,
        limits.maxTextureImageUnits,
      );
    if (limits.maxVertexUniformVectors)
      this._maxVertexUniformVectors = Math.max(
        this._maxVertexUniformVectors,
        limits.maxVertexUniformVectors,
      );
    if (limits.maxFragmentUniformVectors)
      this._maxFragmentUniformVectors = Math.max(
        this._maxFragmentUniformVectors,
        limits.maxFragmentUniformVectors,
      );
    if (limits.webgpuMaxSampledTexturesPerStage)
      this._webgpuMaxSampledTexturesPerStage = Math.max(
        this._webgpuMaxSampledTexturesPerStage,
        limits.webgpuMaxSampledTexturesPerStage,
      );
    if (limits.webgpuMaxSamplersPerStage)
      this._webgpuMaxSamplersPerStage = Math.max(
        this._webgpuMaxSamplersPerStage,
        limits.webgpuMaxSamplersPerStage,
      );
    if (limits.webgpuMaxBindGroups)
      this._webgpuMaxBindGroups = Math.max(this._webgpuMaxBindGroups, limits.webgpuMaxBindGroups);
    if (limits.webgpuMaxBindingsPerBindGroup)
      this._webgpuMaxBindingsPerBindGroup = Math.max(
        this._webgpuMaxBindingsPerBindGroup,
        limits.webgpuMaxBindingsPerBindGroup,
      );
    if (limits.webgpuMaxUniformBufferBindingSize)
      this._webgpuMaxUniformBufferBindingSize = Math.max(
        this._webgpuMaxUniformBufferBindingSize,
        limits.webgpuMaxUniformBufferBindingSize,
      );
    if (limits.webgpuMaxStorageBufferBindingSize)
      this._webgpuMaxStorageBufferBindingSize = Math.max(
        this._webgpuMaxStorageBufferBindingSize,
        limits.webgpuMaxStorageBufferBindingSize,
      );
    if (limits.webgpuMaxComputeWorkgroupStorageSize)
      this._webgpuMaxComputeWorkgroupStorageSize = Math.max(
        this._webgpuMaxComputeWorkgroupStorageSize,
        limits.webgpuMaxComputeWorkgroupStorageSize,
      );
    if (limits.webgpuMaxTextureDimension2D)
      this._webgpuMaxTextureDimension2D = Math.max(
        this._webgpuMaxTextureDimension2D,
        limits.webgpuMaxTextureDimension2D,
      );
  }

  /**
   * Returns whether a specific boolean feature is supported by the current device.
   * @param feature The feature to check.
   */
  public hasFeature(feature: DeviceFeature): boolean {
    if (!this._isInitialized) this.init();
    switch (feature) {
      case DeviceFeature.WEBGL1:
        return this._hasWebGL1;
      case DeviceFeature.WEBGL2:
        return this._hasWebGL2;
      case DeviceFeature.WEBGPU:
        return this._hasWebGPU;
      case DeviceFeature.CANVAS_ROUND_RECT:
        return this._hasCanvasRoundRect;
      case DeviceFeature.OFFSCREEN_CANVAS:
        return this._hasOffscreenCanvas;
      case DeviceFeature.TOUCH:
        return this._hasTouch;
      case DeviceFeature.GAMEPAD:
        return this._hasGamepad;
      case DeviceFeature.FLOAT_TEXTURES:
        return this._hasFloatTextures;
      case DeviceFeature.COMPRESSED_TEXTURES:
        return this._hasCompressedTextures;
      case DeviceFeature.ASYNC:
        return this._hasAsync;
      case DeviceFeature.WASM:
        return this._hasWasm;
      case DeviceFeature.WORKERS:
        return this._hasWorkers;
      case DeviceFeature.DEVICE_ORIENTATION:
        return this._hasDeviceOrientation;
      case DeviceFeature.DEVICE_MOTION:
        return this._hasDeviceMotion;
      case DeviceFeature.GENERIC_SENSORS:
        return this._hasGenericSensors;
      case DeviceFeature.NETWORK_INFO:
        return this._hasNetworkInfo;
      default:
        return false;
    }
  }

  /**
   * Returns a specific hardware limit for the current device.
   * @param limit The limit to query.
   */
  public getLimit(limit: DeviceLimit): number {
    if (!this._isInitialized) this.init();
    switch (limit) {
      case DeviceLimit.MAX_TEXTURE_SIZE:
        return this._maxTextureSize;
      case DeviceLimit.MAX_ANISOTROPY:
        return this._maxAnisotropy;
      case DeviceLimit.MAX_UNIFORM_BUFFER_SIZE:
        return this._maxUniformBufferSize;
      case DeviceLimit.MAX_MSAA_SAMPLES:
        return this._maxMsaaSamples;
      case DeviceLimit.MAX_VERTEX_ATTRIBUTES:
        return this._maxVertexAttributes;
      case DeviceLimit.MAX_TEXTURE_IMAGE_UNITS:
        return this._maxTextureImageUnits;
      case DeviceLimit.WEBGL1_MAX_TEXTURE_IMAGE_UNITS:
        return this._webgl1MaxTextureImageUnits;
      case DeviceLimit.WEBGL2_MAX_TEXTURE_IMAGE_UNITS:
        return this._webgl2MaxTextureImageUnits;
      case DeviceLimit.MAX_VERTEX_UNIFORM_VECTORS:
        return this._maxVertexUniformVectors;
      case DeviceLimit.MAX_FRAGMENT_UNIFORM_VECTORS:
        return this._maxFragmentUniformVectors;
      case DeviceLimit.MAX_TEXTURE_ARRAY_LAYERS:
        return this._maxTextureArrayLayers;
      case DeviceLimit.MAX_COLOR_ATTACHMENTS:
        return this._maxColorAttachments;
      case DeviceLimit.WEBGPU_MAX_SAMPLED_TEXTURES_PER_STAGE:
        return this._webgpuMaxSampledTexturesPerStage;
      case DeviceLimit.WEBGPU_MAX_SAMPLERS_PER_STAGE:
        return this._webgpuMaxSamplersPerStage;
      case DeviceLimit.WEBGPU_MAX_BIND_GROUPS:
        return this._webgpuMaxBindGroups;
      case DeviceLimit.WEBGPU_MAX_BINDINGS_PER_BIND_GROUP:
        return this._webgpuMaxBindingsPerBindGroup;
      case DeviceLimit.WEBGPU_MAX_UNIFORM_BUFFER_BINDING_SIZE:
        return this._webgpuMaxUniformBufferBindingSize;
      case DeviceLimit.WEBGPU_MAX_STORAGE_BUFFER_BINDING_SIZE:
        return this._webgpuMaxStorageBufferBindingSize;
      case DeviceLimit.WEBGPU_MAX_COMPUTE_WORKGROUP_STORAGE_SIZE:
        return this._webgpuMaxComputeWorkgroupStorageSize;
      case DeviceLimit.WEBGPU_MAX_TEXTURE_DIMENSION_2D:
        return this._webgpuMaxTextureDimension2D;
      default:
        return 0;
    }
  }

  /**
   * Returns the spec-guaranteed minimum for `limit` -- the value every conformant device must
   * support, regardless of what THIS device's `getLimit()` actually reports. Useful for code that
   * needs to work correctly even on the lowest-common-denominator device, rather than just the one
   * it happened to be tested on (a higher-than-guaranteed value on a dev machine or this project's
   * headless test sandbox has repeatedly masked real budget-overrun bugs that only surfaced on
   * stricter, spec-minimum hardware).
   */
  public getGuaranteedMinimum(limit: DeviceLimit): number {
    switch (limit) {
      // GLES3/WebGL2 minimum; GLES2/WebGL1 only guarantees 64.
      case DeviceLimit.MAX_TEXTURE_SIZE:
        return 2048;
      // GLES3/WebGL2 minimum; GLES2/WebGL1 only guarantees 8 -- the exact number that caused a
      // real texture-unit collision bug on real hardware earlier in this project's history.
      case DeviceLimit.MAX_TEXTURE_IMAGE_UNITS:
        return 16;
      case DeviceLimit.WEBGL1_MAX_TEXTURE_IMAGE_UNITS:
        return 8;
      case DeviceLimit.WEBGL2_MAX_TEXTURE_IMAGE_UNITS:
        return 16;
      // GLES2 and GLES3 both guarantee at least 16.
      case DeviceLimit.MAX_VERTEX_ATTRIBUTES:
        return 16;
      // GLES2 minimum (128); GLES3 raises it to 256, but WebGL1 is a real fallback in this engine.
      case DeviceLimit.MAX_VERTEX_UNIFORM_VECTORS:
        return 128;
      // GLES2 minimum (16); GLES3 raises it to 224.
      case DeviceLimit.MAX_FRAGMENT_UNIFORM_VECTORS:
        return 16;
      // GLES3/WebGL2 `MAX_UNIFORM_BLOCK_SIZE` minimum, in bytes.
      case DeviceLimit.MAX_UNIFORM_BUFFER_SIZE:
        return 16384;
      // The anisotropic filtering extension itself is optional; no non-trivial degree is
      // guaranteed, so the only safe floor is "none" (a max of 1).
      case DeviceLimit.MAX_ANISOTROPY:
        return 1;
      // WebGL2 does not mandate a non-zero sample count for every color-renderable format; there
      // is no honest non-zero guarantee to give here.
      case DeviceLimit.MAX_MSAA_SAMPLES:
        return 0;
      // GLES3/WebGL2 minimum.
      case DeviceLimit.MAX_TEXTURE_ARRAY_LAYERS:
        return 256;
      case DeviceLimit.MAX_COLOR_ATTACHMENTS:
        return 4;
      // WebGPU spec-mandated minimums (`GPUSupportedLimits` default/guaranteed values).
      case DeviceLimit.WEBGPU_MAX_SAMPLED_TEXTURES_PER_STAGE:
        return 16;
      case DeviceLimit.WEBGPU_MAX_SAMPLERS_PER_STAGE:
        return 16;
      case DeviceLimit.WEBGPU_MAX_BIND_GROUPS:
        return 4;
      case DeviceLimit.WEBGPU_MAX_BINDINGS_PER_BIND_GROUP:
        return 1000;
      case DeviceLimit.WEBGPU_MAX_UNIFORM_BUFFER_BINDING_SIZE:
        return 65536;
      case DeviceLimit.WEBGPU_MAX_STORAGE_BUFFER_BINDING_SIZE:
        return 134217728; // 128MB (WebGPU default minimum)
      case DeviceLimit.WEBGPU_MAX_COMPUTE_WORKGROUP_STORAGE_SIZE:
        return 16384; // 16KB (WebGPU default minimum)
      case DeviceLimit.WEBGPU_MAX_TEXTURE_DIMENSION_2D:
        return 8192;
      default:
        return 0;
    }
  }

  /**
   * Returns the unmasked GPU model if available.
   */
  public get gpuModel(): string {
    return this._gpuModel;
  }

  /**
   * Returns the unmasked GPU vendor if available.
   */
  public get gpuVendor(): string {
    return this._gpuVendor;
  }

  /**
   * Returns Network Information API data if the browser supports it (Chrome/Edge; absent on
   * Firefox/Safari), or `undefined` otherwise.
   */
  public get networkInfo():
    { effectiveType: string; downlink: number; saveData: boolean } | undefined {
    return this._networkInfo;
  }

  /**
   * Returns true if the application is running on a mobile device (phone or tablet).
   */
  public isMobile(): boolean {
    if (typeof window === "undefined") {
      return false;
    }

    if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) {
      return true;
    }

    const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (hasTouch && window.innerWidth <= 1024) {
      return true;
    }

    return false;
  }

  public get cores(): number {
    if (typeof navigator === "undefined") return 4;
    return navigator.hardwareConcurrency || 4;
  }

  public get memoryGB(): number {
    if (typeof navigator === "undefined") return 4;
    return (navigator as unknown as { deviceMemory?: number }).deviceMemory || 4;
  }

  public get pixelRatio(): number {
    if (typeof window === "undefined") return 1;
    return window.devicePixelRatio || 1;
  }

  public get screenWidth(): number {
    if (typeof window === "undefined") return 1920;
    return window.screen.width;
  }

  public get screenHeight(): number {
    if (typeof window === "undefined") return 1080;
    return window.screen.height;
  }

  /**
   * Uses experimental flags and hardware information to guess the device's performance capability.
   */
  public getPerformanceTier(): PerformanceTier {
    if (typeof navigator === "undefined") return PerformanceTier.MEDIUM;

    let score = 0;

    // 1. Hardware Concurrency (Logical CPU cores)
    const cores = this.cores;
    if (cores >= 8) score += 2;
    else if (cores > 4) score += 1;

    // 2. Device Memory (Experimental Web API - returns RAM in GB, capped usually at 8)
    const memory = this.memoryGB;
    if (memory >= 8) score += 2;
    else if (memory > 4) score += 1;

    // 3. Next-Gen API presence (WebGPU)
    if (navigator.gpu) score += 1;

    // 4. Form factor penalty (Mobile devices thermally throttle much faster)
    if (this.isMobile()) {
      score -= 2;
    }

    if (score >= 4) return PerformanceTier.HIGH;
    if (score >= 2) return PerformanceTier.MEDIUM;
    return PerformanceTier.LOW;
  }
}
