import { SmallWorldMachine } from "../index.js";
import { EngineOptions } from "../../interfaces/index.js";
import { CameraStrategyType, Keys, RendererType } from "../../enums/index.js";
import { Vector3D } from "../../math/index.js";
import { FlyController, OrbitController } from "../controllers/index.js";

/**
 * Window-level event dispatched by {@link AbstractShowcase} once `start()` has finished setting up
 * the scene (including awaited asset loads) and the render loop has produced a stable frame. Lets
 * external tooling (preview, visual QA, e2e tests) hook into readiness instead of racing a fixed
 * delay. The event's `detail` carries the resolved renderer type, so consumers can also verify
 * which backend actually came up.
 */
export const SHOWCASE_READY_EVENT = "small-world-machine:scene-ready";

/**
 * Reads a `?rendererType=` override from the page URL (e.g. `?rendererType=WEB_GL2`),
 * matched case-insensitively against `RendererType`'s members and common aliases. Lets any showcase's
 * renderer be swapped from the address bar or UI switcher without touching its source.
 */
function getRendererTypeFromQuery(): RendererType | undefined {
  if (typeof window === "undefined" || !window.location) return undefined;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("rendererType");
  if (!raw) return undefined;
  const upper = raw.toUpperCase().replace(/-/g, "_");
  if (upper === "WEBGL2" || upper === "GLSL" || upper === "WEB_GL2") return RendererType.WEB_GL2;
  if (upper === "WEBGPU" || upper === "WGSL" || upper === "WEB_GPU") return RendererType.WEB_GPU;
  if (upper === "WEBGL1" || upper === "WEB_GL1") return RendererType.WEB_GL1;
  return (Object.values(RendererType) as string[]).includes(upper)
    ? (upper as RendererType)
    : undefined;
}

/**
 * IDs of the actually-existing numbered showcases (`apps/showcases/<id>/`), in navigation order.
 * Not a contiguous 1..N range -- 25 was retired (absorbed into Showcase 10's Waterworld rebuild)
 * and the gap was intentionally kept instead of renumbering everything after it. Kept as an
 * explicit list (mirrors the showcase registries already hand-maintained in vite.config.ts and
 * scripts/check-showcases.js) so PREV/NEXT skips the gap instead of computing a dead ID.
 */
const VALID_SHOWCASE_IDS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 27, 28,
  29, 30, 31, 32, 33, 34, 35, 36, 37, 38,
];

export abstract class AbstractShowcase extends SmallWorldMachine {
  /**
   * Renderer-switch hotkeys: Option/Alt+1 opens WebGL1, +2 WebGL2, +3 WebGPU. The digits are
   * matched by `event.code` (top-row digit keys) so the combo works on any keyboard layout.
   * Option/Alt+digits is the only conflict-free modifier pairing: plain Cmd+1..9 is taken by
   * browser tab switching, Cmd+Shift+3/4 by macOS screenshots, bare 1/2/3 by Showcase 38's
   * camera presets, and F-keys by macOS media/brightness. On macOS `event.altKey` reports the
   * Option key, on Windows/Linux plain Alt -- one handler covers every platform.
   */
  private static readonly _RENDERER_SWITCH_KEYS: Readonly<Record<string, RendererType>> = {
    [Keys.D1]: RendererType.WEB_GL1,
    [Keys.D2]: RendererType.WEB_GL2,
    [Keys.D3]: RendererType.WEB_GPU,
  };

  private _showcaseKeyDownHandler = (event: KeyboardEvent): void => this.onKeyDown(event);
  private _navButtons: HTMLButtonElement[] = [];

  private _initialCamPos: Vector3D = new Vector3D();
  private _initialCamTarget: Vector3D = new Vector3D();
  private _initialCamTheta: number = 0;
  private _initialCamPhi: number = 0;
  private _hasExplicitInitialCamera: boolean = false;

  /**
   * The default camera controller attached if none is manually registered in setupScene().
   * 'fly' (default): 6-DOF spectator FlyCam (WASD + QE/Space/C + mouse look + Shift boost + Alt slow).
   * 'orbit': Turntable OrbitController around target.
   * 'none': No camera controller automatically attached.
   */
  protected defaultCameraController: "fly" | "orbit" | "none" = "fly";

  /** Base flight speed when using the default FlyController. Defaults to 7.0 units/sec. */
  protected defaultMoveSpeed: number = 7.0;

  /** Whether collisions with scene geometry are enabled for the default FlyController. Defaults to false (noclip). */
  protected defaultFlyCollision: boolean = false;

  /**
   * The constructor is passed to Application.
   * Also registers the global keyboard listener for showcases.
   */
  constructor(config: EngineOptions = {}) {
    const rendererTypeOverride = getRendererTypeFromQuery();
    super(rendererTypeOverride ? { ...config, rendererType: rendererTypeOverride } : config);
    window.addEventListener("keydown", this._showcaseKeyDownHandler);
    this._initShowcaseNavigation();
  }

  /**
   * Sets the initial/reference camera position and target for this showcase.
   * Immediately synchronizes position, target, spherical theta/phi angles and view matrix.
   * Calling this ensures pressing 'R' returns exactly to this perspective.
   */
  public setInitialCamera(position: Vector3D, target: Vector3D): void {
    this._hasExplicitInitialCamera = true;
    this._initialCamPos.copyFrom(position);
    this._initialCamTarget.copyFrom(target);
    this.camera.position.copyFrom(position);
    this.camera.target.copyFrom(target);
    const dir = target.clone().sub(position).normalize();
    this.camera.phi = Math.asin(dir.y);
    this.camera.theta = Math.atan2(dir.x, -dir.z);
    this._initialCamTheta = this.camera.theta;
    this._initialCamPhi = this.camera.phi;
    this.camera.updateViewMatrix();
  }

  /**
   * Resets the camera to its initial/reference position and orientation.
   * Can be invoked manually or triggered via the 'R' key.
   */
  public resetCamera(): void {
    this.camera.position.copyFrom(this._initialCamPos);
    this.camera.target.copyFrom(this._initialCamTarget);
    this.camera.theta = this._initialCamTheta;
    this.camera.phi = this._initialCamPhi;

    const relX = this.camera.position.x - this.camera.target.x;
    const relY = this.camera.position.y - this.camera.target.y;
    const relZ = this.camera.position.z - this.camera.target.z;
    const radius = Math.sqrt(relX * relX + relY * relY + relZ * relZ);

    if (this.camera.strategy && "radius" in this.camera.strategy) {
      (this.camera.strategy as { radius: number }).radius = radius;
    }

    this.camera.updateViewMatrix();
  }

  public override async start(): Promise<void> {
    await super.start();
    if (!this._hasExplicitInitialCamera) {
      this._initialCamPos.copyFrom(this.camera.position);
      this._initialCamTarget.copyFrom(this.camera.target);
      const dir = this.camera.target.clone().sub(this.camera.position);
      const len = dir.length();
      if (len > 0.00001) {
        dir.scale(1.0 / len);
        this.camera.phi = Math.asin(Math.max(-0.9999, Math.min(0.9999, dir.y)));
        this.camera.theta = Math.atan2(dir.x, -dir.z);
      }
      this._initialCamTheta = this.camera.theta;
      this._initialCamPhi = this.camera.phi;
    }

    if (this.camera.behaviors.length === 0) {
      if (this.defaultCameraController === "fly") {
        this.camera.setStrategy(CameraStrategyType.FPS);
        this.camera.addBehavior(
          new FlyController({
            input: this.input,
            audio: this.audio,
            moveSpeed: this.defaultMoveSpeed,
            ...(this.defaultFlyCollision ? { scene: this.scene } : {}),
          }),
        );
      } else if (this.defaultCameraController === "orbit") {
        this.camera.setStrategy(CameraStrategyType.DEFAULT);
        this.camera.addBehavior(
          new OrbitController({
            input: this.input,
            audio: this.audio,
          }),
        );
      }
    }

    // Wait for the first rendered frame before announcing readiness, so the scene has actually
    // drawn once by the time external tooling observes `SHOWCASE_READY_EVENT`. `super.start()`
    // above both awaited `setupScene()` (which covers model/texture loading) and kicked off the
    // render loop, so this is purely about synchronizing with that loop's first painted frame.
    await this._waitForStableFrame();

    const rendererType = this.renderer?.type;
    window.dispatchEvent(
      new CustomEvent<{ rendererType?: RendererType }>(SHOWCASE_READY_EVENT, {
        detail: { rendererType },
      }),
    );
  }

  /**
   * Resolves after `requestAnimationFrame` has been called once, i.e. after the render loop has
   * painted at least one frame. Falls back to a short timeout in environments where
   * `requestAnimationFrame` is unavailable (e.g. old jsdom test environments) or never fires
   * (e.g. throttled headless setups), so readiness signalling can never dead-lock.
   */
  private async _waitForStableFrame(): Promise<void> {
    await new Promise<void>((resolve) => {
      const raf = (window as unknown as Record<string, unknown>)["requestAnimationFrame"] as
        ((cb: FrameRequestCallback) => number) | undefined;
      if ("function" !== typeof raf) {
        window.setTimeout(resolve, 500);
        return;
      }
      // Each wait gets its own dead-lock backstop: clearing the timeout after the first rAF and
      // not re-arming it left the second rAF wait unprotected -- if the tab was backgrounded
      // between frame 1 and 2, `resolve` would never run and readiness signalling would hang.
      // The second rAF clears this new timeout, so it is the last clear/resolve on the happy path.
      let timeout: number;
      const armBackstop = (): void => {
        timeout = window.setTimeout(resolve, 1500);
      };
      armBackstop();
      raf((): void => {
        window.clearTimeout(timeout);
        // Wait one more frame so the first painted frame — including any one-shot
        // post-processing like TAA history init — has fully landed before signalling.
        armBackstop();
        raf((): void => {
          window.clearTimeout(timeout);
          resolve();
        });
      });
    });
  }

  /**
   * Destroys the showcase instance, freeing resources and removing showcase-specific DOM/listeners.
   */
  public override destroy(): void {
    window.removeEventListener("keydown", this._showcaseKeyDownHandler);
    for (const btn of this._navButtons) {
      btn.remove();
    }
    this._navButtons = [];
    super.destroy();
  }

  /**
   * Initializes the NEXT/PREV pointers for numeric showcases.
   */
  private _initShowcaseNavigation(): void {
    const match = window.location.pathname.match(/\/apps\/showcases\/(\d+)\/?/);
    if (!match) return;

    const currentId = parseInt(match[1]!, 10);
    if (isNaN(currentId)) return;

    const currentIndex = VALID_SHOWCASE_IDS.indexOf(currentId);
    if (currentIndex === -1) return;

    const createButton = (
      text: string,
      position: "left" | "right" | "top-left",
      action: () => void,
    ): void => {
      const btn = document.createElement("button");
      btn.innerText = text;

      const style: Partial<CSSStyleDeclaration> = {
        position: "absolute",
        background: "rgba(0, 15, 25, 0.6)",
        border: "1px solid #b000ff",
        color: "#b000ff",
        padding: "8px 18px",
        borderRadius: "2px",
        cursor: "pointer",
        fontSize: "1.1rem",
        fontWeight: "700",
        textTransform: "uppercase",
        letterSpacing: "2px",
        zIndex: "1000",
        pointerEvents: "auto",
        transition: "all 0.3s ease",
        fontFamily: "inherit",
      };

      if (position === "left") {
        style.top = "24px";
        style.left = "20px";
      } else if (position === "right") {
        style.top = "24px";
        style.right = "20px";
      } else if (position === "top-left") {
        style.top = "20px";
        style.left = "20px";
      }

      Object.assign(btn.style, style);

      btn.onmouseenter = (): void => {
        btn.style.background = "#b000ff";
        btn.style.color = "#000";
        btn.style.boxShadow = "0 0 20px rgba(176, 0, 255, 0.8), 0 0 40px rgba(176, 0, 255, 0.4)";
      };
      btn.onmouseleave = (): void => {
        btn.style.background = "rgba(0, 15, 25, 0.6)";
        btn.style.color = "#b000ff";
        btn.style.boxShadow = "none";
      };

      btn.onclick = action;

      document.body.appendChild(btn);
      this._navButtons.push(btn);
    };

    createButton("◀", "left", () => {
      const prevIndex = (currentIndex - 1 + VALID_SHOWCASE_IDS.length) % VALID_SHOWCASE_IDS.length;
      const nextId = VALID_SHOWCASE_IDS[prevIndex];
      const newPath = window.location.pathname.replace(
        /\/apps\/showcases\/\d+\/?(.*)/,
        `/apps/showcases/${nextId}/$1`,
      );
      window.location.href = newPath;
    });

    createButton("▶", "right", () => {
      const nextIndex = (currentIndex + 1) % VALID_SHOWCASE_IDS.length;
      const nextId = VALID_SHOWCASE_IDS[nextIndex];
      const newPath = window.location.pathname.replace(
        /\/apps\/showcases\/\d+\/?(.*)/,
        `/apps/showcases/${nextId}/$1`,
      );
      window.location.href = newPath;
    });
  }

  /**
   * Helper to wait for all currently loading assets to finish.
   * Useful to call at the end of setupScene.
   */
  protected async waitForAssets(): Promise<void> {
    if (!this.context.assetManager.isLoaded) {
      await this.context.assetManager.onLoaded();
    }
  }

  /**
   * Central keyboard control for all showcasess.
   * Inheriting classes can override this method and call super.onKeyDown(event).
   */
  protected onKeyDown(event: KeyboardEvent): void {
    const rendererTarget = AbstractShowcase._RENDERER_SWITCH_KEYS[event.code];
    if (rendererTarget && this._isRendererSwitchShortcut(event)) {
      event.preventDefault();
      // Skip the round-trip if the requested backend already came up (e.g. default BEST resolved
      // to WebGPU): the visual state is identical, a reload would only waste GPU init work.
      if (this.renderer?.type === rendererTarget) return;
      this._switchRenderer(rendererTarget);
      return;
    }
    if (Keys.B === event.code) {
      this.debug = !this.debug;
    }
    if (event.key === "r" || event.key === "R") {
      this.resetCamera();
    }
  }

  /**
   * True when Option/Alt is held and no other modifier is pressed, keeping the combo unambiguous
   * and clear of browser shortcuts (tab switching, screenshots) and showcase digit keys.
   */
  private _isRendererSwitchShortcut(event: KeyboardEvent): boolean {
    return event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey;
  }

  /**
   * Writes a `?rendererType=` override into the page URL (preserving any other query params) and
   * triggers a full reload. The engine re-reads the param at boot via
   * {@link getRendererTypeFromQuery}, so switching needs no runtime renderer recreation.
   */
  private _switchRenderer(rendererType: RendererType): void {
    console.info(`[Showcase] Switching renderer to ${rendererType}...`);
    const url = new URL(window.location.href);
    url.searchParams.set("rendererType", rendererType);
    window.location.href = url.toString();
  }

  /**
   * A hook method that is called when the canvas element is recreated.
   * By default, it binds the click event to request PointerLock. Inheriting classes can override this if needed.
   */
  protected onCanvasRecreated(): void {
    this.canvas.addEventListener("click", (event: MouseEvent): void => {
      // Wenn SHIFT gedrückt ist, ignorieren wir den PointerLock (damit der Inspector arbeiten kann)
      if (event.shiftKey) return;

      if (!this.input.isPointerLocked) {
        this.input.requestPointerLock(this.canvas);
      }
    });
  }

  /**
   * Default update method for examples. Subclasses can override this to implement custom logic.
   * @param _deltaTime Time elapsed since the last frame.
   */
  protected update(_deltaTime: number): void {
    // Default implementation does nothing
  }
}
