import type { SmallWorldMachine } from "@small-world-machine/engine";
import { Vector3D } from "@small-world-machine/engine";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Golden-capture mode for Showcase 45 (Fire VFX Lab):
// A deterministic query-parameter baseline so external capture tooling (scripts/goldens/**)
// can snapshot the fire VFX (procedural flames, billboard glow, flickering point lights with
// ADR-0052 point shadows, ember particles, smoke plumes, glowing ember bed, and baked soot decals)
// from an identical frame on every run. Shared query contract (see apps/showcases/10/GoldenCapture.ts):
//   ?rendererType=WEB_GL2&__golden=<poolKey>&__goldenView=<view>&__goldenFrames=<N>
//
// Every preset is exposed as one pool key (`fire45-*`):
//   1. fire45-overview: Wide lab view (campfire, crate point-shadow, candle, back wall torches).
//   2. fire45-campfire: Close-up on the campfire (logs, ember bed, smoke, sparks, contact shadow).
//   3. fire45-budget:   Angled perspective down the wall row testing FireLightBudget distance culling.
//   4. fire45-palettes: Frontal view of the 4 special torches (Original, Spectral, Wisp, Cursed).
//
// Determinism is enforced by:
//   1. Freezing the light flicker (flicker = 0, fixed position without cm jitter).
//   2. Resetting the engine and showcase clocks to origin.
//   3. Advancing exactly N frames at fixed delta 1/60s via step(), then freezing with step(0).
// ─────────────────────────────────────────────────────────────────────────────────────────────

const GOLDEN_WIDTH = 1280;
const GOLDEN_HEIGHT = 720;
const GOLDEN_FRAMES_DEFAULT = 60;
const GOLDEN_FRAME_TIME = 1 / 60;
const GOLDEN_SOAK_MS = 700;

export interface GoldenPreset {
  name: string;
  cameraPosition: Vector3D;
  cameraTarget: Vector3D;
}

export const GOLDEN_PRESETS: readonly GoldenPreset[] = [
  {
    name: "fire45-overview",
    cameraPosition: new Vector3D(0, 1.6, 5.5),
    cameraTarget: new Vector3D(0, 0.9, 0),
  },
  {
    name: "fire45-campfire",
    cameraPosition: new Vector3D(0, 0.65, 2.7),
    cameraTarget: new Vector3D(0, 0.25, 1.2),
  },
  {
    name: "fire45-budget",
    cameraPosition: new Vector3D(18.5, 2.0, 3.5),
    cameraTarget: new Vector3D(-4.0, 1.8, -1.25),
  },
  {
    name: "fire45-palettes",
    cameraPosition: new Vector3D(0, 1.8, 2.8),
    cameraTarget: new Vector3D(0, 1.8, -1.25),
  },
];

/** Maps configured golden pool keys to the preset indices. */
export const PRESET_BY_POOL: Readonly<Record<string, number>> = {
  "fire45-overview": 0,
  "fire45-campfire": 1,
  "fire45-budget": 2,
  "fire45-palettes": 3,
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

/** Showcase-specific actions the capture needs but that touch private members of Showcase. */
export interface GoldenCaptureOptions {
  /** Freezes flicker, resets simulation and particle clocks to origin. */
  freezeForCapture(): void;
  /** Sets the camera position and target for the given preset. */
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
   * @param _options Showcase-private deterministic setup and camera framing.
   */
  constructor(
    private readonly _host: SmallWorldMachine,
    private readonly _options: GoldenCaptureOptions,
  ) {}

  /**
   * Freezes the realtime loop, pins a deterministic render surface, soaks async GPU texture
   * uploads, frames the camera deterministically, then advances a fixed number of engine `step()`
   * frames at a fixed delta time so identical URLs always yield identical state.
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
      this._options.freezeForCapture();
      // Reset engine frame clocks
      const frame = this._host.renderer.frameInfo;
      frame.time = 0;
      frame.deltaTime = 0;
      frame.realTime = 0;
      frame.realDeltaTime = 0;
      frame.frameIndex = 0;

      window.addEventListener("resize", this._resizeHandler);
      this._applySurface();
      this._hideUi();
      this._options.applyPreset(presetIndex);

      await new Promise<void>((resolve) => window.setTimeout(resolve, GOLDEN_SOAK_MS));

      for (let i = 0; i < spec.frames; i++) {
        this._host.step(GOLDEN_FRAME_TIME);
      }

      // Replay the frozen final frame forever via `step(0)`: delta 0 leaves time-driven systems
      // untouched so the screener can capture presentable pixels without clearing.
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
   * Pins canvas and camera to deterministic 1280x720 surface.
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
   * Removes overlay UI elements from the captured baseline.
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
    const layout = document.querySelector("showcase-layout");
    if (layout instanceof HTMLElement) {
      layout.style.display = "none";
    }
    const drawer = document.querySelector(".showcase-drawer");
    if (drawer instanceof HTMLElement) {
      drawer.style.display = "none";
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
