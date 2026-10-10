import fragGLSL from "./shaders/Sprite.frag.glsl?raw";
import fragGLSL100 from "./shaders/Sprite.frag.glsl100?raw";
import fragWGSL from "./shaders/Sprite.frag.wgsl?raw";
import { AbstractMaterial } from "./AbstractMaterial.js";
import { Color } from "../colors/index.js";
import { MaterialType, BlendingMode, ShaderPropertyType, CullMode } from "../../enums/index.js";
import { Texture } from "../textures/index.js";
import {
  RenderManifest,
  ShaderDefinition,
  StandardWebGPULayout,
} from "../../renderers/shaders/index.js";

/**
 * Configuration options for SpriteMaterial.
 */
export interface SpriteMaterialOptions {
  /** The texture to display on the sprite. */
  texture?: Texture | undefined;
  /** The tint color of the sprite. */
  color?: Color | undefined;
  /** Whether the sprite is transparent. Defaults to true. */
  transparent?: boolean | undefined;
}

/**
 * Material for rendering 2D sprites.
 */
export class SpriteMaterial extends AbstractMaterial {
  /** The texture to display on the sprite. */
  public texture: Texture | undefined = undefined;

  /** Whether the sprite is transparent. Defaults to true. */
  public override transparent: boolean = true;

  /**
   * Creates a new SpriteMaterial.
   * @param options The texture for the sprite or a configuration object.
   */
  constructor(options?: Texture | SpriteMaterialOptions) {
    super(MaterialType.SPRITE);
    if (options instanceof Texture) {
      this.texture = options;
    } else if (options) {
      this.texture = options.texture;
      if (options.color) {
        this.color = options.color;
      }
      if (options.transparent !== undefined) {
        this.transparent = options.transparent;
      }
    }
  }

  /** @inheritdoc */
  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      this._renderManifest = {
        shaderId: this.type,
        properties: {
          u_color: this.color.toFloat32Array(),
          u_specColor: new Float32Array([1, 1, 1, 1]),
          u_texOffset: [0, 0],
          u_texRepeat: [1, 1],
          u_shininess: 32.0,
          u_isTerrain: 0.0,
          u_metallic: 0.0,
          u_roughness: 0.5,
          u_extraParams: [1.0, 0, 0, 0],
          u_liquidParams: [0, 0, 0, 0],
          u_thresholds: [0, 0, 0, 0],
        },
        textures: {
          u_diffuseMap: this.texture,
        },
        state: {
          transparent: this.transparent,
          blending: this.transparent ? BlendingMode.ALPHA : BlendingMode.OPAQUE,
          depthWrite: !this.transparent,
          isSprite: true,
          // Sprites do their own billboarding in the vertex shader, which the shared GPU depth
          // pre-pass pipeline cannot reproduce -- and semi-transparent sprites shouldn't write
          // solid depth for the pre-pass anyway. Kept out via skipDepthPrePass (not shaderId).
          skipDepthPrePass: true,
          culling: CullMode.NONE,
        },
      };
    }

    const props = this._renderManifest.properties as Record<string, unknown>;
    const texs = this._renderManifest.textures as Record<string, unknown>;
    const state = this._renderManifest.state!;

    props["u_color"] = this.color.toFloat32Array();

    if (this.texture) {
      (props["u_texOffset"] as number[])[0] = this.texture.offset.x;
      (props["u_texOffset"] as number[])[1] = this.texture.offset.y;
      (props["u_texRepeat"] as number[])[0] = this.texture.repeat.x;
      (props["u_texRepeat"] as number[])[1] = this.texture.repeat.y;
    } else {
      (props["u_texOffset"] as number[])[0] = 0;
      (props["u_texOffset"] as number[])[1] = 0;
      (props["u_texRepeat"] as number[])[0] = 1;
      (props["u_texRepeat"] as number[])[1] = 1;
    }

    texs["u_diffuseMap"] = this.texture;

    state.transparent = this.transparent;
    state.blending = this.transparent ? BlendingMode.ALPHA : BlendingMode.OPAQUE;
    state.depthWrite = !this.transparent;
    state.isSprite = true;
    state.culling = CullMode.NONE;

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
        wgsl: `[WGSL_STRUCTS]\n[WGSL_VS]\n${fragWGSL}`,
      },
      layout: {
        ...StandardWebGPULayout,
        textures: { u_diffuseMap: { type: ShaderPropertyType.TEXTURE } },
      },
    };
  }
}
