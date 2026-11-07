import type { SmallWorldMachine } from "@small-world-machine/engine";
import {
  GoldenSession,
  lookupOwn,
  parseGoldenSpec as parseSharedGoldenSpec,
  type GoldenSpec as SharedGoldenSpec,
} from "../shared/GoldenCapture.js";
import { Vector3D } from "@small-world-machine/engine";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Golden-capture mode for Showcase 45 (Fire VFX Lab):
// A deterministic query-parameter baseline so external capture tooling (scripts/goldens/**)
// can snapshot the fire VFX (procedural flames, billboard glow, flickering point lights with
// ADR-0052 point shadows, ember particles, smoke plumes, glowing ember bed, and baked soot decals)
// from an identical frame on every run. Query contract + run skeleton: apps/showcases/shared/GoldenCapture.ts
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

export type GoldenSpec = SharedGoldenSpec<"main">;

/** Parses the golden-mode query parameters; `undefined` outside golden mode. */
export function parseGoldenSpec(): GoldenSpec | undefined {
  return parseSharedGoldenSpec<"main">(() => "main");
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
  private readonly _session: GoldenSession;

  /**
   * @param host The booted showcase engine.
   * @param _options Showcase-private deterministic setup and camera framing.
   */
  constructor(
    host: SmallWorldMachine,
    private readonly _options: GoldenCaptureOptions,
  ) {
    this._session = new GoldenSession(host, {
      width: GOLDEN_WIDTH,
      height: GOLDEN_HEIGHT,
      zeroFrameClock: true,
      extraHiddenSelectors: ["showcase-layout", ".showcase-drawer"],
    });
  }

  /** See {@link GoldenSession.run}; unknown pool keys end in `meta.error`, `__goldenReady` stays unset. */
  public async run(spec: GoldenSpec): Promise<void> {
    const presetIndex = lookupOwn(PRESET_BY_POOL, spec.poolKeyRaw);
    await this._session.run(spec, undefined !== presetIndex, {
      prepare: (): void => this._options.freezeForCapture(),
      beforeSoak: (): void => this._options.applyPreset(presetIndex as number),
    });
  }

  public dispose(): void {
    this._session.dispose();
  }
}
