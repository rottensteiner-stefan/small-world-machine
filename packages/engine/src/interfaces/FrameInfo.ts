/**
 * Per-frame timing context. Owned and updated by the application (`SmallWorldMachine.step()`),
 * read by renderers and post-processing passes -- the single source of time for everything that
 * animates on the GPU, so a fixed-timestep `step()` run is fully reproducible.
 *
 * Two time domains, like Unity's `time` / `unscaledTime`:
 * - gameplay time (`time`, `deltaTime`) is scaled by hit-stop and only advances in `step()`.
 * - real time (`realTime`, `realDeltaTime`) ignores hit-stop; use it for effects that must not freeze
 *   with the gameplay (film grain, camera effects).
 */
export interface FrameInfo {
  /** Accumulated gameplay time in seconds (hit-stop scaled). */
  time: number;
  /** Gameplay seconds this frame (hit-stop scaled). */
  deltaTime: number;
  /** Accumulated unscaled time in seconds. */
  realTime: number;
  /** Unscaled seconds this frame. */
  realDeltaTime: number;
  /** Number of frames stepped so far (0 before the first frame). */
  frameIndex: number;
}

/** Creates a zeroed {@link FrameInfo}. */
export function createFrameInfo(): FrameInfo {
  return { time: 0, deltaTime: 0, realTime: 0, realDeltaTime: 0, frameIndex: 0 };
}
