import type {
  Object3D,
  RampStop,
  SmallWorldMachine,
  StylizedWaterMaterial,
} from "@small-world-machine/engine";
import { Color, MathUtils, PerspectiveProjection, RampLUT } from "@small-world-machine/engine";
import {
  GoldenSession,
  parseGoldenSpec as parseSharedGoldenSpec,
  type GoldenSpec as SharedGoldenSpec,
  type GoldenWindowFlags as SharedGoldenWindowFlags,
} from "../shared/GoldenCapture.js";
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
const GOLDEN_TOP_HEIGHT = 7.2;
const GOLDEN_TOP_TILT = 0.001; // keep the view a hair off vertical so lookAt never hits its pole
const GOLDEN_TOP_FOV_DEG = 42;
const GOLDEN_OBLIQUE_HEIGHT = 2.0;
const GOLDEN_OBLIQUE_OFFSET = 5.5;
const GOLDEN_OBLIQUE_TARGET_RAISE = 0.5;
const GOLDEN_TEXTURE_SEED = 0xc0ffee;

type GoldenView = "top" | "oblique";

export type GoldenSpec = SharedGoldenSpec<GoldenView>;

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

interface GoldenWindowFlags extends SharedGoldenWindowFlags {
  __rampVerify?: RampVerifyHook;
}

/**
 * Parses the golden-mode query parameters. Returns `undefined` when no `__golden` parameter is
 * present, i.e. the showcase runs in its regular interactive mode unchanged.
 */
export function parseGoldenSpec(): GoldenSpec | undefined {
  return parseSharedGoldenSpec<GoldenView>((raw) => ("oblique" === raw ? "oblique" : "top"));
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
  private readonly _session: GoldenSession;

  /**
   * @param _host The booted showcase engine.
   * @param _resetSimulation Puts the showcase clock and physics bodies back to their pristine state.
   */
  constructor(
    private readonly _host: SmallWorldMachine,
    private readonly _resetSimulation: () => void,
  ) {
    this._session = new GoldenSession(_host, {
      width: GOLDEN_WIDTH,
      height: GOLDEN_HEIGHT,
      zeroFrameClock: false,
      extraHiddenSelectors: [],
    });
  }

  /** See {@link GoldenSession.run}; unknown pool keys end in `meta.error`, `__goldenReady` stays unset. */
  public async run(spec: GoldenSpec): Promise<void> {
    await this._session.run(spec, Object.hasOwn(POOL_CELLS, spec.poolKeyRaw), {
      afterSoak: (): void => {
        this._applyCamera(poolWorldPosition(spec.poolKeyRaw as PoolKey), spec.view);
        this._resetSimulation();
        // Pool behaviors were attached frozen (see `Showcase._attachPoolBehavior`) so the pre-golden
        // realtime frames could not advance them by an unknown amount. Wake them now: they are
        // still in their pristine constructor state, so the fixed-timestep simulation is
        // fully reproducible.
        this._setSceneBehaviors(true);
      },
      afterSteps: (): void => this._setSceneBehaviors(false),
    });
  }

  public dispose(): void {
    this._session.dispose();
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
}
