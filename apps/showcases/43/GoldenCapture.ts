import type { SmallWorldMachine } from "@small-world-machine/engine";
import {
  GoldenSession,
  lookupOwn,
  parseGoldenSpec as parseSharedGoldenSpec,
  type GoldenSpec as SharedGoldenSpec,
} from "../shared/GoldenCapture.js";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Golden-capture mode for the Kanon 1m studio cell: a deterministic query-parameter baseline so
// external capture tooling (scripts/goldens/**) can snapshot one material variant of the PBR ball
// from an identical frame on every run. Query contract + run skeleton: apps/showcases/shared/GoldenCapture.ts
//   ?rendererType=WEB_GL2&__golden=<poolKey>&__goldenView=<view>&__goldenFrames=<N>
// The studio is fully static (no animation, no clock-driven effects), so determinism needs no
// animation-clock reset — only a fixed render surface and fixed `step()` advance. The frame clock
// is zeroed anyway (defensive: any engine-internal absolute-time sampler must start at the same
// origin on every run). Every `st43-*` pool key selects one StandardMaterial variant of the ball.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const GOLDEN_WIDTH = 1280;
const GOLDEN_HEIGHT = 720;

/** Maps the configured golden pool keys to the showcase's material-variant indices (`_MATERIALS`). */
const POOL_INDEX: Readonly<Record<string, number>> = {
  "st43-matte": 0,
  "st43-satin": 1,
  "st43-metal": 2,
  "st43-chrome": 3,
};

export type GoldenSpec = SharedGoldenSpec<"main">;

/** Parses the golden-mode query parameters; `undefined` outside golden mode. */
export function parseGoldenSpec(): GoldenSpec | undefined {
  return parseSharedGoldenSpec<"main">(() => "main");
}

/** Showcase-specific action the capture needs but that touches private members of {@link Showcase}. */
export interface GoldenCaptureOptions {
  /** Applies one material variant (index into the showcase's `_MATERIALS`) to the PBR ball. */
  applyMaterial(index: number): void;
}

/**
 * Runs one golden capture on a fully booted showcase and owns everything it registers globally
 * (resize listener, repaint loop), so {@link dispose} can undo it.
 */
export class GoldenCapture {
  private readonly _session: GoldenSession;

  /**
   * @param host The booted showcase engine.
   * @param _options Material-variant application (showcase-private).
   */
  constructor(
    host: SmallWorldMachine,
    private readonly _options: GoldenCaptureOptions,
  ) {
    // Static scene; the frame clock is zeroed defensively (any absolute-time sampler, e.g. grain).
    this._session = new GoldenSession(host, {
      width: GOLDEN_WIDTH,
      height: GOLDEN_HEIGHT,
      zeroFrameClock: true,
      extraHiddenSelectors: [],
    });
  }

  /** See {@link GoldenSession.run}; unknown pool keys end in `meta.error`, `__goldenReady` stays unset. */
  public async run(spec: GoldenSpec): Promise<void> {
    const materialIndex = lookupOwn(POOL_INDEX, spec.poolKeyRaw);
    await this._session.run(spec, undefined !== materialIndex, {
      afterSoak: (): void => this._options.applyMaterial(materialIndex as number),
    });
  }

  public dispose(): void {
    this._session.dispose();
  }
}
