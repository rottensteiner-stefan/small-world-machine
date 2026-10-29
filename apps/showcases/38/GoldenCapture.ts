import type { SmallWorldMachine } from "@small-world-machine/engine";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Golden-capture mode: a deterministic query-parameter baseline so external capture tooling
// (scripts/goldens/**) can snapshot one camera preset of the Al-Khazneh scene from an identical
// frame on every run. Shared query contract (do not change, see apps/showcases/10/GoldenCapture.ts):
//   ?rendererType=WEB_GL2&__golden=<poolKey>&__goldenView=<view>&__goldenFrames=<N>
// Sample 38's directional "hard" shadows (CSM, E10 per-cascade bias) across its five camera
// presets; every preset is exposed as one pool key (`pbr38-*`). Determinism is enforced two ways:
//   1. Flame flicker is frozen (`_flickerEnabled = false`) -- the only `Math.random()` consumers in
//      the scene feed the FlickerBehavior, so disabling them makes the frame fully reproducible.
//   2. The scene clock is reset and advanced only through the engine's deterministic `step()`.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const GOLDEN_WIDTH = 1280;
const GOLDEN_HEIGHT = 720;
const GOLDEN_FRAMES_DEFAULT = 60;
const GOLDEN_FRAME_TIME = 1 / 60;
const GOLDEN_SOAK_MS = 700;

/** Maps the configured golden pool keys to the showcase's camera-preset indices (`_cameraPresets`). */
const PRESET_BY_POOL: Readonly<Record<string, number>> = {
  "pbr38-siq": 0,
  "pbr38-plaza": 1,
  "pbr38-portico": 2,
  "pbr38-sanctum": 3,
  "pbr38-shrine": 4,
};

type GoldenView = "main";

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

interface GoldenWindowFlags {
  __goldenReady?: boolean;
  __goldenMeta?: GoldenMeta;
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
  const rawFrames = Number.parseInt(params.get("__goldenFrames") ?? "", 10);
  const frames = Number.isInteger(rawFrames) && rawFrames > 0 ? rawFrames : GOLDEN_FRAMES_DEFAULT;
  return { poolKeyRaw, view: "main", frames };
}

/** Showcase-specific actions the capture needs but that touch private members of {@link Showcase}. */
export interface GoldenCaptureOptions {
  /** Freezes every torch/brazier flame to its base intensity and scale (removes flicker nondeterminism). */
  disableFlicker(): void;
  /** Forces the deterministic camera framing of one preset (index into `_cameraPresets`). */
  applyPreset(index: number): void;
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
   * @param _options Flicker freeze and camera-preset application (both showcase-private).
   */
  constructor(
    private readonly _host: SmallWorldMachine,
    private readonly _options: GoldenCaptureOptions,
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
    const presetIndex = PRESET_BY_POOL[spec.poolKeyRaw];
    const meta: GoldenMeta = {
      poolKey: spec.poolKeyRaw,
      view: spec.view,
      frames: spec.frames,
      rendererType: this._host.renderer?.type,
    };
    if (undefined === presetIndex) {
      meta.error = `Unknown __golden pool '${spec.poolKeyRaw}'`;
      flags.__goldenMeta = meta;
      return;
    }

    try {
      this._host.stop();
      this._options.disableFlicker();
      window.addEventListener("resize", this._resizeHandler);
      this._applySurface();
      this._hideUi();
      await new Promise<void>((resolve) => window.setTimeout(resolve, GOLDEN_SOAK_MS));
      this._applyPreset(presetIndex);
      for (let i = 0; i < spec.frames; i++) {
        this._host.step(GOLDEN_FRAME_TIME);
      }
      // The realtime loop is stopped, so nothing else would ever present the frame the steps above
      // rendered into the drawing buffer -- with preserveDrawingBuffer false the browser clears it
      // after one composite and the screener would see an empty canvas. Replay the frozen final
      // frame forever via `step(0)`: a delta of zero leaves every time-driven system untouched, so
      // each presented frame is pixel-identical to the last deterministic step, but the buffer
      // always carries content.
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
   * Pins the canvas and camera to the deterministic 1280x720 golden surface, independent of the
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
   * Frames the camera deterministically for one pool key: deactivates every camera behavior (with
   * no input they would re-derive the identical pose anyway, this just makes it airtight) and
   * applies the preset framing through the showcase (which also refreshes `_activePresetIdx`).
   */
  private _applyPreset(index: number): void {
    const cam = this._host.camera;
    for (const behavior of cam.behaviors) {
      behavior.isActive = false;
    }
    this._options.applyPreset(index);
  }

  /**
   * Removes every showcase-overlay UI element from the captured baseline: the PREV/NEXT nav
   * buttons and page title injected by AbstractShowcase, the copyright footer and the Petra
   * inspector drawer (its preset buttons would otherwise overlap the golden canvas area).
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
    const hud = document.getElementById("petra-hud");
    if (hud instanceof HTMLElement) {
      hud.style.display = "none";
    }
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
