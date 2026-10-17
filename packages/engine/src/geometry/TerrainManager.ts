import { Terrain } from "./Terrain.js";
import type { Scene } from "../core/index.js";
import { Object3D } from "../core/index.js";
import { TerrainMaterial } from "../core/materials/index.js";
import { Texture } from "../core/textures/index.js";
import type { Vector3D } from "../math/index.js";
import { HeightmapGenerator, TextureGenerator } from "../utils/index.js";

/**
 * Algorithm types for procedural terrain generation.
 */
export type TerrainAlgorithm = "DiamondSquare" | "Perlin" | "Simplex";

/**
 * Configuration for the TerrainManager.
 */
export interface TerrainManagerConfig {
  /** Size of a single terrain chunk in world units. Defaults to 80. */
  chunkSize?: number;
  /** Resolution of the mesh subdivisions per chunk. Defaults to 64. */
  meshSegments?: number;
  /** Detail level for the heightmap (2^n + 1). Defaults to 7 (129x129). */
  heightmapDetail?: number;
  /** Roughness factor for the DiamondSquare algorithm. Defaults to 0.55. */
  heightmapRoughness?: number;
  /** Maximum height of the terrain. Defaults to 6.0. */
  maxHeight?: number;
  /** Number of chunks in the active grid (edge length). Defaults to 3 (3x3). */
  gridSize?: number;
  /** Material to use for all terrain chunks. */
  material?: TerrainMaterial;
  /** Generation algorithm to use. Defaults to "Perlin". */
  algorithm?: TerrainAlgorithm;
  /** Callback triggered when chunks are added or removed. */
  onRebuild?: () => void;
}

/**
 * Manages dynamic loading and unloading of terrain chunks to create an "infinite" terrain feel.
 * Chunks are loaded around a specific focus point (usually the player).
 */
export class TerrainManager {
  private _scene: Scene;
  private readonly _chunkSize: number;
  private readonly _meshSegments: number;
  private readonly _heightmapDetail: number;
  private readonly _heightmapRoughness: number;
  private readonly _maxHeight: number;
  private readonly _gridSize: number;
  private readonly _halfGrid: number;
  private readonly _algorithm: TerrainAlgorithm;
  private readonly _onRebuild: (() => void) | undefined;

  private _chunks: Map<string, Object3D> = new Map<string, Object3D>();
  private _currentGridX: number = 0;
  private _currentGridZ: number = 0;

  private readonly _terrainMaterial: TerrainMaterial;

  /**
   * Creates a new TerrainManager.
   * @param scene The scene where chunks will be added/removed.
   * @param config The manager configuration.
   */
  constructor(scene: Scene, config: TerrainManagerConfig = {}) {
    this._scene = scene;
    this._chunkSize = config.chunkSize ?? 80;
    this._meshSegments = config.meshSegments ?? 64;
    this._heightmapDetail = config.heightmapDetail ?? 7;
    this._heightmapRoughness = config.heightmapRoughness ?? 0.55;
    this._maxHeight = config.maxHeight ?? 6.0;
    this._gridSize = config.gridSize ?? 3;
    this._halfGrid = Math.floor(this._gridSize / 2);
    this._algorithm = config.algorithm ?? "Perlin";
    this._onRebuild = config.onRebuild;

    this._terrainMaterial = config.material ?? new TerrainMaterial();
  }

  /**
   * Initializes the manager and generates the initial grid of chunks.
   * Also ensures default biome textures are loaded if missing.
   */
  public async init(): Promise<void> {
    if (undefined === this._terrainMaterial.sandMap) {
      this._terrainMaterial.sandMap = Texture.fromImage(await TextureGenerator.createSand());
    }
    if (undefined === this._terrainMaterial.grassMap) {
      this._terrainMaterial.grassMap = Texture.fromImage(await TextureGenerator.createGrass());
    }
    if (undefined === this._terrainMaterial.rockMap) {
      this._terrainMaterial.rockMap = Texture.fromImage(await TextureGenerator.createRock());
    }
    if (undefined === this._terrainMaterial.snowMap) {
      this._terrainMaterial.snowMap = Texture.fromImage(await TextureGenerator.createSnow());
    }
    this._terrainMaterial.texRepeat = [this._chunkSize / 4.0, this._chunkSize / 4.0];
    this._terrainMaterial.thresholds = [-2.0, 0.0, 2.0, 1.0];

    for (let z: number = -this._halfGrid; z <= this._halfGrid; z++) {
      for (let x: number = -this._halfGrid; x <= this._halfGrid; x++) {
        await this._generateChunk(x, z);
      }
    }

    this._onRebuild?.();
  }

  /**
   * Updates the terrain grid based on a focus point (e.g. player position).
   * Triggers rebuilding of the grid if the focus point moves to a new chunk.
   * @param focusPoint The current focus position.
   */
  public async update(focusPoint: Vector3D): Promise<void> {
    const newGridX: number = Math.floor(focusPoint.x / this._chunkSize);
    const newGridZ: number = Math.floor(focusPoint.z / this._chunkSize);

    if (this._currentGridX !== newGridX || this._currentGridZ !== newGridZ) {
      this._currentGridX = newGridX;
      this._currentGridZ = newGridZ;
      await this._rebuildGrid();
    }
  }

  /**
   * Rebuilds the grid by calculating which chunks should be visible.
   * Reuses existing chunks and removes ones that are too far away.
   * @private
   */
  private async _rebuildGrid(): Promise<void> {
    const newChunks: Map<string, Object3D> = new Map<string, Object3D>();
    const chunksToRemove: Set<string> = new Set(this._chunks.keys());
    let changed: boolean = false;

    for (let z: number = -this._halfGrid; z <= this._halfGrid; z++) {
      for (let x: number = -this._halfGrid; x <= this._halfGrid; x++) {
        const gridX: number = this._currentGridX + x;
        const gridZ: number = this._currentGridZ + z;
        const key: string = this._getChunkKey(gridX, gridZ);

        const existingChunk: Object3D | undefined = this._chunks.get(key);
        if (undefined !== existingChunk) {
          newChunks.set(key, existingChunk);
          chunksToRemove.delete(key);
        } else {
          const chunk: Object3D = await this._generateChunkObject(gridX, gridZ);
          newChunks.set(key, chunk);
          this._scene.add(chunk);
          changed = true;
        }
      }
    }

    for (const key of chunksToRemove) {
      const chunk: Object3D | undefined = this._chunks.get(key);
      if (undefined !== chunk) {
        this._scene.remove(chunk);
        changed = true;
      }
    }
    this._chunks = newChunks;

    if (changed) {
      this._onRebuild?.();
    }
  }

  /**
   * Internal helper to generate and add a single chunk.
   */
  private async _generateChunk(gridX: number, gridZ: number): Promise<void> {
    const key: string = this._getChunkKey(gridX, gridZ);
    if (this._chunks.has(key)) {
      return;
    }

    const chunk: Object3D = await this._generateChunkObject(gridX, gridZ);
    this._scene.add(chunk);
    this._chunks.set(key, chunk);
  }

  /**
   * Generates a single chunk Object3D including geometry.
   */
  private async _generateChunkObject(gridX: number, gridZ: number): Promise<Object3D> {
    const key: string = this._getChunkKey(gridX, gridZ);
    const heightmapResolution: number = Math.pow(2, this._heightmapDetail) + 1;

    let heightmapData: Float32Array;

    if ("Perlin" === this._algorithm || "Simplex" === this._algorithm) {
      const pixelOffset: number = heightmapResolution - 1;
      const offsetX: number = gridX * pixelOffset;
      const offsetY: number = gridZ * pixelOffset;
      const noiseScale: number = 0.015;

      if ("Perlin" === this._algorithm) {
        heightmapData = await HeightmapGenerator.generatePerlinFloat(
          this._heightmapDetail,
          noiseScale,
          offsetX,
          offsetY,
          4,
          0.5,
        );
      } else {
        heightmapData = await HeightmapGenerator.generateSimplexFloat(
          this._heightmapDetail,
          noiseScale,
          offsetX,
          offsetY,
          4,
          0.5,
        );
      }
    } else {
      const seed: string = `${gridX},${gridZ}`;
      heightmapData = await HeightmapGenerator.generateDiamondSquareFloat(
        this._heightmapDetail,
        this._heightmapRoughness,
        seed,
      );
    }

    const terrainGeo: Terrain = Terrain.fromHeightData({
      heightData: heightmapData,
      heightmapResolution,
      width: this._chunkSize,
      depth: this._chunkSize,
      maxHeight: this._maxHeight,
      meshWidthSegments: this._meshSegments,
      meshDepthSegments: this._meshSegments,
    });

    const terrainObj: Object3D = new Object3D(`TerrainChunk_${key}`);
    terrainObj.geometry = terrainGeo.getGeometryData();
    terrainObj.material = this._terrainMaterial;
    terrainObj.isStatic = true; // Optimization: Terrain does not move

    terrainObj.position.set(gridX * this._chunkSize, 0, gridZ * this._chunkSize);

    return terrainObj;
  }

  /**
   * Generates a unique key for a chunk coordinate.
   */
  private _getChunkKey(gridX: number, gridZ: number): string {
    return `${gridX}_${gridZ}`;
  }
}
