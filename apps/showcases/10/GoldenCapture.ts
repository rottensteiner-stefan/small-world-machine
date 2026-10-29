import type {
  Object3D,
  RampStop,
  SmallWorldMachine,
  StylizedWaterMaterial,
} from "@small-world-machine/engine";
import { Color, MathUtils, PerspectiveProjection, RampLUT } from "@small-world-machine/engine";
import type { PoolKey, PoolPosition } from "./PoolLayout.js";
import { LIQUID_Y, POOL_CELLS, poolWorldPosition } from "./PoolLayout.js";
import type { RandomSource } from "./PoolTextures.js";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Golden-capture mode: a deterministic query-parameter baseline so external capture tooling
// (scripts/goldens/**) can snapshot exactly one pool from exactly one camera view and get an
// identical frame on every run. Shared query contract (do not change):
//   ?rendererType=WEB_GL2&__golden=<poolKey>&__goldenView=<view>&__goldenFrames=<N>
// Aquatic determinism is enforced by resetting the scene clock and then advancing it through the
// engine's deterministic `step()` primitive at a fixed delta time.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const GOLDEN_WIDTH = 1024;
const GOLDEN_HEIGHT = 576;
const GOLDEN_FRAMES_DEFAULT = 60;
const GOLDEN_FRAME_TIME = 1 / 60;
const GOLDEN_SOAK_MS = 700;
const GOLDEN_TOP_HEIGHT = 7.2;
const GOLDEN_TOP_TILT = 0.001; // keep the view a hair off vertical so lookAt never hits its pole
const GOLDEN_TOP_FOV_DEG = 42;
const GOLDEN_OBLIQUE_HEIGHT = 2.0;
const GOLDEN_OBLIQUE_OFFSET = 5.5;
const GOLDEN_OBLIQUE_TARGET_RAISE = 0.5;
const GOLDEN_TEXTURE_SEED = 0xc0ffee;

type GoldenView = "top" | "oblique";

export interface GoldenSpec {
  poolKeyRaw: string;
  view: GoldenView;
  frames: number;
}

/** Readiness signal for the external capture tool; see the golden mode query contract above. */
interface GoldenMeta {
  poolKey: string;
  view: GoldenView;
  frames: number;
  rendererType?: string;
  error?: string;
}

/** Colour stop as passed over the verification hook: RGB 0..255. */
interface RampVerifyStop {
  t: number;
  color: [number, number, number];
}

/**
 * Debug hook for scratch verification of `StylizedWaterMaterial.rampMap` (P2 item 8, `?__rampVerify=1`
 * only; never installed in normal runs).
 */
interface RampVerifyHook {
  poolKeys: string[];
  /** Assigns a freshly baked RampLUT to the pool's material, or `null` to clear `rampMap`. */
  setRamp(poolKey: string, stops: RampVerifyStop[] | null): void;
  /** Re-bakes the pool's existing RampLUT in place (exercises the `needsUpdate` re-upload path). */
  updateStops(poolKey: string, stops: RampVerifyStop[]): void;
}

interface GoldenWindowFlags {
  __goldenReady?: boolean;
  __goldenMeta?: GoldenMeta;
  __rampVerify?: RampVerifyHook;
}

/**
 * Parses the golden-mode query parameters. Returns `undefined` when no `__golden` parameter is
 * present, i.e. the showcase runs in its regular interactive mode unchanged.
 */
export function parseGoldenSpec(): GoldenSpec | undefined {
  if (typeof window === "undefined" || !window.location) return undefined;
  const params = new URLSearchParams(window.location.search);
  const poolKeyRaw = params.get("__golden");
  if (!poolKeyRaw) return undefined;
  const rawView = params.get("__goldenView");
  const view: GoldenView = rawView === "oblique" ? "oblique" : "top";
  const rawFrames = Number.parseInt(params.get("__goldenFrames") ?? "", 10);
  const frames = Number.isInteger(rawFrames) && rawFrames > 0 ? rawFrames : GOLDEN_FRAMES_DEFAULT;
  return { poolKeyRaw, view, frames };
}

/**
 * Seeded LCG for the procedural tile textures, so they are identical on every golden run. It is
 * handed to the texture factories instead of replacing the global `Math.random`, which would leak
 * into other engine instances on the same page.
 */
export function createGoldenRandom(): RandomSource {
  let state = GOLDEN_TEXTURE_SEED >>> 0;
  return (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Installs `window.__rampVerify` when the URL carries `?__rampVerify=1` (see {@link RampVerifyHook}). */
export function installRampVerifyHook(targets: Record<string, StylizedWaterMaterial>): void {
  if ("1" !== new URLSearchParams(window.location.search).get("__rampVerify")) return;

  const luts = new Map<string, RampLUT>();
  const toStops = (stops: RampVerifyStop[]): RampStop[] =>
    stops.map((s: RampVerifyStop) => ({
      t: s.t,
      color: new Color(s.color[0] / 255, s.color[1] / 255, s.color[2] / 255),
    }));
  const material = (poolKey: string): StylizedWaterMaterial => {
    const m = targets[poolKey];
    if (undefined === m) throw new Error(`[__rampVerify] Unknown pool '${poolKey}'`);
    return m;
  };

  (window as unknown as GoldenWindowFlags).__rampVerify = {
    poolKeys: Object.keys(targets),
    setRamp: (poolKey: string, stops: RampVerifyStop[] | null): void => {
      const m = material(poolKey);
      if (null === stops) {
        m.rampMap = undefined;
        luts.delete(poolKey);
        return;
      }
      const lut = new RampLUT(toStops(stops));
      luts.set(poolKey, lut);
      m.rampMap = lut.texture;
    },
    updateStops: (poolKey: string, stops: RampVerifyStop[]): void => {
      const lut = luts.get(poolKey);
      if (undefined === lut) throw new Error(`[__rampVerify] No ramp set for '${poolKey}'`);
      lut.setStops(toStops(stops));
    },
  };
}

/**
 * Runs one golden capture on a fully booted showcase and owns everything it registers globally
 * (resize listener, repaint loop), so {@link dispose} can undo it.
 */
export class GoldenCapture {
  private _repaintHandle: number | undefined;
  private readonly _resizeHandler: () => void = (): void => this._applySurface();

  /**
   * @param _host The booted showcase engine.
   * @param _resetSimulation Puts the showcase clock and physics bodies back to their pristine state.
   */
  constructor(
    private readonly _host: SmallWorldMachine,
    private readonly _resetSimulation: () => void,
  ) {}

  /**
   * Freezes the realtime loop, pins a deterministic render surface, soaks async GPU texture
   * uploads, frames the camera deterministically, then advances a fixed number of engine `step()`
   * frames at a fixed delta time so identical URLs always yield identical state.
   * On success sets `window.__goldenReady`; on any failure writes `error` into `__goldenMeta`
   * while leaving `__goldenReady` unset, so the capture tool can never mistake a broken capture
   * for a valid baseline.
   */
  public async run(spec: GoldenSpec): Promise<void> {
    const flags = window as unknown as GoldenWindowFlags;
    const isKnownPool = Object.hasOwn(POOL_CELLS, spec.poolKeyRaw);
    const meta: GoldenMeta = {
      poolKey: spec.poolKeyRaw,
      view: spec.view,
      frames: spec.frames,
      rendererType: this._host.renderer?.type,
    };
    if (!isKnownPool) {
      meta.error = `Unknown __golden pool '${spec.poolKeyRaw}'`;
      flags.__goldenMeta = meta;
      return;
    }

    try {
      this._host.stop();
      window.addEventListener("resize", this._resizeHandler);
      this._applySurface();
      this._hideUi();
      await new Promise<void>((resolve) => window.setTimeout(resolve, GOLDEN_SOAK_MS));
      this._applyCamera(poolWorldPosition(spec.poolKeyRaw as PoolKey), spec.view);
      this._resetSimulation();
      // Pool behaviors were attached frozen (see `Showcase._attachPoolBehavior`) so the pre-golden
      // realtime frames could not advance them by an unknown amount. Wake them now: they are
      // still in their pristine constructor state, so the fixed-timestep simulation below is
      // fully reproducible.
      this._setSceneBehaviors(true);
      for (let i = 0; i < spec.frames; i++) {
        this._host.step(GOLDEN_FRAME_TIME);
      }
      this._setSceneBehaviors(false);
      // The realtime loop is stopped, so nothing else would ever present the frame the steps above
      // rendered into the drawing buffer -- with preserveDrawingBuffer false the browser clears it
      // after one composite and the screener would see an empty canvas. Replay the frozen final
      // frame forever via `step(0)`: a delta of zero leaves every time-driven system (scene clock,
      // behaviors, liquids, lights, camera) untouched, so each presented frame is pixel-identical
      // to the last deterministic step, but the buffer always carries content.
      this._startRepaint();
      flags.__goldenReady = true;
      flags.__goldenMeta = meta;
    } catch (err) {
      meta.error = err instanceof Error ? err.message : String(err);
      flags.__goldenMeta = meta;
    }
  }

  public dispose(): void {
    window.removeEventListener("resize", this._resizeHandler);
    if (undefined !== this._repaintHandle) {
      window.cancelAnimationFrame(this._repaintHandle);
      this._repaintHandle = undefined;
    }
  }

  /**
   * Pins the canvas and camera to the deterministic 1024x576 golden surface, independent of the
   * actual window/viewport size. Re-applied on every resize so the engine's own `_onResize`
   * handler can never break the baseline dimensions mid-capture.
   */
  private _applySurface(): void {
    const canvas = this._host.canvas;
    canvas.width = GOLDEN_WIDTH;
    canvas.height = GOLDEN_HEIGHT;
    canvas.style.width = `${GOLDEN_WIDTH}px`;
    canvas.style.height = `${GOLDEN_HEIGHT}px`;
    this._host.renderer.setSize(GOLDEN_WIDTH, GOLDEN_HEIGHT);
    this._host.camera.aspect = GOLDEN_WIDTH / GOLDEN_HEIGHT;
    this._host.camera.updateProjectionMatrix();
  }

  /**
   * Removes every showcase-overlay UI element from the captured baseline: the PREV/NEXT nav
   * buttons injected by AbstractShowcase, the page title header and the copyright footer.
   */
  private _hideUi(): void {
    for (const btn of document.querySelectorAll("button")) {
      btn.style.display = "none";
    }
    const header = document.querySelector("header#info");
    if (header instanceof HTMLElement) {
      header.style.display = "none";
    }
    const footer = document.querySelector(".app-footer");
    if (footer instanceof HTMLElement) {
      footer.style.display = "none";
    }
  }

  /**
   * Frames the camera deterministically for one (pool, view) pair. FPS/zoom controllers are
   * deactivated -- with no input they would keep re-deriving the pose from the same fixed angles
   * anyway, this just makes it airtight. Theta/phi are derived from the exact FPS look-direction
   * formula so the strategy re-computes the identical target every stepped frame.
   */
  private _applyCamera(layout: PoolPosition, view: GoldenView): void {
    const cam = this._host.camera;
    for (const behavior of cam.behaviors) {
      behavior.isActive = false;
    }
    if ("top" === view) {
      cam.position.set(layout.x, GOLDEN_TOP_HEIGHT, layout.z);
      cam.target.set(layout.x - GOLDEN_TOP_TILT, LIQUID_Y, layout.z);
      cam.projection = new PerspectiveProjection({
        fov: MathUtils.degToRad(GOLDEN_TOP_FOV_DEG),
        aspect: GOLDEN_WIDTH / GOLDEN_HEIGHT,
        near: 0.1,
        far: 1000,
      });
      cam.updateProjectionMatrix();
    } else {
      const towardZ: 1 | -1 = 0 < layout.z ? 1 : -1;
      cam.position.set(layout.x, GOLDEN_OBLIQUE_HEIGHT, layout.z + towardZ * GOLDEN_OBLIQUE_OFFSET);
      cam.target.set(layout.x, LIQUID_Y + GOLDEN_OBLIQUE_TARGET_RAISE, layout.z);
    }
    const dir = cam.target.clone().sub(cam.position).normalize();
    cam.phi = Math.asin(Math.max(-0.9999, Math.min(0.9999, dir.y)));
    cam.theta = Math.atan2(dir.x, -dir.z);
    cam.updateViewMatrix();
  }

  /** Flips `isActive` on every scene behavior (pool floaters/splash droppers); camera is excluded. */
  private _setSceneBehaviors(active: boolean): void {
    const walk = (obj: Object3D): void => {
      for (const behavior of obj.behaviors) {
        behavior.isActive = active;
      }
      for (const child of obj.children) {
        walk(child);
      }
    };
    walk(this._host.scene.root);
  }

  /** Keeps presenting the frozen golden frame by re-rendering it (delta 0) on every rAF. */
  private _startRepaint(): void {
    const replay = (): void => {
      this._host.step(0);
      this._repaintHandle = window.requestAnimationFrame(replay);
    };
    this._repaintHandle = window.requestAnimationFrame(replay);
  }
}
