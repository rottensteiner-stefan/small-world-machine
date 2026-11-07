export const STANDARD_GRAVITY = 9.80665;

const MM_PER_M = 1000;

/** One population of falling drops. SI units. */
export interface DropLayer {
  /** Metres. */
  readonly diameterMin: number;
  /** Metres. */
  readonly diameterMax: number;
  /** m/s at the surface. */
  readonly impactVelocity: number;
}

export interface DropProperties {
  /** Dense small drops. */
  readonly rain: Readonly<DropLayer>;
  /** Sparse big drops falling from above (eaves, branches). */
  readonly drips: Readonly<DropLayer>;
}

export enum DropPreset {
  DRIZZLE = "drizzle",
  RAIN = "rain",
  HEAVY_RAIN = "heavyRain",
  /** Under a canopy: rain mostly intercepted, big drips dominate. */
  BRANCH_DRIPS = "branchDrips",
  DEFAULT = RAIN,
}

/** Terminal fall speed of a raindrop in still air, m/s. Atlas, Srivastava & Sekhon (1973), Rev. Geophys. 11(1). */
export function terminalVelocity(diameter: number): number {
  return Math.max(0, 9.65 - 10.3 * Math.exp(-0.6 * diameter * MM_PER_M));
}

/** Drips rarely fall far enough to reach terminal speed; drag-free fall is capped by it. */
export function dripImpactVelocity(diameter: number, fallHeight: number): number {
  return Math.min(Math.sqrt(2 * STANDARD_GRAVITY * fallHeight), terminalVelocity(diameter));
}

function rainLayer(diameterMin: number, diameterMax: number): Readonly<DropLayer> {
  return Object.freeze({
    diameterMin,
    diameterMax,
    impactVelocity: terminalVelocity((diameterMin + diameterMax) / 2),
  });
}

function dripLayer(
  diameterMin: number,
  diameterMax: number,
  fallHeight: number,
): Readonly<DropLayer> {
  return Object.freeze({
    diameterMin,
    diameterMax,
    impactVelocity: dripImpactVelocity((diameterMin + diameterMax) / 2, fallHeight),
  });
}

export const DROP_PRESETS: Readonly<Record<DropPreset, Readonly<DropProperties>>> = Object.freeze({
  [DropPreset.DRIZZLE]: Object.freeze({
    rain: rainLayer(0.0002, 0.0005),
    drips: dripLayer(0.003, 0.0045, 1),
  }),
  [DropPreset.RAIN]: Object.freeze({
    rain: rainLayer(0.0005, 0.0025),
    drips: dripLayer(0.004, 0.0055, 1.5),
  }),
  [DropPreset.HEAVY_RAIN]: Object.freeze({
    rain: rainLayer(0.001, 0.004),
    drips: dripLayer(0.0045, 0.006, 3),
  }),
  [DropPreset.BRANCH_DRIPS]: Object.freeze({
    rain: rainLayer(0.0003, 0.001),
    drips: dripLayer(0.0045, 0.006, 5),
  }),
});
