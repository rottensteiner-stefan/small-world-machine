import { STANDARD_GRAVITY, type DropLayer, type DropProperties } from "./DropProperties.js";
import type { DropLayerParams, DropSurfaceParams } from "./DropSurfaceParams.js";
import type { FluidProperties } from "./FluidProperties.js";

/*
 * Impact regime from dimensionless numbers only (ADR 0042: no liquid-name branches). Thresholds follow
 * the drop-impact literature (Josserand & Thoroddsen 2016, Annu. Rev. Fluid Mech. 48): below Oh ~ 3e-3
 * a liquid behaves inviscidly (jets, daughter drops, crowns); by Oh ~ 0.1 viscosity swallows the jet.
 * Ramps run in log space because Oh and We span decades between liquids.
 */
const OH_INVISCID = 0.003;
const OH_VISCOUS = 0.1;
const WE_CROWN_ONSET = 300;
const WE_CROWN_FULL = 2000;
const WE_BUBBLE_ONSET = 100;
const WE_BUBBLE_FULL = 1000;
/** Bubble entrainment needs a cavity that is large compared with the capillary length. */
const BUBBLE_SIZE_ONSET = 0.3;
const BUBBLE_SIZE_FULL = 1.5;

const DAUGHTER_PEAK = 0.85;
const CROWN_PEAK = 1;
const BUBBLE_PEAK = 0.6;

const SLOPE_SMALL_DROP = 0.08;
const SLOPE_BIG_DROP = 0.3;
const SLOPE_SIZE_SMALL = 0.1;
const SLOPE_SIZE_BIG = 2;
/** Oh at which ripple amplitude is halved: viscous liquids barely ripple. */
const OH_SLOPE_HALF = 0.05;

/** Clean water film bubbles pop well within a second; soap films last tens of seconds. */
const CLEAN_BUBBLE_LIFETIME = 0.5;
const SURFACTANT_BUBBLE_GAIN = 20;
/** Film drainage slows with viscosity; normalised to water so the clean lifetime stays anchored. */
const REFERENCE_VISCOSITY = 1.0e-3;
const MAX_BUBBLE_LIFETIME = 30;
/** Surfactant films roughly double capillary-wave damping (Marangoni elasticity, Lucassen 1968). */
const SURFACTANT_DAMPING_GAIN = 1;

export function weberNumber(
  density: number,
  velocity: number,
  diameter: number,
  surfaceTension: number,
): number {
  return (density * velocity * velocity * diameter) / surfaceTension;
}

export function ohnesorgeNumber(
  dynamicViscosity: number,
  density: number,
  surfaceTension: number,
  diameter: number,
): number {
  return dynamicViscosity / Math.sqrt(density * surfaceTension * diameter);
}

export function reynoldsNumber(
  density: number,
  velocity: number,
  diameter: number,
  dynamicViscosity: number,
): number {
  return (density * velocity * diameter) / dynamicViscosity;
}

/** Metres; where gravity and surface tension balance. */
export function capillaryLength(surfaceTension: number, density: number): number {
  return Math.sqrt(surfaceTension / (density * STANDARD_GRAVITY));
}

/** Wavelength of minimum phase speed of gravity-capillary waves (2π·capillary length), metres. */
export function minimumCapillaryWavelength(surfaceTension: number, density: number): number {
  return 2 * Math.PI * capillaryLength(surfaceTension, density);
}

/** e-folding amplitude lifetime of a ripple with wavenumber k (rad/m) under viscous damping 2νk², seconds. */
export function rippleLifetime(wavenumber: number, kinematicViscosity: number): number {
  return 1 / (2 * kinematicViscosity * wavenumber * wavenumber);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function logSmoothstep(edge0: number, edge1: number, x: number): number {
  return smoothstep(Math.log(edge0), Math.log(edge1), Math.log(x));
}

/** 1 for inviscid impacts, 0 once viscosity suppresses jets and crowns. */
export function inviscidFactor(ohnesorge: number): number {
  return 1 - logSmoothstep(OH_INVISCID, OH_VISCOUS, ohnesorge);
}

export function createDropLayerParams(): DropLayerParams {
  return {
    diameterMin: 0,
    diameterMax: 0,
    slopeScale: 0,
    daughterProbability: 0,
    crownStrength: 0,
    bubbleProbability: 0,
  };
}

export function createDropSurfaceParams(): DropSurfaceParams {
  return {
    sigmaOverRho: 0,
    kinematicViscosity: 0,
    ior: 1,
    absorptionPerMm: [0, 0, 0],
    scatterAlbedo: [0, 0, 0],
    scatteringPerMm: 0,
    bubbleLifetime: 0,
    rain: createDropLayerParams(),
    drips: createDropLayerParams(),
  };
}

/** Regime of a drop layer hitting a pool of the same fluid, evaluated at the layer's mean diameter. */
export function deriveLayerParams(
  fluid: Readonly<FluidProperties>,
  layer: Readonly<DropLayer>,
  out: DropLayerParams = createDropLayerParams(),
): DropLayerParams {
  const diameter = (layer.diameterMin + layer.diameterMax) / 2;
  const we = weberNumber(fluid.density, layer.impactVelocity, diameter, fluid.surfaceTension);
  const oh = ohnesorgeNumber(fluid.dynamicViscosity, fluid.density, fluid.surfaceTension, diameter);
  const sizeOverCapillary = diameter / capillaryLength(fluid.surfaceTension, fluid.density);
  const inviscid = inviscidFactor(oh);

  out.diameterMin = layer.diameterMin;
  out.diameterMax = layer.diameterMax;
  // Worthington jets pinch off daughters whenever the collapse is inviscid; even slow drops do this on water.
  out.daughterProbability = DAUGHTER_PEAK * inviscid;
  out.crownStrength = CROWN_PEAK * inviscid * logSmoothstep(WE_CROWN_ONSET, WE_CROWN_FULL, we);
  out.bubbleProbability =
    BUBBLE_PEAK *
    inviscid *
    logSmoothstep(WE_BUBBLE_ONSET, WE_BUBBLE_FULL, we) *
    smoothstep(BUBBLE_SIZE_ONSET, BUBBLE_SIZE_FULL, sizeOverCapillary);
  const baseSlope =
    SLOPE_SMALL_DROP +
    (SLOPE_BIG_DROP - SLOPE_SMALL_DROP) *
      smoothstep(SLOPE_SIZE_SMALL, SLOPE_SIZE_BIG, sizeOverCapillary);
  out.slopeScale = baseSlope / (1 + oh / OH_SLOPE_HALF);
  return out;
}

export function bubbleLifetime(fluid: Readonly<FluidProperties>): number {
  const lifetime =
    CLEAN_BUBBLE_LIFETIME *
    (1 + SURFACTANT_BUBBLE_GAIN * fluid.surfactant) *
    Math.sqrt(fluid.dynamicViscosity / REFERENCE_VISCOSITY);
  return Math.min(MAX_BUBBLE_LIFETIME, lifetime);
}

/**
 * Same-on-same pairing (ADR 0042 phase a). `kinematicViscosity` carries the surfactant damping boost
 * because the contract defines it as the ripple damping coefficient.
 */
export function deriveSurfaceParams(
  fluid: Readonly<FluidProperties>,
  drops: Readonly<DropProperties>,
  out: DropSurfaceParams = createDropSurfaceParams(),
): DropSurfaceParams {
  out.sigmaOverRho = fluid.surfaceTension / fluid.density;
  out.kinematicViscosity =
    (fluid.dynamicViscosity / fluid.density) * (1 + SURFACTANT_DAMPING_GAIN * fluid.surfactant);
  out.ior = fluid.ior;
  for (let i = 0; i < 3; i++) {
    out.absorptionPerMm[i] = fluid.absorptionPerMm[i]!;
    out.scatterAlbedo[i] = fluid.scatterAlbedo[i]!;
  }
  out.scatteringPerMm = fluid.scatteringPerMm;
  out.bubbleLifetime = bubbleLifetime(fluid);
  deriveLayerParams(fluid, drops.rain, out.rain);
  deriveLayerParams(fluid, drops.drips, out.drips);
  return out;
}
