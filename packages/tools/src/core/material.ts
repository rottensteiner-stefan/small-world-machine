/**
 * Headless PBR map pipeline (`MaterialMapPipeline`), extracted from
 * `MaterialStudioController.generatePBRMaps` (MaterialStudioController.ts:562-713).
 *
 * All seven maps (diffuse + height/normal/specular/roughness/AO/edge) are derived from
 * a single diffuse RGBA buffer through the pure generators of
 * `common/dsp/TextureFilters.ts`. The values of `MaterialStudioMapParams` reflect the
 * slider semantics of the studio UI (percent fields such as `normalStrength`,
 * `specThresh`, `aoLevel`, `edgeThresh` are normalized inside here, exactly where the
 * controller normalized them), so a preset value produces byte-identical maps in the
 * web UI and in the future `swm material gen`.
 *
 * The UI/sandbox stays browser-only; the controller imports the same presets and calls
 * the same pipeline, keeping a single derivation used by web and CLI.
 */

import { NormalMapFormat } from "@small-world-machine/engine";
import {
  generateAOMap,
  generateEdgeMap,
  generateHeightMap,
  generateNormalMap,
  generateRoughnessMap,
  generateSpecularMap,
} from "../common/dsp/TextureFilters.js";
import type { RgbaImage } from "./RasterIO.js";

export interface MaterialStudioMapParams {
  heightBlur: number;
  heightContrast: number;
  heightInvert: boolean;
  normalStrength: number;
  normalFormat: NormalMapFormat;
  normalInvertR: boolean;
  specContrast: number;
  specThresh: number;
  specInvert: boolean;
  roughGamma: number;
  roughInvert: boolean;
  aoSoft: number;
  aoFine: number;
  aoLevel: number;
  edgeThresh: number;
  edgeThick: number;
  edgeInvert: boolean;
}

export type MaterialPresetId = "default" | "stone" | "metal" | "wood";

/** The studio profiles as raw slider-level parameter sets (single source of truth). */
export const MATERIAL_STUDIO_PRESETS: Record<MaterialPresetId, MaterialStudioMapParams> = {
  default: {
    heightBlur: 0,
    heightContrast: 1.0,
    heightInvert: false,
    normalStrength: 100,
    normalFormat: NormalMapFormat.OPENGL,
    normalInvertR: false,
    specContrast: 10,
    specThresh: 50,
    specInvert: false,
    roughGamma: 1.2,
    roughInvert: false,
    aoSoft: 15,
    aoFine: 1.0,
    aoLevel: 30,
    edgeThresh: 90,
    edgeThick: 1,
    edgeInvert: true,
  },
  stone: {
    heightBlur: 1,
    heightContrast: 1.2,
    heightInvert: false,
    normalStrength: 180,
    normalFormat: NormalMapFormat.OPENGL,
    normalInvertR: false,
    specContrast: 5,
    specThresh: 40,
    specInvert: false,
    roughGamma: 0.7,
    roughInvert: false,
    aoSoft: 25,
    aoFine: 1.5,
    aoLevel: 20,
    edgeThresh: 85,
    edgeThick: 2,
    edgeInvert: true,
  },
  metal: {
    heightBlur: 0,
    heightContrast: 0.8,
    heightInvert: false,
    normalStrength: 50,
    normalFormat: NormalMapFormat.OPENGL,
    normalInvertR: false,
    specContrast: 25,
    specThresh: 60,
    specInvert: false,
    roughGamma: 1.8,
    roughInvert: false,
    aoSoft: 5,
    aoFine: 0.5,
    aoLevel: 40,
    edgeThresh: 95,
    edgeThick: 1,
    edgeInvert: true,
  },
  wood: {
    heightBlur: 1,
    heightContrast: 1.1,
    heightInvert: false,
    normalStrength: 200,
    normalFormat: NormalMapFormat.OPENGL,
    normalInvertR: false,
    specContrast: 0,
    specThresh: 40,
    specInvert: false,
    roughGamma: 1.5,
    roughInvert: false,
    aoSoft: 20,
    aoFine: 1.2,
    aoLevel: 20,
    edgeThresh: 85,
    edgeThick: 1,
    edgeInvert: true,
  },
};

export interface MaterialPbrMaps {
  diffuse: RgbaImage;
  height: RgbaImage;
  normal: RgbaImage;
  specular: RgbaImage;
  roughness: RgbaImage;
  ao: RgbaImage;
  edge: RgbaImage;
}

/** Derives all PBR maps from a diffuse RGBA buffer. Pure and deterministic. */
export function derivePbrMaps(image: RgbaImage, params: MaterialStudioMapParams): MaterialPbrMaps {
  const w = image.width;
  const h = image.height;
  const pixels = image.data;

  const height = generateHeightMap(pixels, w, h, {
    blur: params.heightBlur,
    contrast: params.heightContrast,
    invert: params.heightInvert,
  });
  const normal = generateNormalMap(height, w, h, {
    strength: params.normalStrength / 100.0,
    format: params.normalFormat,
    invertR: params.normalInvertR,
  });
  const specular = generateSpecularMap(height, {
    contrast: params.specContrast,
    threshold: params.specThresh / 100.0,
    invert: params.specInvert,
  });
  const roughness = generateRoughnessMap(specular, {
    gamma: params.roughGamma,
    invert: params.roughInvert,
  });
  const ao = generateAOMap(height, w, h, {
    soft: params.aoSoft,
    fine: params.aoFine,
    level: params.aoLevel / 100.0,
  });
  const edge = generateEdgeMap(height, w, h, {
    threshold: params.edgeThresh / 100.0,
    thickness: params.edgeThick,
    invert: params.edgeInvert,
  });

  return {
    diffuse: { width: w, height: h, data: new Uint8ClampedArray(pixels) },
    height: { width: w, height: h, data: height },
    normal: { width: w, height: h, data: normal },
    specular: { width: w, height: h, data: specular },
    roughness: { width: w, height: h, data: roughness },
    ao: { width: w, height: h, data: ao },
    edge: { width: w, height: h, data: edge },
  };
}
