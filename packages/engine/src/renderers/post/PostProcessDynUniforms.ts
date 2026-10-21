/**
 * WebGPU `DynUniforms` block layout for the post-process uber pass. Owned by the post module: the
 * elements write their own slices through `PostProcessingElement.packUniforms`, and this file holds
 * the block size and the identity-state packing that stands in for effect slots that are absent from
 * a `PostProcessingGroup` (the group registers every effect by default, so this is a defensive
 * neutral baseline, not a per-frame dependency).
 *
 * Slice ownership mirrors `execute()` in `PostProcessPass` and the WGSL declaration in
 * `PostProcess.frag.wgsl` (13x vec4f): the same slot must never be written by two elements.
 */
export const POST_PROCESS_DYNUNIFORM_FLOATS = 52;

/**
 * Writes the identity state of every effect slice into `out` at `offset` (float index). For absent
 * or newly-created groups this is what the uber shader must see: transparency for effects that do
 * not exist. Two slots intentionally differ from the enabled-"default" of their element:
 * - `inverseGamma` is 1.0 (tone mapping absent = no gamma correction; an enabled element describes
 *   an actual curve).
 * Note: `shaftsColor` (slots 48..51) is currently NOT read by `PostProcess.frag.wgsl` -- the tint
 * is applied in the raymarch (`LightShaftsPassGPU`, sunColor) and the composite is a plain add. The
 * lane is kept as reserved layout space (the 13x vec4f struct is mirrored by tests/WGSL), written
 * neutral here and by `LightShaftsElement.packUniforms`.
 */
export function packPostProcessNeutralUniforms(out: Float32Array, offset: number): void {
  const o = offset;
  // a: [time, exposure, inverseGamma, vignetteOffset]
  out[o + 1] = 1.0;
  out[o + 2] = 1.0;
  out[o + 3] = 0.8;
  // b: [vignetteDarkness, vignetteRoundness, grainIntensity, bloomIntensity]
  out[o + 4] = 0.5;
  out[o + 5] = 2.0;
  out[o + 6] = 0.05;
  out[o + 7] = 1.0;
  // c: [quantizeSteps, outlineThickness, outlineSensitivity, gainB]
  out[o + 8] = 8.0;
  out[o + 9] = 1.0;
  out[o + 10] = 1.0;
  out[o + 11] = 1.0;
  // bloomColor: white; blank pad.
  out[o + 12] = 1.0;
  out[o + 13] = 1.0;
  out[o + 14] = 1.0;
  out[o + 15] = 0.0;
  // outlineColor: black; blank pad.
  out[o + 16] = 0.0;
  out[o + 17] = 0.0;
  out[o + 18] = 0.0;
  out[o + 19] = 0.0;
  // grading0: [contrast, saturation, temperature, tint]
  out[o + 20] = 1.0;
  out[o + 21] = 1.0;
  out[o + 22] = 0.0;
  out[o + 23] = 0.0;
  // grading1: [liftR, liftG, liftB, gammaR]
  out[o + 24] = 0.0;
  out[o + 25] = 0.0;
  out[o + 26] = 0.0;
  out[o + 27] = 1.0;
  // grading2: [gammaG, gammaB, gainR, gainG]
  out[o + 28] = 1.0;
  out[o + 29] = 1.0;
  out[o + 30] = 1.0;
  out[o + 31] = 1.0;
  // singularityPos: [screenPosX, screenPosY, screenPosZ, eventHorizonRadius]
  out[o + 32] = 0.0;
  out[o + 33] = 0.0;
  out[o + 34] = 1.0;
  out[o + 35] = 0.03;
  // lensingParams: [strength, spaghettification, relativisticBeaming, ringGlowIntensity]
  out[o + 36] = 0.25;
  out[o + 37] = 0.15;
  out[o + 38] = 1.2;
  out[o + 39] = 2.5;
  // flashParams: [color.r, color.g, color.b, intensity]
  out[o + 40] = 1.0;
  out[o + 41] = 1.0;
  out[o + 42] = 1.0;
  out[o + 43] = 0.0;
  // shaftsParams: [intensity, density, 0, 0]
  out[o + 44] = 1.0;
  out[o + 45] = 0.05;
  out[o + 46] = 0.0;
  out[o + 47] = 0.0;
  // shaftsColor: [r, g, b, 1.0]
  out[o + 48] = 1.0;
  out[o + 49] = 1.0;
  out[o + 50] = 1.0;
  out[o + 51] = 1.0;
}
