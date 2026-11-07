import type { SmallWorldMachine } from "@small-world-machine/engine";
import {
  GoldenSession,
  lookupOwn,
  parseGoldenSpec as parseSharedGoldenSpec,
  type GoldenSpec as SharedGoldenSpec,
} from "../shared/GoldenCapture.js";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Golden-capture mode: a deterministic query-parameter baseline so external capture tooling
// (scripts/goldens/**) can snapshot one camera preset of the Atmospheric Sanctum from an
// identical frame on every run. Query contract + run skeleton: apps/showcases/shared/GoldenCapture.ts
//   ?rendererType=WEB_GL2&__golden=<poolKey>&__goldenView=<view>&__goldenFrames=<N>
// Sample 39's CSPG directional shadows + volumetric froxel fog across its four camera presets;
// every preset is exposed as one pool key (`fog39-*`). Determinism is enforced by:
//   1. Resetting the showcase clock (`_time`) and the engine frame clock, so the sun/shaft sway,
//      relic levitation, light pulsing, leyline stream and -- critically -- the VolumetricFog
//      noise drift (which reads `frameInfo.time`) all start from the identical origin.
//   2. Advancing only through the engine's deterministic `step()` at a fixed delta time.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const GOLDEN_WIDTH = 1280;
const GOLDEN_HEIGHT = 720;

/** Maps the configured golden pool keys to the showcase's camera-preset indices (`_cameraPresets`). */
const PRESET_BY_POOL: Readonly<Record<string, number>> = {
  "fog39-nave": 0,
  "fog39-altar": 1,
  "fog39-portal": 2,
  "fog39-carved": 3,
};

export type GoldenSpec = SharedGoldenSpec<"main">;

/** Parses the golden-mode query parameters; `undefined` outside golden mode. */
export function parseGoldenSpec(): GoldenSpec | undefined {
  return parseSharedGoldenSpec<"main">(() => "main");
}

/** Showcase-specific actions the capture needs but that touch private members of {@link Showcase}. */
export interface GoldenCaptureOptions {
  /** Resets the showcase's animation clock (`_time`) to its pristine origin. */
  resetClock(): void;
  /** Forces the deterministic camera framing of one preset (instant, no fly-through). */
  applyPreset(index: number): void;
}

/**
 * Runs one golden capture on a fully booted showcase and owns everything it registers globally
 * (resize listener, repaint loop), so {@link dispose} can undo it.
 */
export class GoldenCapture {
  private readonly _session: GoldenSession;

  /**
   * @param _host The booted showcase engine.
   * @param _options Clock reset and camera-preset application (both showcase-private).
   */
  constructor(
    private readonly _host: SmallWorldMachine,
    private readonly _options: GoldenCaptureOptions,
  ) {
    // The Sanctum inspector drawer (`showcase-hud`) would overlap the golden canvas area.
    // The engine frame clock is zeroed so fog noise drift (reads `frameInfo.time`), grain etc. start
    // from the identical origin on every run.
    this._session = new GoldenSession(_host, {
      width: GOLDEN_WIDTH,
      height: GOLDEN_HEIGHT,
      zeroFrameClock: true,
      extraHiddenSelectors: ["#showcase-hud"],
    });
  }

  /** See {@link GoldenSession.run}; unknown pool keys end in `meta.error`, `__goldenReady` stays unset. */
  public async run(spec: GoldenSpec): Promise<void> {
    const presetIndex = lookupOwn(PRESET_BY_POOL, spec.poolKeyRaw);
    await this._session.run(spec, undefined !== presetIndex, {
      prepare: (): void => this._options.resetClock(),
      afterSoak: (): void => this._applyPreset(presetIndex as number),
    });
  }

  public dispose(): void {
    this._session.dispose();
  }

  /**
   * Frames the camera deterministically for one pool key: deactivates every camera behavior (with
   * no input they would re-derive the identical pose anyway, this just makes it airtight) and
   * applies the preset framing instantaneously through the showcase.
   */
  private _applyPreset(index: number): void {
    const cam = this._host.camera;
    for (const behavior of cam.behaviors) {
      behavior.isActive = false;
    }
    this._options.applyPreset(index);
  }
}
