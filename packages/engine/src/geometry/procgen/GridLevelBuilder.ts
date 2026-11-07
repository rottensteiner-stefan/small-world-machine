import { Object3D } from "../../core/Object3D.js";
import type { Scene } from "../../core/Scene.js";
import { Sprite } from "../../core/sprites/Sprite.js";
import { Vector3D } from "../../math/Vector3D.js";
import { Cube, Ground } from "../index.js";
import type { AbstractMaterial } from "../../core/materials/index.js";
import { StandardMaterial, SpriteMaterial } from "../../core/materials/index.js";
import type { Texture } from "../../core/textures/index.js";

export type GridTileType = "block" | "floor" | "sprite" | "custom";

export interface GridLegendEntry {
  /** The type of tile to generate */
  type: GridTileType;
  /** Primary texture or material */
  texture?: Texture;
  material?: AbstractMaterial;
  /** Ceiling texture/material (for floor type) */
  ceilingTexture?: Texture;
  ceilingMaterial?: AbstractMaterial;
  /** Scale for block/sprite types */
  scale?: number | Vector3D;
  /** Custom Y offset for sprites/blocks */
  offsetY?: number;
  /** If true, the object will not be added to the static octree (e.g. for dynamic elements) */
  isDynamic?: boolean;
  /** Custom builder callback for total control */
  onBuild?: (x: number, y: number, worldX: number, worldZ: number, scene: Scene) => Object3D | void;
  /** If true, the floor and ceiling won't be generated for this tile */
  preventFloorCeiling?: boolean;
  /** Optional generic identification tag applied to the built floor object (e.g. for gameplay hazard checks) */
  tag?: string;
  /** If true, the first tile with this entry (row-major) defines the player spawn returned by `build()` */
  isSpawn?: boolean;
}

export type GridLegend = Record<string, GridLegendEntry>;

export interface GridLevelConfig {
  /** Map of ASCII characters to legend definitions */
  legend: GridLegend;
  /** Default material/texture for floor where no block is defined */
  defaultFloorMaterial?: AbstractMaterial;
  defaultFloorTexture?: Texture;
  /** Default material/texture for ceiling where no block is defined */
  defaultCeilingMaterial?: AbstractMaterial;
  defaultCeilingTexture?: Texture;
  /** Size of each grid cell in world units (default: 2.0) */
  gridSize?: number;
  /** Height of the walls/ceiling (default: 3.0) */
  wallHeight?: number;
}

/**
 * A generalized utility to build 3D levels from ASCII grids.
 */
export class GridLevelBuilder {
  /**
   * Builds a level into the provided scene.
   * @param scene The scene to add objects to.
   * @param mapData The raw ASCII string map.
   * @param config The configuration and legend for mapping characters to 3D.
   * @returns The world position (y = 0) of the first tile whose legend entry has `isSpawn`, or the map center (the origin) if none does.
   */
  public async build(scene: Scene, mapData: string, config: GridLevelConfig): Promise<Vector3D> {
    const lines = mapData
      .split("\n")
      .map((l) => l.trimEnd()) // Don't trimStart, indentation matters for map structure
      .filter((l) => l.length > 0);

    const gridSize = config.gridSize ?? 2.0;
    const wallHeight = config.wallHeight ?? 3.0;
    const depth = lines.length;
    let width = 0;
    for (const line of lines) {
      if (line.length > width) width = line.length;
    }

    const offsetX = (width * gridSize) / 2;
    const offsetZ = (depth * gridSize) / 2;

    const floorGeo = new Ground({ width: gridSize, depth: gridSize }).getGeometryData();
    const blockGeo = new Cube({ size: gridSize }).getGeometryData();

    // Default materials
    const defaultFloorMat =
      config.defaultFloorMaterial ??
      (config.defaultFloorTexture
        ? new StandardMaterial({ diffuseMap: config.defaultFloorTexture })
        : null);
    const defaultCeilingMat =
      config.defaultCeilingMaterial ??
      (config.defaultCeilingTexture
        ? new StandardMaterial({ diffuseMap: config.defaultCeilingTexture })
        : null);

    const playerStart = new Vector3D(0, 0, 0);
    let spawnFound = false;

    for (let y = 0; y < depth; y++) {
      const line = lines[y];
      if (line === undefined) continue;
      for (let x = 0; x < width; x++) {
        if (x >= line.length) continue;
        const char = line[x];
        if (char === undefined) continue;

        const worldX = x * gridSize - offsetX + gridSize / 2;
        const worldZ = y * gridSize - offsetZ + gridSize / 2;

        const entry = config.legend[char];

        if (entry?.isSpawn && !spawnFound) {
          playerStart.set(worldX, 0, worldZ);
          spawnFound = true;
        }

        // Custom builder has full override
        if (entry?.type === "custom" && entry.onBuild) {
          const obj = entry.onBuild(x, y, worldX, worldZ, scene);
          if (obj) {
            scene.add(obj);
          }
          if (entry.preventFloorCeiling) continue;
        }

        // 1. Build Walls / Blocks
        if (entry?.type === "block") {
          const block = new Object3D(`Block_${x}_${y}`);
          block.geometry = blockGeo;
          block.material = entry.material ?? new StandardMaterial({ diffuseMap: entry.texture! });

          const initialY = wallHeight / 2;
          block.position.set(worldX, initialY + (entry.offsetY ?? 0), worldZ);

          if (entry.scale instanceof Vector3D) {
            block.scale.copyFrom(entry.scale);
          } else if (typeof entry.scale === "number") {
            block.scale.set(entry.scale, entry.scale, entry.scale);
          } else {
            block.scale.y = wallHeight / gridSize;
          }

          block.isStatic = !entry.isDynamic;
          block.updateMatrixWorld();
          block.computeBounds();
          scene.add(block);
          continue; // Blocks usually fill the entire vertical space, no floor/ceiling needed
        }

        // 2. Build Floor & Ceiling (For empty spaces or Sprites)
        const floor = new Object3D(`Floor_${x}_${y}`);
        floor.geometry = floorGeo;

        let currentFloorMat = defaultFloorMat;
        if (entry?.type === "floor" && (entry.material || entry.texture)) {
          currentFloorMat = entry.material ?? new StandardMaterial({ diffuseMap: entry.texture! });
        }

        if (currentFloorMat) {
          floor.material = currentFloorMat;
          floor.position.set(worldX, 0, worldZ);
          floor.isStatic = true;
          if (entry?.type === "floor" && entry.tag) {
            floor.tag = entry.tag;
          }
          scene.add(floor);
        }

        // Ceiling
        let currentCeilMat = defaultCeilingMat;
        if (entry?.type === "floor" && (entry.ceilingMaterial || entry.ceilingTexture)) {
          currentCeilMat =
            entry.ceilingMaterial ?? new StandardMaterial({ diffuseMap: entry.ceilingTexture! });
        }

        if (currentCeilMat) {
          const ceil = new Object3D(`Ceiling_${x}_${y}`);
          ceil.geometry = floorGeo;
          ceil.material = currentCeilMat;
          ceil.position.set(worldX, wallHeight, worldZ);
          ceil.rotation.x = Math.PI; // Flip normal down
          ceil.isStatic = true;
          scene.add(ceil);
        }

        // 3. Build Sprites (Billboards)
        if (entry?.type === "sprite" && entry.texture) {
          const sprite = new Sprite(new SpriteMaterial({ texture: entry.texture }));
          sprite.name = `Sprite_${char}_${x}_${y}`;
          sprite.position.set(worldX, entry.offsetY ?? 1.0, worldZ);

          const scale = typeof entry.scale === "number" ? entry.scale : 1.0;
          sprite.scale.set(scale, scale, scale);
          scene.add(sprite);
        }
      }
    }

    return playerStart;
  }
}
