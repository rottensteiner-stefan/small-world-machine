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

export function decodeBundle(group: PostProcessingGroup): PostEffectBundle {
  return {
    tm: group.get<ToneMappingElement>(PostProcessingEffectType.TONE_MAPPING),
    vig: group.get<VignetteElement>(PostProcessingEffectType.VIGNETTE),
    grain: group.get<GrainElement>(PostProcessingEffectType.GRAIN),
    bloom: group.get<BloomElement>(PostProcessingEffectType.BLOOM),
    grade: group.get<ColorGradingElement>(PostProcessingEffectType.COLOR_GRADING),
    quant: group.get<QuantizeElement>(PostProcessingEffectType.QUANTIZE),
    hbao: group.get<HbaoElement>(PostProcessingEffectType.HBAO),
    shafts: group.get<LightShaftsElement>(PostProcessingEffectType.LIGHT_SHAFTS),
    volFog: group.get<VolumetricFogElement>(PostProcessingEffectType.VOLUMETRIC_FOG),
    outline: group.get<OutlineElement>(PostProcessingEffectType.OUTLINE),
    flash: group.get<FlashElement>(PostProcessingEffectType.FLASH),
    lensing: group.get<GravitationalLensingElement>(PostProcessingEffectType.GRAVITATIONAL_LENSING),
  };
}
