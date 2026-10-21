import type { Scene, EventDispatcherImpl } from "@small-world-machine/engine/core/index.js";
import { Object3D, Sprite, InstancedMesh } from "@small-world-machine/engine/core/index.js";
import { Vector3D, Matrix4 } from "@small-world-machine/engine/math/index.js";
import { Cube, Sphere } from "@small-world-machine/engine/geometry/index.js";
import {
  StandardMaterial,
  FluidSurfaceMaterial,
  SpriteMaterial,
} from "@small-world-machine/engine/core/materials/index.js";
import { PointLight } from "@small-world-machine/engine/core/lights/index.js";
import { Color } from "@small-world-machine/engine/core/colors/index.js";
import type { Texture } from "@small-world-machine/engine/core/textures/index.js";
import { TextureArray } from "@small-world-machine/engine/core/textures/index.js";
import { CullMode, TextureFilter, TextureWrap } from "@small-world-machine/engine/enums/index.js";
import type { CameraInterfaceData } from "@small-world-machine/engine/interfaces/index.js";
import {
  ProximitySensorBehavior,
  BobbingBehavior,
} from "@small-world-machine/engine/core/behaviors/index.js";
import type { GridLegend } from "@small-world-machine/engine/geometry/procgen/GridLevelBuilder.js";
import { GridLevelBuilder } from "@small-world-machine/engine/geometry/procgen/GridLevelBuilder.js";
import type { AudioSystem } from "@small-world-machine/engine/audio/index.js";
import { EnemyBehavior } from "./behaviors/EnemyBehavior.js";
import {
  BoundingBox,
  SpatialHash,
  StaticCollider,
} from "@small-world-machine/engine/physix/index.js";
import { ObjectTags } from "../enums/ObjectTags.js";
import { Events } from "../Events.js";

/** How close the player needs to be (in world units) to pick up an item. */
const PICKUP_RADIUS = 1.5;
export type YadTileType =
  "wall" | "door" | "sprite" | "column" | "lavaBall" | "playerSpawn" | "floor";

export interface YadLegendEntry {
  type: YadTileType;
  /** Primary texture */
  texture?: Texture;
  /** Ceiling texture (for floor type) */
  ceilingTexture?: Texture;
  /** Add a point light? */
  lightColor?: Color;
  lightIntensity?: number;
  /** Sprite specific settings */
  spriteScale?: number;
  spriteY?: number;
  bobbing?: boolean;
  isEnemy?: boolean;
  isItem?: boolean;
  itemType?: string;
  /** Wall/Door specific settings */
  doorSpeed?: number;
  doorSound?: string;
}

export type YadLegend = Record<string, YadLegendEntry>;

export interface YadLevelConfig {
  legend: YadLegend;
  floorTexture?: Texture;
  ceilingTexture?: Texture;
  lavaNoiseMap?: Texture;
  lavaNormalMap?: Texture;
  lavaFloorChars?: string[];
  slimeFloorChars?: string[];
  playerCamera?: CameraInterfaceData;
  audio?: AudioSystem | undefined;
  /** Event bus item pickups are dispatched on. Without it, items can still be walked over but won't fire `Events.PICKUP`. */
  events?: EventDispatcherImpl;
}

/**
 * LevelBuilder now wraps the generic GridLevelBuilder.
 */
export class LevelBuilder {
  private _gridSize: number = 2.0;
  private _wallHeight: number = 3.0;

  public async build(
    scene: Scene,
    mapData: string,
    config: YadLevelConfig,
  ): Promise<{
    playerStart: Vector3D;
    lavaMaterials: FluidSurfaceMaterial[];
    lavaLights: PointLight[];
  }> {
    const lavaMaterials: FluidSurfaceMaterial[] = [];
    const lavaLights: PointLight[] = [];

    const lavaMat = new FluidSurfaceMaterial({
      noiseMap: config.lavaNoiseMap,
      normalMap: config.lavaNormalMap,
      color: new Color(1.5, 0.5, 0.0),
      edgeColor: new Color(0.1, 0.05, 0.05),
      flowSpeed: 0.3,
      distortion: 2.0,
      viscosity: 5.0,
    });
    lavaMat.cullMode = CullMode.NONE;
    lavaMaterials.push(lavaMat);

    const wallGeo = new Cube({ size: this._gridSize }).getGeometryData();
    const sphereGeo = new Sphere({ radius: 0.6 }).getGeometryData();

    const wallPositions: { x: number; y: number; z: number; texIndex: number }[] = [];
    const wallTextures: Texture[] = [];
    const charToTexIndex: Record<string, number> = {};

    // First pass to register wall textures for the array
    for (const [char, entry] of Object.entries(config.legend)) {
      if (entry.type === "wall" && entry.texture && entry.texture.image) {
        charToTexIndex[char] = wallTextures.length;
        wallTextures.push(entry.texture);
      }
    }

    // Convert YadLegend to GridLegend
    const gridLegend: GridLegend = {};
    for (const [char, entry] of Object.entries(config.legend)) {
      if (entry.type === "wall") {
        gridLegend[char] = {
          type: "custom",
          preventFloorCeiling: true,
          onBuild: (
            _x: number,
            _y: number,
            worldX: number,
            worldZ: number,
          ): Object3D | undefined => {
            const tIdx = charToTexIndex[char] ?? 0;
            wallPositions.push({ x: worldX, y: this._wallHeight / 2, z: worldZ, texIndex: tIdx });
            return undefined;
          },
        };
      } else if (entry.type === "floor") {
        gridLegend[char] = {
          type: "floor",
          ...(entry.texture && { texture: entry.texture }),
          ...(entry.ceilingTexture && { ceilingTexture: entry.ceilingTexture }),
        };
      } else if (entry.type === "door") {
        gridLegend[char] = {
          type: "custom",
          onBuild: (x, y, worldX, worldZ): Object3D | undefined => {
            const block = new Object3D(`Door_${x}_${y}`);
            block.tag = ObjectTags.DOOR;
            block.geometry = wallGeo;
            block.material = new StandardMaterial({ diffuseMap: entry.texture });

            const initialY = this._wallHeight / 2;
            block.position.set(worldX, initialY, worldZ);
            block.scale.y = this._wallHeight / this._gridSize;
            block.isStatic = false;
            block.updateMatrixWorld();
            block.computeBounds();

            if (config.playerCamera) {
              let isOpen = false;
              const dSound = entry.doorSound ?? "door";
              block.addBehavior(
                new ProximitySensorBehavior({
                  targetObj: config.playerCamera,
                  radius: 4.0,
                  minDistance: 0.0,
                  onUpdate: (_factor, distance, deltaTime): void => {
                    if (distance <= 3.5 && !isOpen) {
                      isOpen = true;
                      if (config.audio) {
                        config.audio.playSpatial(dSound, block.position, false, 0.8, 3.0, 30.0);
                      }
                    } else if (distance >= 4.5 && isOpen) {
                      isOpen = false;
                      if (config.audio) {
                        config.audio.playSpatial(dSound, block.position, false, 0.8, 3.0, 30.0);
                      }
                    }
                    const targetY = isOpen ? initialY + this._wallHeight : initialY;
                    block.position.y += (targetY - block.position.y) * 5.0 * deltaTime;
                    block.updateMatrixWorld();
                    block.computeBounds();
                  },
                }),
              );
            }
            return block; // The grid builder will add this to the scene
          },
        };
      } else if (entry.type === "sprite") {
        gridLegend[char] = {
          type: "custom",
          onBuild: (x, y, worldX, worldZ, sceneRef): Object3D | undefined => {
            const sprite = new Sprite(new SpriteMaterial({ texture: entry.texture }));
            let spriteName = `Sprite_${x}_${y}`;
            if (entry.isEnemy) {
              spriteName = `Enemy_${x}_${y}`;
              sprite.tag = ObjectTags.ENEMY;
            }
            if (entry.isItem) {
              spriteName = `Item_${entry.itemType ?? "unknown"}_${x}_${y}`;
              sprite.tag = ObjectTags.ITEM;
            }
            sprite.name = spriteName;
            const itemType = entry.itemType ?? "unknown";
            sprite.position.set(worldX, entry.spriteY ?? 1.0, worldZ);
            const scale = entry.spriteScale ?? 1.0;
            sprite.scale.set(scale, scale, scale);

            if (entry.bobbing) {
              sprite.addBehavior(new BobbingBehavior(0.1, 1.5));
            }
            if (entry.isEnemy && config.playerCamera) {
              sprite.addBehavior(
                new EnemyBehavior({
                  player: config.playerCamera!,
                  scene: sceneRef,
                  audio: config.audio,
                  speed: 6.0,
                  detectionRange: 30.0,
                }),
              );
            }

            if (entry.isItem && config.playerCamera) {
              sprite.addBehavior(
                new ProximitySensorBehavior({
                  targetObj: config.playerCamera,
                  radius: PICKUP_RADIUS,
                  planar: true,
                  onUpdate: (_factor, distance): void => {
                    if (distance > PICKUP_RADIUS || !sprite.isVisible) return;
                    sprite.isVisible = false;
                    if (config.audio) config.audio.play("pickup", false, 0.8);
                    if (config.events) {
                      config.events.dispatchEvent(Events.PICKUP, { type: itemType, amount: 20 });
                    }
                  },
                }),
              );
            }

            if (entry.lightColor) {
              const light = new PointLight({
                color: entry.lightColor,
                intensity: entry.lightIntensity ?? 3.0,
                distance: 8,
              });
              light.position.set(worldX, (entry.spriteY ?? 1.0) + 0.3, worldZ);
              sceneRef.add(light);

              if (config.audio) {
                config.audio.startFire(light.position, 0.4);
              }
            }
            return sprite;
          },
        };
      } else if (entry.type === "column") {
        gridLegend[char] = {
          type: "custom",
          onBuild: (x, y, worldX, worldZ): Object3D | undefined => {
            const col = new Object3D(`Column_${x}_${y}`);
            col.geometry = new Cube({ size: 1 }).getGeometryData();
            col.material = new StandardMaterial({ diffuseMap: entry.texture });
            col.position.set(worldX, this._wallHeight / 2, worldZ);
            col.scale.set(0.5, this._wallHeight / this._gridSize, 0.5);
            col.isStatic = true;
            col.updateMatrixWorld();
            col.computeBounds();
            return col;
          },
        };
      } else if (entry.type === "lavaBall") {
        gridLegend[char] = {
          type: "custom",
          onBuild: (x, y, worldX, worldZ, sceneRef): Object3D | undefined => {
            const lavaBall = new Object3D(`LavaBall_${x}_${y}`);
            lavaBall.geometry = sphereGeo;
            const ballMat = new FluidSurfaceMaterial({
              noiseMap: config.lavaNoiseMap,
              color: new Color(2.0, 0.8, 0.0),
              edgeColor: new Color(0.1, 0.05, 0.05),
              flowSpeed: 1.5,
              distortion: 2.0,
              viscosity: 5.0,
            });
            lavaMaterials.push(ballMat);
            lavaBall.material = ballMat;
            lavaBall.position.set(worldX, 1.5, worldZ);

            const light = new PointLight({
              color: new Color(1.0, 0.4, 0.0),
              intensity: 4.0,
              distance: 10,
            });
            light.position.set(worldX, 1.5, worldZ);
            sceneRef.add(light);
            lavaLights.push(light);

            return lavaBall;
          },
        };
      } else if (entry.type === "playerSpawn") {
        gridLegend[char] = { type: "floor", isSpawn: true };
      }
    }

    // Apply material and tag overrides for lava and slime floor tiles
    for (const char of Object.keys(config.legend)) {
      if (config.lavaFloorChars?.includes(char) && gridLegend[char]) {
        gridLegend[char]!.material = lavaMat;
        gridLegend[char]!.tag = ObjectTags.LAVA;
      } else if (config.slimeFloorChars?.includes(char) && gridLegend[char]) {
        gridLegend[char]!.tag = ObjectTags.SLIME;
      }
    }

    const gridBuilder = new GridLevelBuilder();
    const spawn = await gridBuilder.build(scene, mapData, {
      legend: gridLegend,
      ...(config.floorTexture && { defaultFloorTexture: config.floorTexture }),
      ...(config.ceilingTexture
        ? { defaultCeilingTexture: config.ceilingTexture }
        : config.floorTexture
          ? { defaultCeilingTexture: config.floorTexture }
          : {}),
      gridSize: this._gridSize,
      wallHeight: this._wallHeight,
    });

    if (wallPositions.length > 0 && wallTextures.length > 0) {
      const texArray = TextureArray.fromImages(
        wallTextures.map((t) => t.image as HTMLImageElement),
        {
          magFilter: TextureFilter.NEAREST,
          minFilter: TextureFilter.NEAREST,
          addressModeU: TextureWrap.REPEAT,
          addressModeV: TextureWrap.REPEAT,
        },
      );
      const wallMat = new StandardMaterial({ diffuseMap: texArray });
      const wallInstanced = new InstancedMesh(
        "InstancedWalls",
        wallGeo,
        wallMat,
        wallPositions.length,
      );
      wallInstanced.initInstanceData(4);

      for (let i = 0; i < wallPositions.length; i++) {
        const pos = wallPositions[i]!;
        const mat4 = new Matrix4();
        mat4.compose(
          new Vector3D(pos.x, pos.y, pos.z),
          new Vector3D(0, 0, 0),
          new Vector3D(1, this._wallHeight / this._gridSize, 1),
        );
        wallInstanced.setMatrixAt(i, mat4);
        wallInstanced.setInstanceDataAt(i, [pos.texIndex, 0, 0, 0]);

        // Add a hidden collider for physics
        if (!scene.spatialHash) {
          scene.spatialHash = new SpatialHash(this._gridSize);
        }

        const bounds = new BoundingBox(
          new Vector3D(pos.x - this._gridSize / 2, 0, pos.z - this._gridSize / 2),
          new Vector3D(pos.x + this._gridSize / 2, this._wallHeight, pos.z + this._gridSize / 2),
        );
        const collider = new StaticCollider(bounds);
        scene.spatialHash.insert(collider);
        scene.staticColliders.push(collider);
      }
      wallInstanced.isStatic = true;
      wallInstanced.frustumCulled = false;
      wallInstanced.updateMatrixWorld();
      wallInstanced.computeBounds();
      scene.add(wallInstanced);
    }

    const playerStart = new Vector3D(spawn.x, 1.0, spawn.z);

    return { playerStart, lavaMaterials, lavaLights };
  }
}
