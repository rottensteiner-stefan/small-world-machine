import fragGLSL from "./shaders/Terrain.frag.glsl?raw";
import fragGLSL100 from "./shaders/Terrain.frag.glsl100?raw";
import fragWGSL from "./shaders/Terrain.frag.wgsl?raw";
import { AbstractMaterial } from "./AbstractMaterial.js";
import { MaterialType, ShaderPropertyType } from "../../enums/index.js";
import type { Texture } from "../textures/index.js";
import { Color } from "../colors/index.js";
import type { RenderManifest, ShaderDefinition } from "../../renderers/shaders/index.js";
import { StandardWebGPULayout } from "../../renderers/shaders/index.js";

/**
 * Configuration options for terrain material.
 */
export interface TerrainMaterialOptions {
  /** The base color. Defaults to white. */
  color?: Color;
  /** The shininess factor. Defaults to 10. */
  shininess?: number;
  /** Sand biome texture map. Defaults to undefined. */
  sandMap?: Texture | undefined;
  /** Grass biome texture map. Defaults to undefined. */
  grassMap?: Texture | undefined;
  /** Rock biome texture map. Defaults to undefined. */
  rockMap?: Texture | undefined;
  /** Snow biome texture map. Defaults to undefined. */
  snowMap?: Texture | undefined;
  /** Texture repetition factors. Defaults to [20.0, 20.0]. */
  texRepeat?: [number, number];
  /** Thresholds for biome transitions. Defaults to [2.0, 15.0, 25.0, 2.0]. */
  thresholds?: [number, number, number, number];
}

/**
 * Material specifically for terrain rendering with splatmapping.
 */
export class TerrainMaterial extends AbstractMaterial {
  /** The shininess factor. */
  public shininess: number;

  /** Sand biome texture map. */
  public sandMap: Texture | undefined;
  /** Grass biome texture map. */
  public grassMap: Texture | undefined;
  /** Rock biome texture map. */
  public rockMap: Texture | undefined;
  /** Snow biome texture map. */
  public snowMap: Texture | undefined;

  /** Texture repetition factors. */
  public texRepeat: [number, number];

  /** Thresholds for biome transitions: [SandToGrass, GrassToRock, RockToSnow, TransitionSoftness]. */
  public thresholds: [number, number, number, number];

  /**
   * Creates a new TerrainMaterial.
   * @param options The configuration options for the material.
   */
  constructor(options: TerrainMaterialOptions = {}) {
    super(MaterialType.TERRAIN);
    const {
      color = new Color(1, 1, 1, 1),
      shininess = 10,
      sandMap = undefined,
      grassMap = undefined,
      rockMap = undefined,
      snowMap = undefined,
      texRepeat = [20.0, 20.0],
      thresholds = [2.0, 15.0, 25.0, 2.0],
    } = options;

    this.color = Object.isFrozen(color) ? color.clone() : color;
    this.shininess = shininess;
    this.sandMap = sandMap;
    this.grassMap = grassMap;
    this.rockMap = rockMap;
    this.snowMap = snowMap;
    this.texRepeat = texRepeat;
    this.thresholds = thresholds;
  }

  /** @inheritdoc */
  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      this._renderManifest = this._createBaseManifest();
      this._renderManifest.properties["u_specColor"] = new Float32Array([1, 1, 1, 1]);
      this._renderManifest.properties["u_isTerrain"] = 1.0;
      this._renderManifest.textures["u_sandMap"] = this.sandMap;
      this._renderManifest.textures["u_grassMap"] = this.grassMap;
      this._renderManifest.textures["u_rockMap"] = this.rockMap;
      this._renderManifest.textures["u_snowMap"] = this.snowMap;
    }

    this._syncBaseManifestState();

    const props = this._renderManifest.properties as Record<string, unknown>;
    const texs = this._renderManifest.textures as Record<string, unknown>;

    props["u_shininess"] = this.shininess;
    props["u_texRepeat"] = this.texRepeat;
    props["u_thresholds"] = new Float32Array(this.thresholds);

    texs["u_sandMap"] = this.sandMap;
    texs["u_grassMap"] = this.grassMap;
    texs["u_rockMap"] = this.rockMap;
    texs["u_snowMap"] = this.snowMap;

    return this._renderManifest;
  }

  /** @inheritdoc */
  public override getShaderDefinition(): ShaderDefinition {
    return {
      id: this.type,
      sources: {
        glsl300: {
          vs: "[BASE_VERTEX_HEADER][BASE_VERTEX_MAIN]",
          fs: fragGLSL,
        },
        glsl100: {
          vs: "[BASE_VS]",
          fs: fragGLSL100,
        },
        wgsl: `[WGSL_STRUCTS]\n[WGSL_PBR_MATH]\n[WGSL_VS]\n${fragWGSL}`,
      },
      layout: {
        ...StandardWebGPULayout,
        textures: {
          u_sandMap: { type: ShaderPropertyType.TEXTURE },
          u_grassMap: { type: ShaderPropertyType.TEXTURE },
          u_rockMap: { type: ShaderPropertyType.TEXTURE },
          u_snowMap: { type: ShaderPropertyType.TEXTURE },
        },
      },
    };
  }
}
