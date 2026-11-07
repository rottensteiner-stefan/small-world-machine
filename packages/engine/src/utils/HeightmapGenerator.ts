import { Noise } from "./Noise.js";
import { mulberry32 } from "./SeededRandom.js";

/**
 * Utility class for heightmap generation using various algorithms.
 */
export class HeightmapGenerator {
  /**
   * Generates a heightmap using the Diamond-Square algorithm as an ImageBitmap.
   * @param detail Size = 2^detail + 1.
   * @param roughness The roughness factor.
   * @returns A promise resolving to an ImageBitmap.
   */
  public static async generateDiamondSquare(
    detail: number = 8,
    roughness: number = 0.6,
  ): Promise<ImageBitmap> {
    const floatData: Float32Array = await this.generateDiamondSquareFloat(detail, roughness);
    const size: number = Math.sqrt(floatData.length);

    const canvas: HTMLCanvasElement = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx: CanvasRenderingContext2D = canvas.getContext("2d")!;
    const imgData: ImageData = ctx.createImageData(size, size);

    for (let i: number = 0; i < floatData.length; i++) {
      const color: number = Math.floor((floatData[i] ?? 0) * 255);
      const index: number = i * 4;
      imgData.data[index] = color;
      imgData.data[index + 1] = color;
      imgData.data[index + 2] = color;
      imgData.data[index + 3] = 255;
    }

    ctx.putImageData(imgData, 0, 0);
    return await createImageBitmap(canvas);
  }

  /**
   * Generates a heightmap as a Float32Array using the Diamond-Square algorithm.
   * @param detail Size = 2^detail + 1.
   * @param roughness The roughness factor.
   * @param seed Optional seed for random generation.
   * @returns A promise resolving to a Float32Array.
   */
  public static async generateDiamondSquareFloat(
    detail: number = 8,
    roughness: number = 0.6,
    seed?: string,
  ): Promise<Float32Array> {
    const size: number = Math.pow(2, detail) + 1;
    const max: number = size - 1;
    const map: Float32Array = new Float32Array(size * size);

    const rng: () => number = seed ? mulberry32(this._cyrb128(seed)) : (): number => Math.random();

    const set = (x: number, y: number, val: number): void => {
      map[y * size + x] = val;
    };
    const get = (x: number, y: number): number => {
      if (0 > x || size <= x || 0 > y || size <= y) {
        return -1;
      }
      return map[y * size + x] ?? -1;
    };

    set(0, 0, 0.5);
    set(max, 0, 0.5);
    set(0, max, 0.5);
    set(max, max, 0.5);

    let stepSize: number = max;
    let randomScale: number = 1.0;

    while (1 < stepSize) {
      const halfStep: number = stepSize / 2;

      for (let y: number = 0; y < max; y += stepSize) {
        for (let x: number = 0; x < max; x += stepSize) {
          const a: number = get(x, y);
          const b: number = get(x + stepSize, y);
          const c: number = get(x, y + stepSize);
          const d: number = get(x + stepSize, y + stepSize);
          const avg: number = (a + b + c + d) / 4.0;
          const offset: number = (rng() - 0.5) * randomScale;
          set(x + halfStep, y + halfStep, avg + offset);
        }
      }

      for (let y: number = 0; y <= max; y += halfStep) {
        for (let x: number = 0 === y % stepSize ? halfStep : 0; x <= max; x += stepSize) {
          let sum: number = 0;
          let count: number = 0;
          const vals: number[] = [
            get(x, y - halfStep),
            get(x, y + halfStep),
            get(x - halfStep, y),
            get(x + halfStep, y),
          ];
          for (let i: number = 0; i < vals.length; i++) {
            const v: number = vals[i]!;
            if (-1 !== v) {
              sum += v;
              count++;
            }
          }
          const avg: number = sum / count;
          const offset: number = (rng() - 0.5) * randomScale;
          set(x, y, avg + offset);
        }
      }
      randomScale *= roughness;
      stepSize = halfStep;
    }

    let minVal: number = Infinity;
    let maxVal: number = -Infinity;
    for (let i: number = 0; i < map.length; i++) {
      const val: number = map[i] ?? 0;
      if (val < minVal) {
        minVal = val;
      }
      if (val > maxVal) {
        maxVal = val;
      }
    }
    const range: number = maxVal - minVal;
    if (0.000001 < range) {
      for (let i: number = 0; i < map.length; i++) {
        map[i] = ((map[i] ?? 0) - minVal) / range;
      }
    } else {
      map.fill(0.5);
    }
    return map;
  }

  /**
   * Generates a heightmap using Perlin noise.
   * @param detail Size = 2^detail + 1.
   * @param scale Noise scale.
   * @param offsetX X offset.
   * @param offsetY Y offset.
   * @param octaves Number of octaves.
   * @param persistence Persistence factor.
   * @returns A promise resolving to a Float32Array.
   */
  public static async generatePerlinFloat(
    detail: number = 8,
    scale: number = 0.02,
    offsetX: number = 0,
    offsetY: number = 0,
    octaves: number = 4,
    persistence: number = 0.5,
  ): Promise<Float32Array> {
    const size: number = Math.pow(2, detail) + 1;
    const map: Float32Array = new Float32Array(size * size);

    for (let y: number = 0; y < size; y++) {
      for (let x: number = 0; x < size; x++) {
        let amplitude: number = 1;
        let frequency: number = 1;
        let noiseValue: number = 0;
        let maxValue: number = 0;

        const worldX: number = (x + offsetX) * scale;
        const worldY: number = (y + offsetY) * scale;

        for (let i: number = 0; i < octaves; i++) {
          noiseValue += Noise.perlin2(worldX * frequency, worldY * frequency) * amplitude;
          maxValue += amplitude;
          amplitude *= persistence;
          frequency *= 2;
        }

        map[y * size + x] = (noiseValue / maxValue + 1) * 0.5;
      }
    }

    return map;
  }

  /**
   * Generates a heightmap using Simplex noise.
   * @param detail Size = 2^detail + 1.
   * @param scale Noise scale.
   * @param offsetX X offset.
   * @param offsetY Y offset.
   * @param octaves Number of octaves.
   * @param persistence Persistence factor.
   * @returns A promise resolving to a Float32Array.
   */
  public static async generateSimplexFloat(
    detail: number = 8,
    scale: number = 0.02,
    offsetX: number = 0,
    offsetY: number = 0,
    octaves: number = 4,
    persistence: number = 0.5,
  ): Promise<Float32Array> {
    const size: number = Math.pow(2, detail) + 1;
    const map: Float32Array = new Float32Array(size * size);

    for (let y: number = 0; y < size; y++) {
      for (let x: number = 0; x < size; x++) {
        let amplitude: number = 1;
        let frequency: number = 1;
        let noiseValue: number = 0;
        let maxValue: number = 0;

        const worldX: number = (x + offsetX) * scale;
        const worldY: number = (y + offsetY) * scale;

        for (let i: number = 0; i < octaves; i++) {
          noiseValue += Noise.simplex2(worldX * frequency, worldY * frequency) * amplitude;
          maxValue += amplitude;
          amplitude *= persistence;
          frequency *= 2;
        }

        map[y * size + x] = (noiseValue / maxValue + 1) * 0.5;
      }
    }

    return map;
  }

  private static _cyrb128(str: string): number {
    let h1: number = 1779033703;
    let h2: number = 3144134277;
    let h3: number = 1013904242;
    let h4: number = 2773480762;
    for (let i: number = 0; i < str.length; i++) {
      const k: number = str.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    return h1 >>> 0;
  }
}
