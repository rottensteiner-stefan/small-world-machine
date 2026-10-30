import { Camera } from "./cameras/Camera.js";
import { Scene } from "./Scene.js";
import { Input } from "./input/Input.js";
import { InteractionManager } from "./input/InteractionManager.js";
import { AudioSystem } from "../audio/AudioSystem.js";
import { EventDispatcherImpl } from "./events/EventDispatcherImpl.js";
import { DeviceFeature, DeviceLimit, PerformanceTier } from "./DeviceCaps.js";
import { FrustumCuller } from "./culling/FrustumCuller.js";
import type { AbstractProjection } from "../math/projections/index.js";
import {
  ObliqueProjection,
  OrthographicProjection,
  PerspectiveProjection,
} from "../math/projections/index.js";
import type {
  EngineOptions,
  ProjectionOptions,
  Renderer,
  RendererContext,
  FrameInfo,
} from "../interfaces/index.js";
import { createDefaultRendererContext, createFrameInfo } from "../interfaces/index.js";
import { ProjectionType, RendererType, PostProcessingEffectType } from "../enums/index.js";
import { QualityConfigResolver } from "./quality/QualityConfigResolver.js";
import { RendererFactory } from "../renderers/index.js";
import { ShaderBootstrap } from "../renderers/shaders/index.js";
import { CollisionVisualizer, OctreeVisualizer } from "../utils/index.js";
import { PhysicsSystem } from "../physix/PhysicsSystem.js";

/** Whether this module instance already printed the console banner. */
let _bannerPrinted: boolean = false;

/** The current engine version. */
export const ENGINE_VERSION = "0.121.0";

/**
 * Halton low-discrepancy sequence, used for TAA's per-frame sub-pixel camera jitter -- covers
 * sub-pixel offsets more evenly over a short cycle than a random or simple grid pattern would.
 * @param index 1-based sample index.
 * @param base Prime base (2 and 3 are the standard pairing for 2D jitter).
 */
function halton(index: number, base: number): number {
  let result = 0;
  let f = 1 / base;
  let i = index;
  while (0 < i) {
    result += f * (i % base);
    i = Math.floor(i / base);
    f /= base;
  }
  return result;
}

/**
 * Base class for applications built with the SmallWorldMachine engine.
 */
export abstract class SmallWorldMachine {
  /** The engine configuration. */
  public config: EngineOptions;
  /** The current scene. */
  public scene: Scene;
  /** The main camera. */
  public camera: Camera;
  /** The active renderer. */
  public renderer: Renderer;
  private _context!: RendererContext;
  /** Per-instance bundle of DeviceCaps/ShaderRegistry/AssetManager -- see RendererContext. */
  public get context(): RendererContext {
    return this._context;
  }
  /** The built-in physics system. Stepped automatically each frame when `config.enablePhysics` is true. */
  public physics: PhysicsSystem;
  /** The interaction manager for gamification / picking. */
  public interactionManager!: InteractionManager;
  public readonly input: Input = new Input();
  public readonly audio: AudioSystem;
  private readonly _octreeVisualizer: OctreeVisualizer = new OctreeVisualizer();
  private readonly _collisionVisualizer: CollisionVisualizer = new CollisionVisualizer();
  private readonly _frustumCuller: FrustumCuller = new FrustumCuller();
  /** The canvas element. */
  public canvas!: HTMLCanvasElement;
  /** Whether debug visualization is enabled. */
  public debug: boolean = false;

  /** The global event bus for this engine instance. */
  public events: EventDispatcherImpl = new EventDispatcherImpl();

  private _lastTime: number = 0;
  private _isRunning: boolean = false;
  private _isInitialized: boolean = false;
  private _isDestroyed: boolean = false;
  private _hitStopRemaining: number = 0;
  private _hitStopScale: number = 1;
  private _taaFrameIndex: number = 0;
  private readonly _frameInfo: FrameInfo = createFrameInfo();

  /**
   * Fixed capture frame rate (like Unity's `Time.captureFramerate`, Godot's `--fixed-fps`). When
   * greater than 0 the realtime loop advances by exactly `1 / captureFrameRate` seconds per frame,
   * independent of wall-clock time, so recordings and golden runs are reproducible. 0 = off.
   */
  public captureFrameRate: number = 0;

  /**
   * Telemetry for the REALTIME loop's frame clamp (S3 m2) -- deliberately DISTINCT from
   * `physics.droppedSteps`: a second monotonic counter of the wall-clock seconds the `_loop()`
   * clamp (0.1 s, see `_loop`) silently swallowed because a single frame's raw delta exceeded it
   * (a hitch/tab-throttle/overflow). `physics.droppedSteps` counts spiral-of-death drops of the
   * fixed-step accumulator and is unreachable on the realtime path (0.1 s < 10 × 1/60), so this
   * field is the only honest signal that realtime time was dropped. The `step()` harness never
   * clamps, so this stays 0 under capture stepping. Monotonic; reset by assigning 0.
   */
  public realtimeClampedDropSeconds: number = 0;

  /** Timing context of the last stepped frame (gameplay and real time, frame index). */
  public get frameInfo(): Readonly<FrameInfo> {
    return this._frameInfo;
  }

  /**
   * Creates a new SmallWorldMachine application.
   * @param userConfig Optional configuration to override defaults.
   */
  protected constructor(userConfig: EngineOptions = {}) {
    this.config = {
      canvasId: "SmallWorldMachine",
      rendererType: RendererType.DEFAULT,
      projectionType: ProjectionType.DEFAULT,
      fullscreen: true,
      ...userConfig,
    };

    this.scene = new Scene();

    this.audio = new AudioSystem(undefined, this.events);
    this.physics = new PhysicsSystem(this.events);
    if (this.config.gravity) {
      this.physics.gravity.set(...this.config.gravity);
    }

    const initialAspect: number = window.innerWidth / window.innerHeight;
    const projection: AbstractProjection =
      this.config.projectionInstance ??
      ((): AbstractProjection => {
        const projectionBuilders: Partial<
          Record<
            ProjectionType,
            (opts: ProjectionOptions | undefined, initialAspect: number) => AbstractProjection
          >
        > = {
          [ProjectionType.PERSPECTIVE]: PerspectiveProjection.fromConfig,
          [ProjectionType.ORTHOGRAPHIC]: OrthographicProjection.fromConfig,
          [ProjectionType.OBLIQUE]: ObliqueProjection.fromConfig,
        };
        const build =
          projectionBuilders[this.config.projectionType ?? ProjectionType.DEFAULT] ??
          PerspectiveProjection.fromConfig;
        return build(this.config.projectionOptions, initialAspect);
      })();
    this.camera = new Camera(projection);
    this.renderer = undefined!; // Initialized in start()

    this.input.init();
  }

  /**
   * Called to setup the scene after the engine is initialized.
   */
  protected abstract setupScene(): Promise<void>;

  /**
   * Called every frame to update application logic.
   * @param deltaTime Time elapsed since the last frame in seconds.
   */
  protected abstract update(deltaTime: number): void;

  /**
   * Initializes and starts the application loop.
   */
  public async start(): Promise<void> {
    if (this._isRunning) {
      return;
    }

    if (!this._isInitialized) {
      this._context = createDefaultRendererContext();

      // ADR 0035, Ebene 2: ONE resolution step before the renderer is created. The tier policy
      // (device tier -> quality/post settings) is applied exactly once and the configuration is
      // closed afterwards -- no more later mutation of config.quality/postProcessing. Explicit
      // author-set fields always win (Ebene 3, generic override lock).
      if (this.config.performanceTier) {
        this._context.deviceCaps.forcedTier = this.config.performanceTier;
      }
      const tier = this._context.deviceCaps.getPerformanceTier();
      if (tier === PerformanceTier.LOW) {
        console.warn(
          `📉 Low Performance Tier detected (${this._context.deviceCaps.isMobile() ? "Mobile" : "Desktop"}). Applying tier quality policy.`,
        );
      }
      const resolvedQuality = QualityConfigResolver.resolve(
        tier,
        this.config.quality,
        this.config.postProcessing,
      );
      this.config.quality = resolvedQuality.quality;
      this.config.postProcessing = resolvedQuality.postProcessing;

      this.canvas = document.getElementById(this.config.canvasId!) as HTMLCanvasElement;
      if (!this.canvas) {
        await new Promise<void>((resolve: () => void): void => {
          if ("loading" === document.readyState) {
            document.addEventListener("DOMContentLoaded", (): void => resolve(), { once: true });
            setTimeout((): void => {
              resolve();
            }, 500);
          } else {
            resolve();
          }
        });
        this.canvas = document.getElementById(this.config.canvasId!) as HTMLCanvasElement;
      }

      let retries: number = 0;
      while (!this.canvas && 5 > retries) {
        await new Promise<void>((resolve: () => void): void => {
          setTimeout((): void => {
            resolve();
          }, 100);
        });
        this.canvas = document.getElementById(this.config.canvasId!) as HTMLCanvasElement;
        retries++;
      }

      if (!this.canvas) {
        throw new Error(
          `[SmallWorldMachine] Canvas element with ID '${this.config.canvasId}' not found in DOM.`,
        );
      }
      if (this.config.fullscreen) {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        window.addEventListener("resize", this._onResize);
      } else if (this.config.width && this.config.height) {
        this.canvas.width = this.config.width;
        this.canvas.height = this.config.height;
      }

      // Captured before renderer creation: the WebGPU renderer sizes itself during init, which
      // already scales canvas.width by the pixel ratio, so re-reading it would apply DPR twice.
      const cssWidth = this.canvas.width;
      const cssHeight = this.canvas.height;

      await ShaderBootstrap.init(this._context.shaderRegistry);

      this._context.deviceCaps.init();

      this.renderer = await RendererFactory.create(
        this.config.rendererType!,
        this.canvas,
        this.config,
        this._context,
      );

      this.renderer.setSize(cssWidth, cssHeight);

      // Cosmetic once-per-module console banner. Module state instead of a `window` flag: it
      // pollutes no global namespace, and instances of separately bundled engines each print once.
      if (!_bannerPrinted) {
        _bannerPrinted = true;
        const bannerStyle1 =
          "font-size: 24px; font-weight: bold; font-family: sans-serif; color: #B000FF; text-shadow: 0 0 10px rgba(176, 0, 255, 0.5); line-height: 30px;";

        const bannerStyle3 = "font-size: 12px; font-family: sans-serif; color: #aaa;";
        console.log(
          `%c Small World Machine, v${ENGINE_VERSION} %c\n\n%c A very small 3D engine focusing on raw WebGL performance.\n https://github.com/rottensteiner-stefan/small-world-machine\n\n`,
          bannerStyle1,
          "",
          bannerStyle3,
        );
        const rendererLabels: Record<string, string> = {
          [RendererType.WEB_GPU]: "WebGPU",
          [RendererType.WEB_GL2]: "WebGL2",
          [RendererType.WEB_GL1]: "WebGL1",
        };
        console.table({
          "Active Renderer": rendererLabels[this.renderer.type] ?? this.renderer.type,
          "Device Type": this._context.deviceCaps.isMobile() ? "Mobile" : "Desktop",
          "Performance Tier": this._context.deviceCaps.getPerformanceTier(),
          "GPU Model": this._context.deviceCaps.gpuModel,
          "GPU Vendor": this._context.deviceCaps.gpuVendor,
          "CPU Cores": this._context.deviceCaps.cores,
          "Memory (GB)": this._context.deviceCaps.memoryGB,
          "Screen Resolution": `${this._context.deviceCaps.screenWidth}x${this._context.deviceCaps.screenHeight}`,
          "Pixel Ratio": this._context.deviceCaps.pixelRatio,
          "API - WebGL1": this._context.deviceCaps.hasFeature(DeviceFeature.WEBGL1) ? "Yes" : "No",
          "API - WebGL2": this._context.deviceCaps.hasFeature(DeviceFeature.WEBGL2) ? "Yes" : "No",
          "API - WebGPU": this._context.deviceCaps.hasFeature(DeviceFeature.WEBGPU) ? "Yes" : "No",
          "Max Texture Size": this._context.deviceCaps.getLimit(DeviceLimit.MAX_TEXTURE_SIZE),
          "Max Texture Units": this._context.deviceCaps.getLimit(
            DeviceLimit.MAX_TEXTURE_IMAGE_UNITS,
          ),
          "Max Anisotropy": this._context.deviceCaps.getLimit(DeviceLimit.MAX_ANISOTROPY),
          "Max Uniform Buffer Size": this._context.deviceCaps.getLimit(
            DeviceLimit.MAX_UNIFORM_BUFFER_SIZE,
          ),
          "Max MSAA Samples": this._context.deviceCaps.getLimit(DeviceLimit.MAX_MSAA_SAMPLES),
          "Max Vertex Attributes": this._context.deviceCaps.getLimit(
            DeviceLimit.MAX_VERTEX_ATTRIBUTES,
          ),
          "Max Vertex Uniforms": this._context.deviceCaps.getLimit(
            DeviceLimit.MAX_VERTEX_UNIFORM_VECTORS,
          ),
          "Max Fragment Uniforms": this._context.deviceCaps.getLimit(
            DeviceLimit.MAX_FRAGMENT_UNIFORM_VECTORS,
          ),
          "Feature - Float Textures": this._context.deviceCaps.hasFeature(
            DeviceFeature.FLOAT_TEXTURES,
          )
            ? "Yes"
            : "No",
          "Feature - Compressed Textures": this._context.deviceCaps.hasFeature(
            DeviceFeature.COMPRESSED_TEXTURES,
          )
            ? "Yes"
            : "No",
          "Feature - Offscreen Canvas": this._context.deviceCaps.hasFeature(
            DeviceFeature.OFFSCREEN_CANVAS,
          )
            ? "Yes"
            : "No",
          Network: this._context.deviceCaps.networkInfo
            ? `${this._context.deviceCaps.networkInfo.effectiveType}, ${this._context.deviceCaps.networkInfo.downlink}Mbps${this._context.deviceCaps.networkInfo.saveData ? ", data saver" : ""}`
            : "N/A",
        });
      }

      this.camera.aspect = this.canvas.clientWidth / this.canvas.clientHeight;
      this.camera.updateProjectionMatrix();

      this.interactionManager = new InteractionManager(
        this.scene,
        this.camera,
        this.canvas,
        this.input,
      );

      await this.setupScene();

      this._isInitialized = true;
    }

    window.addEventListener("pagehide", this._onPageHide);
    this._isRunning = true;
    this._lastTime = performance.now();
    requestAnimationFrame(this._onFrame);
  }

  /**
   * Advances the engine by exactly one simulated frame, running the same per-frame body that the
   * realtime loop executes (input, gameplay update, physics, scene, camera, culling, rendering).
   * Decoupled from the wall clock and the run state: it steps with the exact `deltaTime` passed
   * in, keeps working after `stop()`, never calls `requestAnimationFrame`, and never reads or
   * writes `_isRunning`. This is the deterministic fixed-timestep hook for golden baselines and
   * test harnesses, where animated scenes must be reproducible independent of real elapsed time.
   *
   * @invariant FRAME-ORDER: Die Phasen-Reihenfolge innerhalb dieses Frames ist fix (physics ->
   * Interpolation -> Kamera -> Lights/Cascades -> Frustum-Cull -> Render); ein Reorder bricht die
   * Oracle-Tests (tests/core/SmallWorldMachinePhaseOrder.test.ts) laut, siehe ADR 0047 Registry.
   *
   * Goldener Harness-Vertrag (S3 m3 / DP-7-S3): `step()` ist NUR unter diesen vier Vorbedingungen
   * ein reproduzierbarer, deterministischer Golden-Hook -- wer davon abweicht, sieht mit
   * Absicht Varianz:
   *  - `deltaTime` fix und <= 1/60 (z. B. exakt 1/60); größere Werte aktivieren echte
   *    Multi-Substep-Simulation bzw. Sub-Frame-Restakkumulator und sind weiterhin korrekt, aber
   *    nicht mehr bit-exakt zu einem 60-Hz-Lauf vergleichbar;
   *  - Occlusion-Culling aus (`config.enableOcclusionCulling === false`): die HZB-Readback-Latenz
   *    (1-3 Frames) macht das GPU-Ergebnis frameblock-abhängig;
   *  - deterministischer Input (keine realen Event-/Timer-Quellen; `Input.update()` selbst ist
   *    zustandslos pro Frame);
   *  - stabile Canvas-Abmessungen (kein `resize` im Testlauf; die TAA-Jitter-Skalierung und die
   *    Render-Guard hängen von `clientWidth/Height` ab).
   * Hinweis zu den A8-Doku-Korrekturen: `PhysicsSystem.maxSubSteps` ist 10 und NICHT 4, und der
   * echte Realtime-Frame-Clamp liegt bei 0,1 s (`_loop`), nicht bei `maxDeltaTime` (0,25 s ist nur
   * direkt per `physics.step` erreichbar). `realtimeClampedDropSeconds` macht Realtime-Clamp-Drops
   * beobachtbar; `step()` selbst clamp/t droppt nie.
   * @param deltaTime Simulated elapsed seconds for this step (e.g. `1/60` for 60 Hz); forwarded to `update()`.
   * @throws If called after `destroy()` or with a negative / non-finite `deltaTime`.
   */
  public step(deltaTime: number): void {
    if (this._isDestroyed) {
      throw new Error("[SmallWorldMachine] step() called after destroy().");
    }
    if (!Number.isFinite(deltaTime) || 0 > deltaTime) {
      throw new Error(
        `[SmallWorldMachine] step() requires a finite deltaTime >= 0, got ${deltaTime}.`,
      );
    }
    let gameplayDeltaTime: number = deltaTime;
    if (0 < this._hitStopRemaining) {
      gameplayDeltaTime = deltaTime * this._hitStopScale;
      this._hitStopRemaining -= deltaTime;
    }

    const frame = this._frameInfo;
    frame.deltaTime = gameplayDeltaTime;
    frame.realDeltaTime = deltaTime;
    frame.time += gameplayDeltaTime;
    frame.realTime += deltaTime;
    frame.frameIndex++;
    this.renderer.frameInfo = frame;

    this.input.update();
    this.update(gameplayDeltaTime);

    if (this.config.enablePhysics) {
      this.physics.step(this.scene, gameplayDeltaTime);
    }

    this.scene.update(gameplayDeltaTime);

    // ------------------------------------------------------------------------------------------
    // Phases. RATIFIED ORDER (see registry invariant FRAME-ORDER, ADR 0047) -- do not reorder.
    //
    //   1. physics step            (above; fixed-timestep accumulator intact)
    //   2. scene update / skinning (above)
    //   3. render interpolation    -> the following phases see the interpolated render pose
    //   4. camera update           -> the camera / its behaviors are no longer one frame behind
    //   5. lights / cascades       -> cascade frusta are built from the CURRENT camera pose
    //   6. frustum cull            -> tests the interpolated render bounds (not the discrete pose)
    //   7. render
    //
    // This fixes the audited M1/M2/M3/M4 defects: cascades lag (updateLights ran before the
    // camera), the follow-camera read a discrete one-frame-stale target, and culling tested the
    // discrete pose. This pins the invariant FRAME-ORDER (ADR 0047); the phase-order oracle test
    // `tests/core/SmallWorldMachinePhaseOrder.test.ts` -- a reorder of the blocks below breaks
    // that test loudly by design.
    // ------------------------------------------------------------------------------------------

    // TAA sub-pixel jitter: baked into the camera's view-projection matrix by updateViewMatrix()
    // below (via camera.update() -> ... -> updateViewMatrix()). Only applied while TAA is
    // enabled and the canvas has a real size, and reset to 0 otherwise so toggling TAA off
    // doesn't leave a stale offset baked into the camera.
    const taaNode = this.renderer.postProcessing.get<
      import("../renderers/post/index.js").TaaElement
    >(PostProcessingEffectType.TAA);
    if (taaNode && taaNode.enabled && 0 < this.canvas.clientWidth && 0 < this.canvas.clientHeight) {
      this._taaFrameIndex = (this._taaFrameIndex % 16) + 1;
      const jitterScale = 1.0; // in texels
      this.camera.jitterX =
        ((halton(this._taaFrameIndex, 2) - 0.5) * 2.0 * jitterScale) / this.canvas.clientWidth;
      this.camera.jitterY =
        ((halton(this._taaFrameIndex, 3) - 0.5) * 2.0 * jitterScale) / this.canvas.clientHeight;
    } else {
      this.camera.jitterX = 0;
      this.camera.jitterY = 0;
    }

    // Phase 3 -- render interpolation AFTER scene update (so `updateMatrixWorld`/skinning already
    // ran on the discrete pose) and BEFORE the camera/cull/render phases. `applyRenderInterpolation`
    // leaves `position`/`rotation` at the discrete simulated pose and only the `worldMatrix` blended;
    // camera-follow consumers of physics bodies must read the interpolated pose via
    // `PhysicsSystem.getInterpolatedPosition()` (see `EulerIntegrator` position-vs-worldMatrix
    // window documentation, DP-2A) -- the camera jitter fix on high-Hz displays depends on it.
    if (this.config.enablePhysics) {
      this.physics.applyRenderInterpolation();
    }

    // Phase 4 -- camera. Real deltaTime, not gameplayDeltaTime: the camera (and its shake/flash
    // effects) keeps running at full speed during hit-stop, which is what sells the freeze-frame
    // impact. `updateViewMatrix()` is invoked inside `camera.update()`; with interpolation now
    // applied above, the camera pose is no longer one frame behind the simulated world.
    this.camera.update(this.camera.target, 0, 0, deltaTime);

    // Forward the camera's aggregated flash state into the renderer's post-processing element,
    // mirroring the TAA jitter feedback above but in the opposite direction (camera -> renderer).
    const flashNode = this.renderer.postProcessing.get<
      import("../renderers/post/index.js").FlashElement
    >(PostProcessingEffectType.FLASH);
    if (flashNode) {
      flashNode.intensity = this.camera.flashIntensity;
      flashNode.color.copyFrom(this.camera.flashColor);
    }

    if (this.interactionManager) {
      this.interactionManager.update();
    }

    // Phase 5 -- lights / shadow cascades: AFTER the camera phase, so `DirectionalLight.updateCascades`
    // derives its frusta from THIS frame's camera pose instead of last frame's (M1).
    this.scene.updateLights(this.camera);

    if (this.config.enableOcclusionCulling) {
      this.renderer.applyPendingOcclusionResults?.(this.scene);
    }

    // Phase 6 -- frustum cull: AFTER interpolation, so culling tests the interpolated render
    // bounds of physics bodies, not their discrete simulated pose (M4).
    this._frustumCuller.cull(this.scene, this.camera.viewProjectionMatrix4);

    if (this.debug) {
      this._collisionVisualizer.update(this.scene);
      this._octreeVisualizer.update(this.scene, this._frustumCuller.lastIntersectedNodes);
    }

    if (this.canvas.clientWidth > 0 && this.canvas.clientHeight > 0) {
      // HBAO's view-space reconstruction assumes a symmetric perspective projection matrix;
      // leave it undefined for other projection types so the effect just no-ops there.
      const projMatrix: Float32Array | undefined =
        this.camera.projection.type === ProjectionType.PERSPECTIVE
          ? this.camera.projection.getMatrix().data
          : undefined;

      this.renderer.render(
        this.scene,
        this.camera.viewProjectionMatrix,
        this.camera.position,
        this.camera.viewMatrix,
        this.camera.projection.near,
        this.camera.projection.far,
        projMatrix,
      );
    }

    this.input.mouse.dx = 0;
    this.input.mouse.dy = 0;
    this.input.mouse.wheelX = 0;
    this.input.mouse.wheelY = 0;
    this.input.mouse.zoom = 0;
  }

  /**
   * Stops the application loop.
   */
  public stop(): void {
    this._isRunning = false;
  }

  /**
   * Invalidates every temporal/occlusion-history state that assumes a continuous camera path
   * (S3 DP-4A / M5/M6/M7). Call synchronously after teleporting or hard-cutting the camera (level
   * load, portal, cinematic jump, respawn): it fans out to ALL state-holding tiers:
   *  - TAA history reset (`HistoryBlendPassGPU` / `HistoryBlendPassGL`, both tiers) - otherwise a
   *    cut ghosts/smears against the pre-cut history (M5);
   *  - volumetric-fog temporal history reset (`VolumetricFogPassGPU`) - fresh in-scattering instead
   *    of reprojecting a stale volume across the cut (M6, WebGPU-only; WebGL2 fog is non-temporal,
   *    WebGL1 has none);
   *  - a scene-wide `occlusionCulled = false` walk AND the `HzbOcclusionSystem` `_occludedStreak`
   *    clear - otherwise the next HZB apply re-culls on a stale per-object streak after the camera
   *    pointed elsewhere for exactly one readback window (M7, mandatory per E2).
   * WebGL1 is an honest no-op on the renderer side (ADR 0043: no temporal/occlusion state there;
   * the scene walk stays a harmless no-op since `occlusionCulled` is never set).
   *
   * Synchronous, idempotent, void, scalar-free (ADR 0047 classification n/a). Rule-of-Three is MET
   * (TAA + fog + occlusion = 3 semantic consumers). This is an explicit EXTENSION of ADR 0008's
   * deferred non-goal (teleport invalidation), see docs/adr/0008-... "Erweiterung (S3)".
   */
  public notifyCameraTeleport(): void {
    this.renderer.notifyCameraTeleport?.(this.scene);
    this.scene.resetOcclusionCulled();
  }

  /**
   * Briefly slows down gameplay (app update, physics, scene behaviors) to sell the impact of a
   * hit, while the camera and its effects (e.g. shake) keep running in real time. Rendering and
   * input are unaffected. Global, not per-entity -- see `docs/adr/0003-hit-stop-is-global-not-per-entity.md`.
   * @param duration Real-time seconds the slowdown lasts.
   * @param timeScale Multiplier applied to deltaTime for gameplay systems while active. Default 0.05 (near-freeze).
   */
  public triggerHitStop(duration: number, timeScale: number = 0.05): void {
    this._hitStopRemaining = duration;
    this._hitStopScale = timeScale;
  }

  /**
   * Destroys the engine instance, freeing memory and removing all global event listeners.
   */
  public destroy(): void {
    this.stop();
    this._isInitialized = false;
    this._isDestroyed = true;

    window.removeEventListener("resize", this._onResize);
    window.removeEventListener("pagehide", this._onPageHide);

    if (this.input && this.input.destroy) {
      this.input.destroy();
    }
    if (this.renderer && this.renderer.destroy) {
      this.renderer.destroy();
    }
    this.audio.dispose();
  }

  private _onPageHide = (): void => {
    this.destroy();
  };

  private _onResize = (): void => {
    if (!this.canvas) return;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.camera.aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    this.camera.updateProjectionMatrix();
    if (this.renderer) {
      this.renderer.setSize(this.canvas.width, this.canvas.height);
    }
  };

  private readonly _onFrame = (time: number): void => this._loop(time);

  /**
   * The main application loop.
   * @param currentTime The current timestamp.
   */
  private _loop(currentTime: number): void {
    if (!this._isRunning) {
      return;
    }

    if (this.canvas && !document.body.contains(this.canvas)) {
      console.warn("[SmallWorldMachine] Canvas removed from DOM. Auto-destroying engine.");
      this.destroy();
      return;
    }

    const rawDeltaMs: number = currentTime - this._lastTime;
    let deltaTime: number;
    if (0 < this.captureFrameRate) {
      deltaTime = 1.0 / this.captureFrameRate;
    } else {
      const rawDelta: number = rawDeltaMs / 1000.0;
      // Real frame clamp 0.1 s (S3 m2): any wall-clock time beyond it is swallowed, not deferred.
      // Make that drop observable via `realtimeClampedDropSeconds` (distinct from
      // `physics.droppedSteps`, which can never fire here -- 0.1 s < 10 x 1/60).
      if (rawDelta > 0.1) {
        this.realtimeClampedDropSeconds += rawDelta - 0.1;
      }
      deltaTime = 0 <= rawDelta ? Math.min(rawDelta, 0.1) : 0;
    }
    this._lastTime = currentTime;

    this.step(deltaTime);

    requestAnimationFrame(this._onFrame);
  }
}
