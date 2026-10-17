import type { FluidSurfaceMaterialOptions } from "./FluidSurfaceMaterial.js";
import { FluidSurfaceMaterial } from "./FluidSurfaceMaterial.js";
import { Color } from "../../colors/index.js";
import { MaterialType } from "../../../enums/index.js";

export type SlimeMaterialOptions = FluidSurfaceMaterialOptions;

/**
 * Translucent, faintly-glowing slime preset on {@link FluidSurfaceMaterial} -- see
 * docs/adr/0013-unified-liquid-surface-material.md. A "flow family" sibling of
 * {@link OpenWaterMaterial}/{@link StylizedWaterMaterial} (the "wave family"): same noise-driven
 * flow mechanism, tuned for a thick, oozing, faintly luminous look instead of open water.
 *
 * Substance comes from the optional core terms: normal-mapped glossy highlight, Fresnel rim and
 * Beer-Lambert absorption over the depth capture. `noiseMap` luma drives the body/rim colour mix.
 */
export class SlimeMaterial extends FluidSurfaceMaterial {
  constructor(options: SlimeMaterialOptions = {}) {
    const {
      color = new Color(0.25, 0.95, 0.12),
      edgeColor = new Color(0.25, 0.65, 0.1),
      flowSpeed = 0.5,
      distortion = 0.7,
      viscosity = 9.0,
      emissiveColor = new Color(0.4, 0.9, 0.2),
      emissiveStrength = 0.15,
      rimStrength = 0.5,
      specularStrength = 0.1,
      specularPower = 300.0,
      normalStrength = 1.6,
      absorption = 6.0,
      shade = 0.5,
      waveAmplitude = 0.06,
      ...rest
    } = options;

    super(
      {
        color,
        edgeColor,
        flowSpeed,
        distortion,
        viscosity,
        emissiveColor,
        emissiveStrength,
        rimStrength,
        specularStrength,
        specularPower,
        normalStrength,
        absorption,
        shade,
        waveAmplitude,
        ...rest,
      },
      MaterialType.SLIME,
    );

    this.transparent = true;
    this.depthWrite = false;
  }
}
