/**
 * Color-grading camera-look presets of the post-processing `u_filterMode` selector. Each value is the
 * literal number the assembled `FILTER_COLOR_GRADING` shader branches on (`if (u_filterMode == 1)` /
 * WGSL `if (1u == u_filterMode)`), so renaming a member must never change its value; the GLSL/WGSL
 * branch labels must stay the humanized member name (`PostFilterMode.test.ts` locks them together).
 * `0` is not a member: it is the `PostProcessingGroup.filterMode` default/off and carries no branch.
 * Values above the presets (e.g. `8` = gravitational lensing) belong to other post elements, not here.
 */
export const PostFilterMode = {
  NIGHT_VISION: 1,
  NOIR_DETECTIVE: 2,
  CYBER_GLITCH: 3,
  VHS_TAPE: 4,
  UNDERWORLD: 5,
  OLD_PROJECTOR: 6,
  THERMAL_VISION: 7,
} as const;

/** Type definition for PostFilterMode. */
export type PostFilterMode = (typeof PostFilterMode)[keyof typeof PostFilterMode];
