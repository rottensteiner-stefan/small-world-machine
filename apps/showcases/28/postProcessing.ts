import type {
  Renderer,
  BloomElement,
  GrainElement,
  HbaoElement,
  ToneMappingElement,
  VignetteElement,
} from "@small-world-machine/engine";
import { PostProcessingEffectType } from "@small-world-machine/engine";

/** Dark-cleanroom grade: only the laser, caustic fan and spectrum band bloom. */
export function configurePostProcessing(renderer: Renderer): void {
  // Post-Processing: Vivid HDR Bloom for laser and dispersed spectral rays. Plan P0-1 exposure
  // rebalance: dark cleanroom first, spectrum reads as light; bloom threshold raised well above
  // the lit geometry so only the laser/fan/band glow blooms.
  renderer.postProcessing.enabled = true;
  const bloom = renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
  if (bloom) {
    bloom.enabled = true;
    bloom.intensity = 0.35;
    bloom.threshold = 1.05;
    bloom.softThreshold = 0.05;
    bloom.radius = 0.6;
  }

  const hbao = renderer.postProcessing.get<HbaoElement>(PostProcessingEffectType.HBAO);
  if (hbao) {
    // Disabled: on the WebGPU path the HBAO pass read as blotchy denoiser smudges over the dark
    // anodized bench. Vignette + the dark grade carry the contact mood instead (graceful no-op
    // on WebGL1 either way).
    hbao.enabled = false;
  }

  const vignette = renderer.postProcessing.get<VignetteElement>(PostProcessingEffectType.VIGNETTE);
  if (vignette) {
    vignette.enabled = true;
    vignette.offset = 0.78;
    vignette.darkness = 0.4;
  }

  const grain = renderer.postProcessing.get<GrainElement>(PostProcessingEffectType.GRAIN);
  if (grain) {
    grain.enabled = true;
    grain.intensity = 0.015;
  }

  // ACES_FILMIC tone mapping kept; exposure lightly lifted off pure-neutral as the last grade
  // knob after the P0-1 rebalance (plan: 0.9-1.1 tuned last).
  const toneMap = renderer.postProcessing.get<ToneMappingElement>(
    PostProcessingEffectType.TONE_MAPPING,
  );
  if (toneMap) {
    toneMap.exposure = 1.08;
  }
}
