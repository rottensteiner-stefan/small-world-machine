import { AbstractLight } from "../core/lights/index.js";
import { Color } from "../core/colors/index.js";
import type {
  Renderer,
  LightDataInterface,
  EngineOptions,
  QualityConfig,
  RendererContext,
} from "../interfaces/index.js";
import { ToneMapping, createDefaultRendererContext } from "../interfaces/index.js";
import type { RendererType } from "../enums/index.js";
import type { FrameInfo } from "../interfaces/FrameInfo.js";
import { createFrameInfo } from "../interfaces/FrameInfo.js";
import type { Object3D } from "../core/Object3D.js";
import { FogVolume } from "../core/objects/FogVolume.js";
import type { Scene } from "../core/Scene.js";
import { Vector3D } from "../math/index.js";
import { PostProcessingGroup } from "./post/PostProcessingGroup.js";

/**
 * Base class for all renderer implementations.
 *
 * Backends are expected to implement defensive rendering strategies to prevent "silent failures":
 * 1. Validate that all uniforms defined in a material's layout are actually present in the compiled shader.
 * 2. Log warnings or errors if expected data structures (e.g., WebGPU uniform blocks) are missing or misaligned.
 * 3. Provide fallback values or behaviors if specific features (like rounded rects) are not supported by the hardware.
 */
export abstract class AbstractRenderer implements Renderer {
  /** @inheritdoc */
  public abstract readonly type: RendererType;
  /** The clear color of the renderer. */
  protected _clearColor: Color = new Color(0, 0, 0, 1);

  /** Global quality settings. */
  protected _quality: QualityConfig = {
    mipmapping: true,
    maxAnisotropy: 4,
    msaa: 4,
    maxShadowResolution: 1024,
    hdr: false,
    toneMapping: ToneMapping.NONE,
    gamma: 2.2,
    exposure: 1.0,
    disableTextures: false,
    normalBuffer: "auto",
  };

  /** True while `quality.normalBuffer` was `"auto"` and no consumer has requested it yet. */
  protected _normalBufferAuto: boolean = false;

  /** The global post processing volume/group. */
  public postProcessing: PostProcessingGroup = new PostProcessingGroup();

  /** @inheritdoc */
  public frameInfo: FrameInfo = createFrameInfo();

  /** Optional callback triggered when the GPU context is lost. */
  public onContextLost?: ((info: { reason?: string; message?: string }) => void) | undefined;

  /** Whether the underlying GPU context has been lost. */
  public get isContextLost(): boolean {
    return false;
  }

  /** Cached light data to avoid GC pressure. */
  protected _lightData: LightDataInterface = {
    aCol: new Color(0, 0, 0),
    aIntensity: 0,
    dDir: new Vector3D(0, 1, 0),
    dCol: new Color(0, 0, 0),
    dIntensity: 0,
    pLights: [],
    sLights: [],
    aLights: [],
  };

  /** Per-instance bundle of DeviceCaps/ShaderRegistry/AssetManager -- see RendererContext. */
  public readonly context: RendererContext;

  constructor(context: RendererContext = createDefaultRendererContext()) {
    this.context = context;
  }

  /** @inheritdoc */
  public abstract initialize(
    canvas: HTMLCanvasElement,
    attributes?: Record<string, unknown>,
    config?: EngineOptions,
  ): Promise<void>;

  /** @inheritdoc */
  public abstract render(scene: Scene, vpMatrix: Float32Array, camPos?: Vector3D): void;

  /** @inheritdoc */
  public abstract setSize(width: number, height: number): void;

  /** @inheritdoc */
  public abstract setRenderTarget(
    target:
      | import("../core/textures/index.js").RenderTarget
      | import("../core/textures/index.js").RenderTargetCube
      | null,
    activeCubeFace?: number,
  ): void;

  public destroy(): void {
    // Base implementation does nothing
  }

  /** @inheritdoc */
  public applyPendingOcclusionResults(_scene: Scene): void {
    // Base implementation does nothing -- only WebGPURenderer overrides this.
  }

  /** @inheritdoc */
  public setClearColor(color: Color): void {
    this._clearColor = color;
  }

  /** @inheritdoc */
  public get clearColor(): Color {
    return this._clearColor;
  }

  /** @inheritdoc */
  public get quality(): QualityConfig {
    return this._quality;
  }

  /**
   * Turns `quality.normalBuffer: "auto"` into the effective boolean (off until requested). Call
   * after merging the user's quality config.
   */
  protected _resolveNormalBufferOption(): void {
    this._normalBufferAuto = this._quality.normalBuffer === "auto";
    if (this._normalBufferAuto) this._quality.normalBuffer = false;
  }

  /**
   * Asks for the normal buffer (ADR 0028) because a consumer (a visible decal) needs it. Only
   * acts under `normalBuffer: "auto"`; once on it stays on (no thrashing).
   * @returns True when this call switched it on.
   */
  public requestNormalBuffer(): boolean {
    if (!this._normalBufferAuto) return false;
    this._normalBufferAuto = false;
    this._quality.normalBuffer = true;
    return true;
  }

  /**
   * Extracts all lights from the scene for rendering.
   * @param scene The scene to extract lights from.
   * @returns An object containing all extracted light data.
   */
  public extractLights(scene: Scene): LightDataInterface {
    this._lightData.pLights.length = 0;
    this._lightData.sLights.length = 0;
    this._lightData.aLights.length = 0;
    this._lightData.aCol.set(0, 0, 0);
    this._lightData.aIntensity = 0;
    this._lightData.dCol.set(0, 0, 0);
    this._lightData.dIntensity = 0;
    this._lightData.dDir.set(0, 1, 0);
    this._lightData.dLight = undefined;

    this._traverseLights(scene.root);

    return this._lightData;
  }

  /**
   * Recursively traverses the scene to find lights.
   * @param node The current node to traverse.
   * @private
   */
  private _traverseLights(node: Object3D): void {
    if (node instanceof AbstractLight && node.isVisible) {
      node.applyTo(this._lightData);
    }

    if (undefined !== node.children) {
      for (const child of node.children) {
        this._traverseLights(child);
      }
    }
  }

  protected readonly _fogVolumes: FogVolume[] = [];

  /**
   * Recursively extracts active FogVolume instances from the scene graph.
   */
  public extractFogVolumes(scene: Scene): FogVolume[] {
    this._fogVolumes.length = 0;
    this._traverseFogVolumes(scene.root);
    return this._fogVolumes;
  }

  private _traverseFogVolumes(node: Object3D): void {
    if (node instanceof FogVolume && node.isVisible && node.enabled) {
      this._fogVolumes.push(node);
    }

    if (undefined !== node.children) {
      for (const child of node.children) {
        this._traverseFogVolumes(child);
      }
    }
  }
}
