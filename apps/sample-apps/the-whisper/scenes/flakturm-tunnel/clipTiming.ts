/** Desired loop length (seconds) for clips whose source is much shorter than natural gait cadence.
 * `descending_stairs.glb` is only 0.375s (vs. 1.33s ascending), which reads as frantic twitching. */
export const CLIP_CYCLE_OVERRIDES: Readonly<Record<string, number>> = {
  stairs_down: 1.0,
};

/** AnimationAction.timeScale that stretches a clip to its overridden cycle length (1 if none). */
export function resolveClipTimeScale(name: string, clipDuration: number): number {
  const target = CLIP_CYCLE_OVERRIDES[name];
  if (target === undefined || clipDuration <= 0) return 1;
  return clipDuration / target;
}
