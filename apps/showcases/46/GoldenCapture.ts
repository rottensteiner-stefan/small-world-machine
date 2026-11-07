import type { SmallWorldMachine } from "@small-world-machine/engine";
import {
  GoldenSession,
  parseGoldenSpec as parseSharedGoldenSpec,
  type GoldenSpec as SharedGoldenSpec,
} from "../shared/GoldenCapture.js";
import {
  resolveVariant,
  type CameraPoolId,
  type ParticleVariant,
  type ParticleVariantId,
} from "./Variants.js";

/**
 * Golden-capture mode for Showcase 46 (Particle Variant Lab), mirroring showcase 45 (`fire45`).
 *
 * Deterministic query-parameter baseline so `scripts/goldens/**` can snapshot each effect variant
 * from an identical frame on every run. Query contract + run skeleton: apps/showcases/shared/GoldenCapture.ts
 *   ?rendererType=<BACKEND>&__golden=<poolKey>&__goldenView=<view>&__goldenFrames=<N>
 *
 * Every curated pool is exposed as one pool key (`part46-<variant>-<pool>`):
 *   1. part46-overview-overview: Wide lab view, every CPU lane.
 *   2. part46-forge-closeup:     Forge sparks, SDF collision, pooled lights.
 *   3. part46-smoke-closeup:     Soft smoke + procedural 6-way volume light.
 *   4. part46-trails-closeup:    Ribbon trail behind the tracked tracer.
 *   5. part46-weather-closeup:   Roof-aware rain + splashes.
 *
 * Determinism is enforced by:
 *   1. Freezing the realtime loop and resetting engine + showcase clocks to origin.
 *   2. Applying the pool's effect variant + camera pool deterministically.
 *   3. Advancing exactly N frames at fixed delta 1/60s via step(), then freezing with step(0).
 */

const GOLDEN_WIDTH = 1280;
const GOLDEN_HEIGHT = 720;

export interface GoldenPool {
  readonly key: string;
  readonly variant: ParticleVariantId;
  readonly pool: CameraPoolId;
}

/** Curated golden pools: one camera per variant (the capture-audit subset, not every combo). */
export const GOLDEN_POOLS: readonly GoldenPool[] = [
  { key: "part46-overview-overview", variant: "overview", pool: "overview" },
  { key: "part46-forge-closeup", variant: "forge", pool: "closeup" },
  { key: "part46-smoke-closeup", variant: "smoke", pool: "closeup" },
  { key: "part46-trails-closeup", variant: "trails", pool: "closeup" },
  { key: "part46-weather-closeup", variant: "weather", pool: "closeup" },
];

/** `Map`, not an object: `__golden=constructor` must not resolve prototype members. */
const POOL_BY_KEY: ReadonlyMap<string, GoldenPool> = new Map(GOLDEN_POOLS.map((p) => [p.key, p]));

export type GoldenSpec = SharedGoldenSpec<"main">;

/** Parses the golden-mode query parameters; `undefined` outside golden mode. */
export function parseGoldenSpec(): GoldenSpec | undefined {
  return parseSharedGoldenSpec<"main">(() => "main");
}

/** What the showcase must expose to run one deterministic capture. */
export interface GoldenCaptureOptions {
  /** Freezes flicker, resets simulation and particle clocks to origin. */
  freezeForCapture(): void;
  /** Applies one variant + its camera pool. */
  applyVariant(variant: ParticleVariant): void;
  /** Applies one camera pool (used after the variant is set). */
  applyCameraPool(pool: CameraPoolId): void;
}

/**
 * Runs one golden capture on a fully booted showcase and owns everything it registers globally
 * (resize listener, repaint loop), so {@link dispose} can undo it.
 */
export class GoldenCapture {
  private readonly _session: GoldenSession;

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
    const pool = POOL_BY_KEY.get(spec.poolKeyRaw);
    await this._session.run(spec, undefined !== pool, {
      prepare: (): void => this._options.freezeForCapture(),
      beforeSoak: (): void => {
        if (undefined === pool) return;
        this._options.applyVariant(resolveVariant(pool.variant));
        this._options.applyCameraPool(pool.pool);
      },
    });
  }

  public dispose(): void {
    this._session.dispose();
  }
}
