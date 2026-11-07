import type { SmallWorldMachine } from "@small-world-machine/engine";
import {
  GoldenSession,
  lookupOwn,
  parseGoldenSpec as parseSharedGoldenSpec,
  type GoldenSpec as SharedGoldenSpec,
} from "../shared/GoldenCapture.js";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Golden-capture mode: a deterministic query-parameter baseline so external capture tooling
// (scripts/goldens/**) can snapshot one camera preset of the Al-Khazneh scene from an identical
// frame on every run. Query contract + run skeleton: apps/showcases/shared/GoldenCapture.ts
//   ?rendererType=WEB_GL2&__golden=<poolKey>&__goldenView=<view>&__goldenFrames=<N>
// Sample 38's directional "hard" shadows (CSM, E10 per-cascade bias) across its five camera
// presets; every preset is exposed as one pool key (`pbr38-*`). Determinism is enforced two ways:
//   1. Flame flicker is frozen (`_flickerEnabled = false`, applied per frame as
//      `lightBehavior.flicker = 0`) -- the flicker drivers are the `Math.random()` consumers this
//      scene controls; other random users are not audited.
//   2. The scene clock is reset and advanced only through the engine's deterministic `step()`.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const GOLDEN_WIDTH = 1280;
const GOLDEN_HEIGHT = 720;

/** Maps the configured golden pool keys to the showcase's camera-preset indices (`_cameraPresets`). */
const PRESET_BY_POOL: Readonly<Record<string, number>> = {
  "pbr38-siq": 0,
  "pbr38-plaza": 1,
  "pbr38-portico": 2,
  "pbr38-sanctum": 3,
  "pbr38-shrine": 4,
};

export type GoldenSpec = SharedGoldenSpec<"main">;

/** Parses the golden-mode query parameters; `undefined` outside golden mode. */
export function parseGoldenSpec(): GoldenSpec | undefined {
  return parseSharedGoldenSpec<"main">(() => "main");
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
  private readonly _session: GoldenSession;

  /**
   * @param _host The booted showcase engine.
   * @param _options Flicker freeze and camera-preset application (both showcase-private).
   */
  constructor(
    private readonly _host: SmallWorldMachine,
    private readonly _options: GoldenCaptureOptions,
  ) {
    // The Petra inspector drawer's preset buttons would otherwise overlap the golden canvas area.
    this._session = new GoldenSession(_host, {
      width: GOLDEN_WIDTH,
      height: GOLDEN_HEIGHT,
      zeroFrameClock: false,
      extraHiddenSelectors: ["#petra-hud"],
    });
  }

  /** See {@link GoldenSession.run}; unknown pool keys end in `meta.error`, `__goldenReady` stays unset. */
  public async run(spec: GoldenSpec): Promise<void> {
    const presetIndex = lookupOwn(PRESET_BY_POOL, spec.poolKeyRaw);
    await this._session.run(spec, undefined !== presetIndex, {
      prepare: (): void => this._options.disableFlicker(),
      afterSoak: (): void => this._applyPreset(presetIndex as number),
    });
  }

  public dispose(): void {
    this._session.dispose();
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
}
