import { FluidSurfaceMaterial, FluidSurfaceMaterialOptions } from "./FluidSurfaceMaterial.js";
import { Color } from "../../colors/index.js";
import { MaterialType } from "../../../enums/index.js";

export type LavaMaterialOptions = FluidSurfaceMaterialOptions;

/**
 * Opaque, glowing molten-rock preset on {@link FluidSurfaceMaterial} -- see
 * docs/adr/0013-unified-liquid-surface-material.md. A "flow family" sibling of
 * {@link OpenWaterMaterial}/{@link StylizedWaterMaterial} (the "wave family"): same noise-driven
 * flow mechanism, opaque and emissive instead of transparent and refractive.
 *
 * The `noiseMap` is a crack/crust mask: LOW luma = hot crack (emissive, `color`), HIGH luma = cooled
 * crust (`edgeColor`). Stylized look: dark crust, glowing pulsing cracks, normal-mapped plates.
 */
export class LavaMaterial extends FluidSurfaceMaterial {
  constructor(options: LavaMaterialOptions = {}) {
    const {
      color = new Color(1.0, 0.3, 0.02),
      edgeColor = new Color(0.12, 0.05, 0.035),
      flowSpeed = 0.3,
      distortion = 0.7,
      viscosity = 14.0,
      emissiveColor = new Color(1.0, 0.3, 0.03),
      emissiveStrength = 1.6,
      emissiveMask = 1.0,
      emissivePulse = 0.35,
      emissivePulseSpeed = 1.6,
      transitionSoftness = 0.15,
      normalStrength = 1.0,
      shade = 0.6,
      waveAmplitude = 0.05,
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
        emissiveMask,
        emissivePulse,
        emissivePulseSpeed,
        transitionSoftness,
        normalStrength,
        shade,
        waveAmplitude,
        ...rest,
      },
      MaterialType.LAVA,
    );

    this.transparent = false;
    this.depthWrite = true;
  }
}
