import type { SmallWorldMachine } from "@small-world-machine/engine";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Shared golden-capture base for showcases 10/38/39/43/45/46: a deterministic query-parameter
// baseline so external capture tooling (.agents/scripts/goldens/**) can snapshot one cell from an
// identical frame on every run. Single source of the query contract (a change here changes all
// six showcases and the capture scripts):
//   ?rendererType=WEB_GL2&__golden=<poolKey>&__goldenView=<view>&__goldenFrames=<N>
// Ready signal: `window.__goldenReady = true` + `window.__goldenMeta`; on failure `meta.error` is
// set and `__goldenReady` stays unset, so the tool can never take a broken capture for a baseline.
// Per-showcase code supplies only: pool-key mapping, view set, surface size, extra UI to hide, the
// clock/state reset and the camera/variant framing (see {@link GoldenRunHooks}).
// ─────────────────────────────────────────────────────────────────────────────────────────────

export const GOLDEN_FRAMES_DEFAULT = 60;
export const GOLDEN_FRAME_TIME = 1 / 60;
export const GOLDEN_SOAK_MS = 700;

export interface GoldenSpec<V extends string = string> {
  poolKeyRaw: string;
  view: V;
  frames: number;
}

/** Readiness signal for the external capture tool; see the golden mode query contract above. */
export interface GoldenMeta<V extends string = string> {
  poolKey: string;
  view: V;
  frames: number;
  rendererType?: string;
  error?: string;
}

export interface GoldenWindowFlags {
  __goldenReady?: boolean;
  __goldenMeta?: GoldenMeta;
}

/**
 * Parses golden-mode query parameters from a `location.search` string. Returns `undefined` when no
 * (or an empty) `__golden` parameter is present, i.e. the showcase runs in its regular mode.
 * @param resolveView Maps the raw `__goldenView` value (or `null`) to the showcase's view type.
 */
export function parseGoldenSpecFrom<V extends string>(
  search: string,
  resolveView: (rawView: string | null) => V,
): GoldenSpec<V> | undefined {
  const params = new URLSearchParams(search);
  const poolKeyRaw = params.get("__golden");
  if (!poolKeyRaw) return undefined;
  const view = resolveView(params.get("__goldenView"));
  const rawFrames = Number.parseInt(params.get("__goldenFrames") ?? "", 10);
  const frames = Number.isInteger(rawFrames) && rawFrames > 0 ? rawFrames : GOLDEN_FRAMES_DEFAULT;
  return { poolKeyRaw, view, frames };
}

/** {@link parseGoldenSpecFrom} on `window.location.search`; `undefined` outside a browser. */
export function parseGoldenSpec<V extends string>(
  resolveView: (rawView: string | null) => V,
): GoldenSpec<V> | undefined {
  if (typeof window === "undefined" || !window.location) return undefined;
  return parseGoldenSpecFrom(window.location.search, resolveView);
}

/**
 * Own-property lookup for pool-key tables. A plain `table[key]` resolves prototype members for
 * hostile query values (`__golden=constructor` / `toString`), so every table read goes through here.
 */
export function lookupOwn<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** Per-showcase configuration of a {@link GoldenSession}. */
export interface GoldenSessionConfig {
  /** Fixed golden render surface in pixels. */
  width: number;
  height: number;
  /** Zero `renderer.frameInfo` (time origin) right after `prepare`; for showcases with time samplers. */
  zeroFrameClock: boolean;
  /** Extra overlay elements (CSS selector, first match) hidden besides buttons/`header#info`/`.app-footer`. */
  extraHiddenSelectors: readonly string[];
}

/**
 * Showcase-specific steps of one capture. Order: `stop` -> `prepare` -> (zero frame clock) ->
 * resize listener + surface + hide UI -> `beforeSoak` -> soak -> `afterSoak` -> N fixed `step()`s ->
 * `afterSteps` -> repaint loop -> ready flag.
 */
export interface GoldenRunHooks {
  /** Right after the realtime loop is stopped (flicker freeze, clock reset). */
  prepare?(): void;
  /** Before the GPU soak delay (framing that must precede the soak). */
  beforeSoak?(): void;
  /** After the GPU soak delay (framing/variant/simulation reset). */
  afterSoak?(): void;
  /** After the last fixed step (e.g. re-freeze behaviors). */
  afterSteps?(): void;
}

/**
 * Runs one golden capture on a fully booted showcase and owns everything it registers globally
 * (resize listener, repaint loop), so {@link dispose} can undo it.
 */
export class GoldenSession {
  private _repaintHandle: number | undefined;
  private readonly _resizeHandler: () => void = (): void => this._applySurface();

  constructor(
    private readonly _host: SmallWorldMachine,
    private readonly _config: GoldenSessionConfig,
  ) {}

  /**
   * Freezes the realtime loop, pins a deterministic render surface, soaks async GPU texture
   * uploads, then advances `spec.frames` engine `step()` frames at a fixed delta time so identical
   * URLs always yield identical state.
   * On success sets `window.__goldenReady`; on any failure writes `error` into `__goldenMeta`
   * while leaving `__goldenReady` unset.
   * @param isKnownPool Result of the showcase's pool-key lookup; `false` yields the `Unknown __golden pool` error.
   */
  public async run(spec: GoldenSpec, isKnownPool: boolean, hooks: GoldenRunHooks): Promise<void> {
    const flags = window as unknown as GoldenWindowFlags;
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
      hooks.prepare?.();
      if (this._config.zeroFrameClock) {
        // Any engine-internal absolute-time sampler (fog drift, grain, ...) must start from the
        // identical origin: the pre-golden realtime loop advanced it by a wall-clock amount.
        const frame = this._host.renderer.frameInfo;
        frame.time = 0;
        frame.deltaTime = 0;
        frame.realTime = 0;
        frame.realDeltaTime = 0;
        frame.frameIndex = 0;
      }
      window.addEventListener("resize", this._resizeHandler);
      this._applySurface();
      this._hideUi();
      hooks.beforeSoak?.();
      await new Promise<void>((resolve) => window.setTimeout(resolve, GOLDEN_SOAK_MS));
      hooks.afterSoak?.();
      for (let i = 0; i < spec.frames; i++) {
        this._host.step(GOLDEN_FRAME_TIME);
      }
      hooks.afterSteps?.();
      // The realtime loop is stopped, so nothing else would ever present the frame the steps above
      // rendered into the drawing buffer -- with preserveDrawingBuffer false the browser clears it
      // after one composite and the screener would see an empty canvas. Replay the frozen final
      // frame forever via `step(0)`: a delta of zero leaves every time-driven system untouched, so
      // each presented frame is pixel-identical to the last deterministic step.
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
   * Pins the canvas and camera to the deterministic golden surface, independent of the actual
   * window/viewport size. Re-applied on every resize so the engine's own `_onResize` handler can
   * never break the baseline dimensions mid-capture.
   */
  private _applySurface(): void {
    const { width, height } = this._config;
    const canvas = this._host.canvas;
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    this._host.renderer.setSize(width, height);
    this._host.camera.aspect = width / height;
    this._host.camera.updateProjectionMatrix();
  }

  /** Hides the showcase overlay UI (nav buttons, title header, copyright footer + extras). */
  private _hideUi(): void {
    for (const btn of document.querySelectorAll("button")) {
      btn.style.display = "none";
    }
    for (const selector of ["header#info", ".app-footer", ...this._config.extraHiddenSelectors]) {
      const el = document.querySelector(selector);
      if (el instanceof HTMLElement) {
        el.style.display = "none";
      }
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
