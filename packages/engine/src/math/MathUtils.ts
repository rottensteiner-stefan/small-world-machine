/**
 * Utility class for mathematical operations and constants.
 */
export class MathUtils {
  /** Mathematical constant PI. */
  public static readonly PI: number = Math.PI;
  /** Mathematical constant 2 * PI. */
  public static readonly TWO_PI: number = Math.PI * 2.0;
  /** Mathematical constant PI / 2. */
  public static readonly HALF_PI: number = Math.PI / 2.0;
  /** Mathematical constant PI / 4. */
  public static readonly QUARTER_PI: number = Math.PI / 4.0;
  /** Constant to convert degrees to radians. */
  public static readonly DEG2RAD: number = Math.PI / 180.0;
  /** Constant to convert radians to degrees. */
  public static readonly RAD2DEG: number = 180.0 / Math.PI;

  /**
   * Converts degrees to radians.
   * @param degrees The angle in degrees.
   * @returns The angle in radians.
   */
  public static degToRad(degrees: number): number {
    return degrees * MathUtils.DEG2RAD;
  }

  /**
   * Converts radians to degrees.
   * @param radians The angle in radians.
   * @returns The angle in degrees.
   */
  public static radToDeg(radians: number): number {
    return radians * MathUtils.RAD2DEG;
  }

  /**
   * Returns the sine of the given angle in radians.
   * @param rad The angle in radians.
   * @returns The sine of the angle.
   */
  public static fastSin(rad: number): number {
    return Math.sin(rad);
  }

  /**
   * Returns the cosine of the given angle in radians.
   * @param rad The angle in radians.
   * @returns The cosine of the angle.
   */
  public static fastCos(rad: number): number {
    return Math.cos(rad);
  }

  /**
   * Clamps a value between a minimum and maximum.
   * @param val The value to clamp.
   * @param min The minimum value.
   * @param max The maximum value.
   * @returns The clamped value.
   */
  public static clamp(val: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, val));
  }

  /**
   * Linearly interpolates between two numbers by a factor `t`.
   * @param a The start value (returned when t = 0).
   * @param b The end value (returned when t = 1).
   * @param t The interpolation factor, typically in [0, 1].
   * @returns The interpolated value.
   */
  public static lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  /**
   * Performs smooth Hermite interpolation between `min` and `max` using a cubic polynomial: 3t^2 - 2t^3.
   * @param min Lower bound.
   * @param max Upper bound.
   * @param x Value to interpolate.
   * @returns Clamped interpolated value in [0, 1].
   */
  public static smoothstep(min: number, max: number, x: number): number {
    if (x <= min) return 0;
    if (x >= max) return 1;
    const t = (x - min) / (max - min);
    return t * t * (3 - 2 * t);
  }

  /**
   * Performs Ken Perlin's quintic smoother interpolation: 6t^5 - 15t^4 + 10t^3 (zero 1st and 2nd derivatives at endpoints).
   * @param min Lower bound.
   * @param max Upper bound.
   * @param x Value to interpolate.
   * @returns Clamped interpolated value in [0, 1].
   */
  public static smootherstep(min: number, max: number, x: number): number {
    if (x <= min) return 0;
    if (x >= max) return 1;
    const t = (x - min) / (max - min);
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  /**
   * Returns the normalized linear interpolation factor `t` in [0, 1] of `val` between `a` and `b`.
   * @param a The start value.
   * @param b The end value.
   * @param val The value to measure.
   * @returns Factor `t` such that `lerp(a, b, t) === val`. Returns 0 if `a === b`.
   */
  public static inverseLerp(a: number, b: number, val: number): number {
    if (a !== b) {
      return (val - a) / (b - a);
    }
    return 0;
  }

  /**
   * Smoothly dampens a value toward a target using framerate-independent exponential smoothing.
   * @param a Current value.
   * @param b Target value.
   * @param lambda Smoothing factor (higher = faster response).
   * @param dt Elapsed time in seconds.
   * @returns Dampened value.
   */
  public static damp(a: number, b: number, lambda: number, dt: number): number {
    return MathUtils.lerp(a, b, 1 - Math.exp(-lambda * dt));
  }

  /**
   * Checks whether an integer is a positive power of two.
   * @param value The integer to check.
   * @returns True if value is a power of two, false otherwise.
   */
  public static isPowerOfTwo(value: number): boolean {
    return (value & (value - 1)) === 0 && value > 0;
  }

  /**
   * Returns the smallest power of two greater than or equal to `value`.
   * @param value The input number.
   * @returns Next power of two.
   */
  public static nextPowerOfTwo(value: number): number {
    let v = Math.max(0, value - 1);
    v |= v >> 1;
    v |= v >> 2;
    v |= v >> 4;
    v |= v >> 8;
    v |= v >> 16;
    return v + 1;
  }

  /**
   * Reads an element from a fixed-size array whose bounds are guaranteed
   * correct by construction (e.g. Float32Array components of a Matrix4/
   * Quaternion, or a small fixed axis list) — centralizes the
   * `noUncheckedIndexedAccess` trust boundary in one place instead of a raw
   * non-null assertion at every call site.
   * @param arr The array-like to read from.
   * @param index The index to read.
   * @returns The element at the given index.
   */
  public static at<T>(arr: ArrayLike<T>, index: number): T {
    return arr[index] as T;
  }

  /**
   * Generates a unique identifier (UUID v4).
   * Uses crypto.randomUUID() if available.
   * @returns A string representation of a UUID.
   */
  public static generateUUID(): string {
    if ("undefined" !== typeof crypto && "function" === typeof crypto.randomUUID) {
      return crypto.randomUUID();
    }

    // Fallback for insecure contexts or older browsers
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = "x" === c ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
