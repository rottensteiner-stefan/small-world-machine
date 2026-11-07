export type Rgb = readonly [number, number, number];

/** Material data of a liquid. Every regime and look difference between liquids comes from these numbers. */
export interface FluidProperties {
  /** kg/m^3 */
  readonly density: number;
  /** N/m */
  readonly surfaceTension: number;
  /** Pa·s */
  readonly dynamicViscosity: number;
  readonly ior: number;
  /** Beer-Lambert absorption per colour channel, 1/mm, linear RGB. */
  readonly absorptionPerMm: Rgb;
  /**
   * Diffuse body reflectance, linear RGB 0-1: the colour a thick layer of the liquid returns under
   * unit light. Not the raw single-scattering albedo; for strongly absorbing turbid liquids derive it
   * with diffusion theory (see BLOOD).
   */
  readonly scatterAlbedo: Rgb;
  /** 1/mm */
  readonly scatteringPerMm: number;
  /** 0-1: how dirty/soapy the surface is. Extends bubble life and damps capillary waves (Marangoni film). */
  readonly surfactant: number;
}

export enum FluidPreset {
  WATER = "water",
  SEAWATER = "seawater",
  BLOOD = "blood",
  OLIVE_OIL = "oliveOil",
  USED_MOTOR_OIL = "usedMotorOil",
  SULFURIC_ACID_98 = "sulfuricAcid98",
  /** ~35 % H2SO4. */
  BATTERY_ACID = "batteryAcid",
  DEFAULT = WATER,
}

function freezeFluid(fluid: FluidProperties): Readonly<FluidProperties> {
  Object.freeze(fluid.absorptionPerMm);
  Object.freeze(fluid.scatterAlbedo);
  return Object.freeze(fluid);
}

/** Pure water at 610/550/465 nm (Pope & Fry 1997): optically neutral at drop and puddle scale. */
const CLEAR_ABSORPTION: Rgb = Object.freeze([0.00026, 0.000057, 0.00001] as const);
const NO_SCATTER: Rgb = Object.freeze([0, 0, 0] as const);

// Values at 20 °C (blood at 37 °C), recommended set from .agents/scratches/drops/fluid-properties.md
// (local research note): blood optics follow Prahl's haemoglobin table and Bosschaart et al. 2014; used
// motor oil optics and both oils' interface data are estimates, flagged as such in that note.
export const FLUID_PRESETS: Readonly<Record<FluidPreset, Readonly<FluidProperties>>> =
  Object.freeze({
    [FluidPreset.WATER]: freezeFluid({
      density: 998.2,
      surfaceTension: 0.0727,
      dynamicViscosity: 1.002e-3,
      ior: 1.333,
      absorptionPerMm: CLEAR_ABSORPTION,
      scatterAlbedo: NO_SCATTER,
      scatteringPerMm: 0,
      surfactant: 0,
    }),
    [FluidPreset.SEAWATER]: freezeFluid({
      density: 1024.8,
      surfaceTension: 0.0738,
      dynamicViscosity: 1.08e-3,
      ior: 1.339,
      absorptionPerMm: CLEAR_ABSORPTION,
      scatterAlbedo: NO_SCATTER,
      scatteringPerMm: 0,
      surfactant: 0.1,
    }),
    // Whole blood, Hct 45 %, arterial. Body colour is the diffusion-theory diffuse reflectance
    // R_d = a'/2 (1 + exp(-4/3 A sqrt(3(1-a')))) exp(-sqrt(3(1-a'))) with a' = mu_s'/(mu_s' + mu_a),
    // mu_s' = 1.6/2.6/3.0 per mm and A = 3.1 (n = 1.38): 0.12 / 0.010 / 0.013 at 610/550/465 nm. The
    // red channel spans 580-700 nm, where blood reflects clearly more than at 610 nm, so it is set to
    // 0.2 (estimate). Plugging the raw albedo (0.65/0.10/0.13) in directly renders salmon pink.
    [FluidPreset.BLOOD]: freezeFluid({
      density: 1060,
      surfaceTension: 0.056,
      dynamicViscosity: 4.0e-3,
      ior: 1.38,
      absorptionPerMm: [0.81, 23.0, 20.6],
      scatterAlbedo: [0.2, 0.012, 0.015],
      scatteringPerMm: 80,
      surfactant: 0,
    }),
    [FluidPreset.OLIVE_OIL]: freezeFluid({
      density: 911,
      surfaceTension: 0.032,
      dynamicViscosity: 0.081,
      ior: 1.469,
      absorptionPerMm: [0.04, 0.02, 0.45],
      scatterAlbedo: NO_SCATTER,
      scatteringPerMm: 0,
      surfactant: 0,
    }),
    // Optics are an estimate (no visible-range measurements found): dark, nearly opaque, brown-black (diffuse reflectance a few percent).
    [FluidPreset.USED_MOTOR_OIL]: freezeFluid({
      density: 885,
      surfaceTension: 0.031,
      dynamicViscosity: 0.2,
      ior: 1.48,
      absorptionPerMm: [4, 6, 9],
      scatterAlbedo: [0.03, 0.025, 0.015],
      scatteringPerMm: 0.5,
      surfactant: 0,
    }),
    [FluidPreset.SULFURIC_ACID_98]: freezeFluid({
      density: 1836,
      surfaceTension: 0.055,
      dynamicViscosity: 0.025,
      ior: 1.427,
      absorptionPerMm: CLEAR_ABSORPTION,
      scatterAlbedo: NO_SCATTER,
      scatteringPerMm: 0,
      surfactant: 0,
    }),
    [FluidPreset.BATTERY_ACID]: freezeFluid({
      density: 1260,
      surfaceTension: 0.0755,
      dynamicViscosity: 2.4e-3,
      ior: 1.374,
      absorptionPerMm: CLEAR_ABSORPTION,
      scatterAlbedo: NO_SCATTER,
      scatteringPerMm: 0,
      surfactant: 0,
    }),
  });
