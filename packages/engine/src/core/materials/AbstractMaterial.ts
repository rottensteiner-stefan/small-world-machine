import { Color } from "../colors/index.js";
import type { MaterialType } from "../../enums/index.js";
import { CullMode } from "../../enums/index.js";
import type { RenderManifest, ShaderDefinition } from "../../renderers/shaders/index.js";
import { registerMaterialShaderProvider } from "../../renderers/shaders/index.js";
import type { ShaderProvider } from "../../interfaces/index.js";
import { MathUtils } from "../../math/index.js";
import type { InspectorField } from "../Inspectable.js";
import { shallowCloneWithValueTypes } from "../CloneUtils.js";

/**
 * Base class for all material types.
 */
export abstract class AbstractMaterial implements ShaderProvider {
  /** Fields common to every material, merged with a concrete subclass's own `inspector` map
   * (e.g. `StandardMaterial`'s metallic/roughness) via `collectInspectorSchema()`. */
  public static readonly inspector: Record<string, InspectorField> = {
    color: { type: "color", label: "Color" },
    transparent: { type: "boolean", label: "Transparent" },
    depthTest: { type: "boolean", label: "Depth Test", row: "depth" },
    depthWrite: { type: "boolean", label: "Depth Write", row: "depth" },
  };

  /** The unique identifier of the material. */
  public uuid: string = MathUtils.generateUUID();
  /** The base color of the material. */
  public color: Color = new Color(1, 1, 1);

  /** The culling mode for this material. Defaults to BACK. */
  public cullMode: CullMode = CullMode.DEFAULT;

  /** Whether the material writes to the depth buffer. Defaults to true. */
  public depthWrite: boolean = true;
  /** Whether the material performs depth testing. Defaults to true. */
  public depthTest: boolean = true;
  /** Whether the material is transparent. Defaults to false. */
  public transparent: boolean = false;

  /** Cached render manifest to avoid frequent allocations. */
  protected _renderManifest: RenderManifest | undefined = undefined;

  /**
   * Creates a new material and automatically registers it with the ShaderRegistry.
   * @param type The type of the material.
   */
  protected constructor(public readonly type: MaterialType | string) {
    // Self-registration: The moment a material is instantiated,
    // the engine knows how to handle its shader.
    registerMaterialShaderProvider(this.type, this);
  }

  /**
   * Returns an independent copy of this material (own `uuid`, own `color`/other value-type
   * fields) -- geometry-adjacent references like texture maps stay shared, since texture data is
   * immutable. Used by `Object3D.clone()` (Maker's Duplicate command) so a duplicated object's
   * material edits don't leak back onto the original.
   */
  public clone(): AbstractMaterial {
    return shallowCloneWithValueTypes(this);
  }

  /**
   * Returns a manifest describing the requirements for rendering this material.
   * @returns The render manifest.
   */
  public abstract getRenderManifest(): RenderManifest;

  /** @inheritdoc */
  public abstract getShaderDefinition(): ShaderDefinition;

  /**
   * Helper to create a fully-populated base RenderManifest layout.
   */
  protected _createBaseManifest(): RenderManifest {
    return {
      shaderId: this.type,
      properties: {
        u_color: this.color.toFloat32Array(),
        u_specColor: new Float32Array([0, 0, 0, 1]),
        u_texOffset: [0, 0],
        u_texRepeat: [1, 1],
        u_shininess: 32.0,
        u_isTerrain: 0.0,
        u_metallic: 0.0,
        u_roughness: 0.5,
        u_extraParams: [1.0, 0.0, 1.0, 1.0], // ao, alphaTest, normalScaleX, normalScaleY
        u_liquidParams: [0.0, 0.0, 0.0, 0.0],
        u_thresholds: [0.0, 0.0, 0.0, 0.0],
        u_useEnvMap: 0.0,
        u_useReflectionMap: 0.0,
        u_reflectivity: 1.0,
        u_time: 0.0,
      },
      textures: {
        u_diffuseMap: undefined,
        u_normalMap: undefined,
        u_metallicMap: undefined,
        u_roughnessMap: undefined,
        u_emissiveMap: undefined,
        u_alphaMap: undefined,
        u_skybox: undefined,
        u_reflectionMap: undefined,
      },
      state: {
        culling: this.cullMode,
        depthWrite: this.depthWrite,
        depthTest: this.depthTest,
        transparent: this.transparent,
      },
    };
  }

  /**
   * Helper to synchronize the base material state (color, culling, etc.) without allocating new objects.
   */
  protected _syncBaseManifestState(): void {
    if (!this._renderManifest) return;
    this._renderManifest.properties["u_color"] = this.color.toFloat32Array();
    if (!this._renderManifest.state) {
      this._renderManifest.state = {};
    }
    this._renderManifest.state.culling = this.cullMode;
    this._renderManifest.state.depthWrite = this.depthWrite;
    this._renderManifest.state.depthTest = this.depthTest;
    this._renderManifest.state.transparent = this.transparent;
  }

  /**
   * Helper to synchronize texture offset and repeat from a given texture.
   */
  protected _syncTexOffsetRepeat(
    tex: { offset: { x: number; y: number }; repeat: { x: number; y: number } } | undefined,
  ): void {
    if (!this._renderManifest) return;
    const props = this._renderManifest.properties;
    if (tex) {
      (props["u_texOffset"] as number[])[0] = tex.offset.x;
      (props["u_texOffset"] as number[])[1] = tex.offset.y;
      (props["u_texRepeat"] as number[])[0] = tex.repeat.x;
      (props["u_texRepeat"] as number[])[1] = tex.repeat.y;
    } else {
      (props["u_texOffset"] as number[])[0] = 0;
      (props["u_texOffset"] as number[])[1] = 0;
      (props["u_texRepeat"] as number[])[0] = 1;
      (props["u_texRepeat"] as number[])[1] = 1;
    }
  }
}
