export interface Lut3DOptions {
  /** Optional descriptive title from the LUT file. */
  title?: string | undefined;
}

/**
 * Represents a 3D Color Lookup Table (LUT) for color grading and tonemapping.
 *
 * Internal layout is RGBA float32 formatted with dimension [size, size, size].
 * Texels are ordered with R advancing fastest, then G, then B:
 *   index = ((b * size + g) * size + r) * 4
 */
export class Lut3D {
  /** The cube dimension (e.g. 16, 32, 33, 64). width = height = depth = size. */
  public readonly size: number;

  /** RGBA float data of length size * size * size * 4. Values typically in [0.0, 1.0]. */
  public readonly data: Float32Array;

  /** Optional descriptive title from the LUT file. */
  public readonly title?: string | undefined;

  /** Set to true when data is mutated to signal a GPU re-upload. */
  public needsUpdate: boolean = false;

  constructor(data: Float32Array, size: number, options: Lut3DOptions = {}) {
    if (size <= 1 || (size | 0) !== size) {
      throw new Error(`Lut3D: size must be an integer > 1, got ${size}`);
    }
    const expectedLength = size * size * size * 4;
    if (data.length !== expectedLength) {
      throw new Error(
        `Lut3D: data length (${data.length}) does not match size ${size}^3 * 4 (${expectedLength})`,
      );
    }
    this.size = size;
    this.data = data;
    this.title = options.title;
  }

  /**
   * Generates a neutral identity 3D LUT where input color (r, g, b) maps to output (r, g, b).
   * @param size The grid size (defaults to 32).
   */
  public static createIdentity(size: number = 32): Lut3D {
    const data = new Float32Array(size * size * size * 4);
    const denom = size > 1 ? size - 1 : 1;
    let ptr = 0;
    for (let b = 0; b < size; b++) {
      const bNorm = b / denom;
      for (let g = 0; g < size; g++) {
        const gNorm = g / denom;
        for (let r = 0; r < size; r++) {
          const rNorm = r / denom;
          data[ptr++] = rNorm;
          data[ptr++] = gNorm;
          data[ptr++] = bNorm;
          data[ptr++] = 1.0;
        }
      }
    }
    return new Lut3D(data, size, { title: "Identity" });
  }

  /**
   * Creates a Lut3D from raw RGBA float data.
   */
  public static fromData(data: Float32Array, size: number, options?: Lut3DOptions): Lut3D {
    return new Lut3D(data, size, options);
  }
}
