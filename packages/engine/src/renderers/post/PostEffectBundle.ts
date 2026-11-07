import { PostProcessingEffectType } from "../../enums/index.js";
import type { PostProcessingGroup } from "./index.js";
import type {
  BloomElement,
  ColorGradingElement,
  FlashElement,
  GrainElement,
  GravitationalLensingElement,
  HbaoElement,
  LightShaftsElement,
  OutlineElement,
  QuantizeElement,
  ToneMappingElement,
  VignetteElement,
  VolumetricFogElement,
} from "./elements/index.js";

/**
 * Decoded element bundle. The uber passes resolve every element type they need exactly once per
 * execute() so the group is never re-asked (previously ~34 separate `group.get()` calls per frame
 * inside `PostProcessPass`). Shared by the GPU uber pass; the GL uber pass family
 * (`PostProcessPassGL`) consumes the same decoded slice.
 */
export interface PostEffectBundle {
  tm: ToneMappingElement | undefined;
  vig: VignetteElement | undefined;
  grain: GrainElement | undefined;
  bloom: BloomElement | undefined;
  grade: ColorGradingElement | undefined;
  quant: QuantizeElement | undefined;
  hbao: HbaoElement | undefined;
  shafts: LightShaftsElement | undefined;
  volFog: VolumetricFogElement | undefined;
  outline: OutlineElement | undefined;
  flash: FlashElement | undefined;
  lensing: GravitationalLensingElement | undefined;
}

/** An empty bundle, the reusable target of {@link decodeBundleInto}. */
export function createEmptyBundle(): PostEffectBundle {
  return {
    tm: undefined,
    vig: undefined,
    grain: undefined,
    bloom: undefined,
    grade: undefined,
    quant: undefined,
    hbao: undefined,
    shafts: undefined,
    volFog: undefined,
    outline: undefined,
    flash: undefined,
    lensing: undefined,
  };
}

/** Allocation-free decode: overwrites every field of `out` (the per-frame hot path reuses one). */
export function decodeBundleInto(
  group: PostProcessingGroup,
  out: PostEffectBundle,
): PostEffectBundle {
  out.tm = group.get<ToneMappingElement>(PostProcessingEffectType.TONE_MAPPING);
  out.vig = group.get<VignetteElement>(PostProcessingEffectType.VIGNETTE);
  out.grain = group.get<GrainElement>(PostProcessingEffectType.GRAIN);
  out.bloom = group.get<BloomElement>(PostProcessingEffectType.BLOOM);
  out.grade = group.get<ColorGradingElement>(PostProcessingEffectType.COLOR_GRADING);
  out.quant = group.get<QuantizeElement>(PostProcessingEffectType.QUANTIZE);
  out.hbao = group.get<HbaoElement>(PostProcessingEffectType.HBAO);
  out.shafts = group.get<LightShaftsElement>(PostProcessingEffectType.LIGHT_SHAFTS);
  out.volFog = group.get<VolumetricFogElement>(PostProcessingEffectType.VOLUMETRIC_FOG);
  out.outline = group.get<OutlineElement>(PostProcessingEffectType.OUTLINE);
  out.flash = group.get<FlashElement>(PostProcessingEffectType.FLASH);
  out.lensing = group.get<GravitationalLensingElement>(
    PostProcessingEffectType.GRAVITATIONAL_LENSING,
  );
  return out;
}

/** Allocating convenience wrapper (tests / cold paths). Per-frame callers use `decodeBundleInto`. */
export function decodeBundle(group: PostProcessingGroup): PostEffectBundle {
  return decodeBundleInto(group, createEmptyBundle());
}
