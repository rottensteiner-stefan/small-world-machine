import { AbstractGeometry } from "./AbstractGeometry.js";

/**
 * Strategy function type for extracting height from color data.
 */
export type TerrainHeightStrategy = (
  r: number,
  g: number,
  b: number,
  a: number,
  maxHeight?: number,
) => number;

/**
 * Built-in terrain height strategies.
 */
export const TerrainStrategies = {
  /** Average of RGB components normalized. */
  CENTERED_AVERAGE: (r: number, g: number, b: number, _a: number): number => {
    return (r + g + b) / 3.0 / 255.0;
  },
  /** Use only red channel. */
  BASE_RED: (r: number, _g: number, _b: number, _a: number): number => {
    return r / 255.0;
  },
  /** Use only green channel. */
  BASE_GREEN: (_r: number, g: number, _b: number, _a: number): number => {
    return g / 255.0;
  },
  /** Use only blue channel. */
  BASE_BLUE: (_r: number, _g: number, b: number, _a: number): number => {
    return b / 255.0;
  },
  /** Use only alpha channel. */
  BASE_ALPHA: (_r: number, _g: number, _b: number, a: number): number => {
    return a / 255.0;
  },
  /** Inverted average of RGB components. */
  INVERTED_AVERAGE: (r: number, g: number, b: number, _a: number): number => {
    return 1.0 - (r + g + b) / 3.0 / 255.0;
  },
} as const;

/**
 * Common configuration options for terrain geometry.
 */
export interface TerrainOptions {
  /** The width of the terrain in world units. Defaults to 100. */
  width?: number;
  /** The depth of the terrain in world units. Defaults to 100. */
  depth?: number;
  /** The maximum height of the terrain. Defaults to 20. */
  maxHeight?: number;
  /** The number of segments along the width for the mesh. Defaults to 64. */
  meshWidthSegments?: number;
  /** The number of segments along the depth for the mesh. Defaults to 64. */
  meshDepthSegments?: number;
}

/**
 * Configuration for terrain initialized from raw float data.
 */
export interface TerrainDataOptions extends TerrainOptions {
  /** The height data (normalized 0-1). */
  heightData: Float32Array;
  /** The resolution of the heightmap grid. */
  heightmapResolution: number;
}

/**
 * Configuration for terrain initialized from an image.
 */
export interface TerrainImageOptions extends TerrainOptions {
  /** The image to use as a heightmap source. */
  image: HTMLImageElement | ImageBitmap;
  /** The strategy to extract height from image pixels. Defaults to CENTERED_AVERAGE. */
  strategy?: TerrainHeightStrategy;
}

/**
 * A terrain geometry generated from heightmaps.
 * Supports initialization from raw data or images.
 */
export class Terrain extends AbstractGeometry {
  /** The raw height data (0.0 to 1.0). */
  public heightData: Float32Array;
  /** The resolution of the heightmap grid. */
  public heightmapResolution: number;
  /** The world width of the terrain. */
  public width: number;
  /** The world depth of the terrain. */
  public depth: number;
  /** The world maximum height. */
  public maxHeight: number;
  /** The horizontal mesh subdivisions. */
  public meshWidthSegments: number;
  /** The vertical mesh subdivisions. */
  public meshDepthSegments: number;

  /**
   * Protected constructor. Use static factory methods Terrain.fromHeightData() or Terrain.fromImage().
   * @param options The configuration options.
   */
  protected constructor(options: TerrainDataOptions) {
    super();
    const {
      heightData,
      heightmapResolution,
      width = 100,
      depth = 100,
      maxHeight = 20,
      meshWidthSegments = 64,
      meshDepthSegments = 64,
    } = options;

    this.heightData = heightData;
    this.heightmapResolution = heightmapResolution;
    this.width = width;
    this.depth = depth;
    this.maxHeight = maxHeight;
    this.meshWidthSegments = Math.max(1, Math.floor(meshWidthSegments));
    this.meshDepthSegments = Math.max(1, Math.floor(meshDepthSegments));

    if (heightmapResolution * heightmapResolution !== heightData.length) {
      console.warn(
        `[Terrain] Heightmap data length (${heightData.length}) does not match resolution (${heightmapResolution}x${heightmapResolution}).`,
      );
    }
    this.generateGeometryData();
  }

  /**
   * Creates a Terrain instance from raw height data.
   * @param options The configuration options.
   * @returns A new Terrain instance.
   */
  public static fromHeightData(options: TerrainDataOptions): Terrain {
    return new Terrain(options);
  }

  /**
   * Creates a Terrain instance from an image.
   * @param options The configuration options.
   * @returns A promise resolving to a new Terrain instance.
   */
  public static async fromImage(options: TerrainImageOptions): Promise<Terrain> {
    const { image, strategy = TerrainStrategies.CENTERED_AVERAGE, maxHeight = 20 } = options;

    const canvas: HTMLCanvasElement = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;

    const ctx: CanvasRenderingContext2D = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(image as CanvasImageSource, 0, 0);
    const imgData: Uint8ClampedArray = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    const resolution: number = image.width; // Assume square
    const heightData: Float32Array = new Float32Array(resolution * resolution);

    for (let y: number = 0; y < resolution; y++) {
      for (let x: number = 0; x < resolution; x++) {
        const index: number = (y * resolution + x) * 4;
        const r: number = imgData[index] ?? 0;
        const g: number = imgData[index + 1] ?? 0;
        const b: number = imgData[index + 2] ?? 0;
        const a: number = imgData[index + 3] ?? 0;

        const normalizedHeight: number = strategy(r, g, b, a, maxHeight);
        heightData[y * resolution + x] = Math.max(0, Math.min(1, normalizedHeight));
      }
    }

    return new Terrain({
      ...options,
      heightData,
      heightmapResolution: resolution,
    });
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const v: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];

    const hW: number = this.width / 2.0;
    const hD: number = this.depth / 2.0;

    for (let z: number = 0; z <= this.meshDepthSegments; z++) {
      const vRatio: number = z / this.meshDepthSegments;

      for (let x: number = 0; x <= this.meshWidthSegments; x++) {
        const uRatio: number = x / this.meshWidthSegments;

        const pixelX: number = Math.floor(uRatio * (this.heightmapResolution - 1));
        const pixelY: number = Math.floor(vRatio * (this.heightmapResolution - 1));
        const heightDataIndex: number = pixelY * this.heightmapResolution + pixelX;

        const heightValue: number = this.heightData[heightDataIndex] ?? 0;

        const posX: number = uRatio * this.width - hW;
        const posZ: number = vRatio * this.depth - hD;

        // Centered around Y=0
        const posY: number = heightValue * this.maxHeight - this.maxHeight / 2.0;

        v.push(posX, posY, posZ);
        uv.push(uRatio, 1.0 - vRatio);
      }
    }

    for (let z: number = 0; z < this.meshDepthSegments; z++) {
      for (let x: number = 0; x < this.meshWidthSegments; x++) {
        const a: number = x + (this.meshWidthSegments + 1) * z;
        const b: number = x + (this.meshWidthSegments + 1) * (z + 1);
        const c: number = x + 1 + (this.meshWidthSegments + 1) * (z + 1);
        const d: number = x + 1 + (this.meshWidthSegments + 1) * z;

        idx.push(a, b, d);
        idx.push(b, c, d);
      }
    }

    this._vertices = new Float32Array(v);
    this._uvs = new Float32Array(uv);
    this._indices = this._createIndexArray(idx.length);
    this._indices.set(idx);

    this.computeNormals();
  }

  /**
   * Computes the wireframe indices (line-segments) specifically for Terrain.
   */
  public override computeWireframeIndices(): void {
    const lines: number[] = [];
    for (let z = 0; z <= this.meshDepthSegments; z++) {
      for (let x = 0; x < this.meshWidthSegments; x++) {
        const row = z * (this.meshWidthSegments + 1);
        lines.push(row + x, row + x + 1);
      }
    }
    for (let x = 0; x <= this.meshWidthSegments; x++) {
      for (let z = 0; z < this.meshDepthSegments; z++) {
        const current = z * (this.meshWidthSegments + 1) + x;
        const below = (z + 1) * (this.meshWidthSegments + 1) + x;
        lines.push(current, below);
      }
    }
    this._wireframeIndices = this._createIndexArray(lines.length);
    this._wireframeIndices.set(lines);
  }
}
