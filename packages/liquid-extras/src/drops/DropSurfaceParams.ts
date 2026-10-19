/**
 * Contract between the drop-impact system (producer: fluid + drop properties -> derived physics)
 * and every liquid surface that renders impacts (consumer, e.g. `RainPuddleMaterial`). ADR 0042:
 * pairings are data, so a surface only ever sees these numbers, never "which liquid" it is.
 *
 * All values SI unless the name says otherwise.
 */

/** Per drop-layer (dense small rain vs. sparse big drips) impact behaviour. */
export interface DropLayerParams {
  /** Smallest drop diameter in the layer, metres. */
  diameterMin: number;
  /** Largest drop diameter in the layer, metres. */
  diameterMax: number;
  /** Peak ripple slope a typical drop of this layer produces (dimensionless, ~0.05-0.3). */
  slopeScale: number;
  /** Probability that an impact throws a Worthington daughter drop, 0-1 (falls with Ohnesorge). */
  daughterProbability: number;
  /** Strength of the short-lived crown/jet shader illusion at the impact point, 0-1. */
  crownStrength: number;
  /** Probability that an impact leaves a floating surface bubble, 0-1. */
  bubbleProbability: number;
}

export interface DropSurfaceParams {
  /** Surface tension over density, sigma/rho, m^3/s^2 (capillary term of the dispersion relation). */
  sigmaOverRho: number;
  /** Kinematic viscosity nu = mu/rho, m^2/s (ripple damping 2*nu*k^2). */
  kinematicViscosity: number;
  /** Index of refraction of the liquid (dielectric Fresnel). */
  ior: number;
  /** Beer-Lambert absorption coefficient per colour channel, 1/mm (linear RGB). */
  absorptionPerMm: [number, number, number];
  /** Diffuse body reflectance, linear RGB 0-1 (blood: dark red, water: 0); see FluidProperties.scatterAlbedo. */
  scatterAlbedo: [number, number, number];
  /** Scattering coefficient, 1/mm; with depth it sets how opaque the body is (water ~0). */
  scatteringPerMm: number;
  /** Lifetime of a surface bubble, seconds (0 = bubbles pop immediately). */
  bubbleLifetime: number;
  /** Dense small-drop layer (rain). */
  rain: DropLayerParams;
  /** Sparse big-drop layer (drips from above). */
  drips: DropLayerParams;
}
