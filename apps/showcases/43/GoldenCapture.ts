import type { SmallWorldMachine } from "@small-world-machine/engine";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Golden-capture mode for the Kanon 1m studio cell: a deterministic query-parameter baseline so
// external capture tooling (scripts/goldens/**) can snapshot one material variant of the PBR ball
// from an identical frame on every run. Shared query contract (do not change, see
// apps/showcases/10/GoldenCapture.ts):
//   ?rendererType=WEB_GL2&__golden=<poolKey>&__goldenView=<view>&__goldenFrames=<N>
// The studio is fully static (no animation, no clock-driven effects), so determinism needs no
// animation-clock reset — only a fixed render surface and fixed `step()` advance. The frame clock
// is zeroed anyway (defensive: any engine-internal absolute-time sampler must start at the same
// origin on every run). Every `st43-*` pool key selects one StandardMaterial variant of the ball.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const GOLDEN_WIDTH = 1280;
const GOLDEN_HEIGHT = 720;
const GOLDEN_FRAMES_DEFAULT = 60;
const GOLDEN_FRAME_TIME = 1 / 60;
const GOLDEN_SOAK_MS = 700;

/** Maps the configured golden pool keys to the showcase's material-variant indices (`_MATERIALS`). */
const POOL_INDEX: Readonly<Record<string, number>> = {
  "st43-matte": 0,
  "st43-satin": 1,
  "st43-metal": 2,
  "st43-chrome": 3,
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

/** Showcase-specific action the capture needs but that touches private members of {@link Showcase43}. */
export interface GoldenCaptureOptions {
  /** Applies one material variant (index into the showcase's `_MATERIALS`) to the PBR ball. */
  applyMaterial(index: number): void;
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
   * @param _options Material-variant application (showcase-private).
   */
  constructor(
    private readonly _host: SmallWorldMachine,
    private readonly _options: GoldenCaptureOptions,
  ) {}

  /**
   * Freezes the realtime loop, pins a deterministic render surface, zeros every time origin, soaks
   * the initial GPU upload / first-frame warm-up, applies the material variant, then advances a
   * fixed number of engine `step()` frames at a fixed delta time so identical URLs always yield
   * identical state. On success sets `window.__goldenReady`; on any failure writes `error` into
   * `__goldenMeta` while leaving `__goldenReady` unset, so the capture tool can never mistake a
   * broken capture for a valid baseline.
   */
  public async run(spec: GoldenSpec): Promise<void> {
    const flags = window as unknown as GoldenWindowFlags;
    const materialIndex = POOL_INDEX[spec.poolKeyRaw];
    const meta: GoldenMeta = {
      poolKey: spec.poolKeyRaw,
      view: spec.view,
      frames: spec.frames,
      rendererType: this._host.renderer?.type,
    };
    if (undefined === materialIndex) {
      meta.error = `Unknown __golden pool '${spec.poolKeyRaw}'`;
      flags.__goldenMeta = meta;
      return;
    }

    try {
      this._host.stop();
      // A static scene, but any engine-internal absolute-time sampler (e.g. procedural grain,
      // future PP) must start from the identical origin on every run.
      const frame = this._host.renderer.frameInfo;
      frame.time = 0;
      frame.deltaTime = 0;
      frame.realTime = 0;
      frame.realDeltaTime = 0;
      frame.frameIndex = 0;
      window.addEventListener("resize", this._resizeHandler);
      this._applySurface();
      this._hideUi();
      await new Promise<void>((resolve) => window.setTimeout(resolve, GOLDEN_SOAK_MS));
      this._options.applyMaterial(materialIndex);
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
   * Removes every showcase-overlay UI element from the captured baseline: the PREV/NEXT nav
   * buttons and page title injected by AbstractShowcase and the copyright footer.
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

  /** Keeps presenting the frozen golden frame by re-rendering it (delta 0) on every rAF. */
  private _startRepaint(): void {
    const replay = (): void => {
      this._host.step(0);
      this._repaintHandle = window.requestAnimationFrame(replay);
    };
    this._repaintHandle = window.requestAnimationFrame(replay);
  }
}
