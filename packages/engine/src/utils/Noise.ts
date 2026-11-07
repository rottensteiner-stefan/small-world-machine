import { createNoise2D, createNoise3D } from "simplex-noise";

/**
 * A facade for the 'simplex-noise' library to provide a consistent API.
 * Provides static methods for Perlin and Simplex noise.
 */
export class Noise {
  private static _noise2D: (x: number, y: number) => number;
  private static _noise3D: (x: number, y: number, z: number) => number;
  private static _initialized: boolean = false;

  private static _init(): void {
    if (true === this._initialized) {
      return;
    }

    this._noise2D = createNoise2D();
    this._noise3D = createNoise3D();
    this._initialized = true;
  }

  /**
   * 3D Simplex Noise.
   * @param x X coordinate.
   * @param y Y coordinate.
   * @param z Z coordinate.
   * @returns Value between -1.0 and 1.0.
   */
  public static perlin3(x: number, y: number, z: number): number {
    this._init();
    return this._noise3D(x, y, z);
  }

  /**
   * 2D Simplex Noise.
   * @param x X coordinate.
   * @param y Y coordinate.
   * @returns Value between -1.0 and 1.0.
   */
  public static perlin2(x: number, y: number): number {
    this._init();
    return this._noise2D(x, y);
  }

  /**
   * 2D Simplex Noise.
   * @param x X coordinate.
   * @param y Y coordinate.
   * @returns Value between -1.0 and 1.0.
   */
  public static simplex2(x: number, y: number): number {
    this._init();
    return this._noise2D(x, y);
  }
}
