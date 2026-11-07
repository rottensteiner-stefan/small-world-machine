/** Slow "breathing" envelope frequencies in Hz (two incommensurate octaves). */
const ENVELOPE_FREQ_A = 1.1;
const ENVELOPE_FREQ_B = 2.7;
/** Fast combustion jitter frequency in Hz. */
const MICRO_FREQ = 13;

/**
 * Continuous flame brightness profile: a slow two-octave envelope plus fast micro-jitter, never
 * gated into stable phases like `FlickerBehavior` (that one models broken electrics). Values stay
 * within [{@link FireFlickerProfile.MIN}, {@link FireFlickerProfile.MAX}] so a fire breathes but
 * never goes dark. Pure function of (seed, time): identical on every platform, so golden captures
 * can freeze it.
 */
export class FireFlickerProfile {
  /** @fixed lowest multiplier; a fire dims but never goes out. */
  public static readonly MIN = 0.25;
  /** @fixed highest multiplier; brief flare above the base intensity. */
  public static readonly MAX = 1.15;

  private readonly _seed: number;

  /**
   * @param seed Integer-like seed; different seeds give uncorrelated curves.
   */
  constructor(seed: number = 0) {
    this._seed = Math.floor(seed) | 0;
  }

  /**
   * Brightness multiplier at `time` seconds.
   */
  public sample(time: number): number {
    const envelope =
      0.65 * this._noise(time * ENVELOPE_FREQ_A, 0) + 0.35 * this._noise(time * ENVELOPE_FREQ_B, 1);
    const micro = this._noise(time * MICRO_FREQ, 2) - 0.5;
    const value = 0.82 + 0.5 * (envelope - 0.5) + 0.22 * micro;
    return Math.min(FireFlickerProfile.MAX, Math.max(FireFlickerProfile.MIN, value));
  }

  /**
   * Smooth 1D value noise in [0, 1] on channel `channel` (independent streams per channel).
   */
  public noise(x: number, channel: number): number {
    return this._noise(x, channel);
  }

  private _noise(x: number, channel: number): number {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    const a = this._hash(i, channel);
    const b = this._hash(i + 1, channel);
    return a + (b - a) * u;
  }

  // Integer hash instead of the usual sin() hash: sin() differs between JS engines after a few
  // ulps, which breaks cross-platform determinism (seen in the splatter CLI work).
  private _hash(i: number, channel: number): number {
    const stream = (this._seed + Math.imul(channel, 0x9e3779b9)) | 0;
    let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(stream, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
}
