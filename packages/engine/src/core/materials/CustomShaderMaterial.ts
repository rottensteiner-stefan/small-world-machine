import { AbstractMaterial } from "./AbstractMaterial.js";
import { CullMode, BlendingMode, ShaderPropertyType } from "../../enums/index.js";
import { MathUtils } from "../../math/index.js";
import type { Texture, CubeTexture } from "../textures/index.js";
import type {
  RenderManifest,
  ShaderDefinition,
  ShaderLayout,
} from "../../renderers/shaders/index.js";

export interface CustomShaderMaterialOptions {
  /** Shader sources for different APIs. Provide at least one matching the active renderer. */
  sources: {
    wgsl?: string;
    glsl300?: { vs: string; fs: string };
    glsl100?: { vs: string; fs: string };
  };
  /** The uniform and texture layout expected by this custom shader. */
  layout: ShaderLayout;
  /** Initial uniform property values mapped to names defined in the layout. */
  properties?: Record<string, unknown>;
  /** Initial textures mapped to names defined in the layout. */
  textures?: Record<string, Texture | CubeTexture | undefined>;

  /** Whether the material is transparent. Defaults to false. */
  transparent?: boolean;
  /** The culling mode. Defaults to BACK. */
  cullMode?: CullMode;
  /** Whether the material writes to the depth buffer. Defaults to true. */
  depthWrite?: boolean;
  /** Whether the material performs depth testing. Defaults to true. */
  depthTest?: boolean;
}

/**
 * A highly flexible material that allows developers to write entirely custom
 * shader code (WGSL and GLSL) without modifying the core engine chunks.
 * Perfect for very specific visual effects.
 */
export class CustomShaderMaterial extends AbstractMaterial {
  public sources: CustomShaderMaterialOptions["sources"];
  public layout: ShaderLayout;

  public properties: Record<string, unknown>;
  public textures: Record<string, Texture | CubeTexture | undefined>;

  private readonly _textureFlags: string[] = [];
  private readonly _textureFlagByKey: Map<string, string | undefined> = new Map();

  constructor(options: CustomShaderMaterialOptions) {
    // We generate a unique MaterialType ID for this custom shader
    // so the ShaderRegistry does not overwrite other CustomShaderMaterials.
    super("CustomShaderMaterial_" + MathUtils.generateUUID());

    this.sources = options.sources;
    this.layout = options.layout;
    this.properties = options.properties ?? {};
    this.textures = options.textures ?? {};

    this.transparent = options.transparent ?? false;
    this.cullMode = options.cullMode ?? CullMode.DEFAULT;
    this.depthWrite = options.depthWrite ?? true;
    this.depthTest = options.depthTest ?? true;

    // Safety Net: Inject default base uniforms if missing,
    // as they are required by core vertex chunks like [BASE_VERTEX_HEADER]
    if (undefined === this.properties["u_texRepeat"]) {
      this.properties["u_texRepeat"] = [1.0, 1.0];
      if (this.layout.uniforms) {
        this.layout.uniforms["u_texRepeat"] = { type: ShaderPropertyType.VEC2 };
      }
      if (this.layout.uniformLayout && !this.layout.uniformLayout.includes("u_texRepeat")) {
        this.layout.uniformLayout.push("u_texRepeat");
      }
    }

    if (undefined === this.properties["u_texOffset"]) {
      this.properties["u_texOffset"] = [0.0, 0.0];
      if (this.layout.uniforms) {
        this.layout.uniforms["u_texOffset"] = { type: ShaderPropertyType.VEC2 };
      }
      if (this.layout.uniformLayout && !this.layout.uniformLayout.includes("u_texOffset")) {
        this.layout.uniformLayout.push("u_texOffset");
      }
    }
  }

  /**
   * Helper to set a uniform property dynamically.
   */
  public setProperty(name: string, value: unknown): void {
    this.properties[name] = value;
  }

  /**
   * Helper to set a texture dynamically.
   */
  public setTexture(name: string, texture: Texture | CubeTexture | undefined): void {
    this.textures[name] = texture;
  }

  /** @inheritdoc */
  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      this._renderManifest = {
        shaderId: this.type,
        properties: {},
        textures: {},
        state: {
          depthTest: this.depthTest,
          depthWrite: this.depthWrite,
          culling: this.cullMode,
          transparent: this.transparent,
          blending: this.transparent ? BlendingMode.ALPHA : BlendingMode.OPAQUE,
          // The whole point of a custom shader is arbitrary vertex code (displacement, fog,
          // effects) the shared depth pre-pass pipeline can't reproduce, so it must never be
          // drawn there -- its per-object uuid-suffixed shaderId made a shaderId-list impossible,
          // hence this explicit opt-out (see RenderManifest.skipDepthPrePass).
          skipDepthPrePass: true,
        },
      };
    }

    // Always copy the latest user-defined properties and textures into the manifest
    for (const key in this.properties) {
      this._renderManifest.properties[key] = this.properties[key];
    }
    for (const key in this.textures) {
      this._renderManifest.textures[key] = this.textures[key];
    }

    const state = this._renderManifest.state;
    if (state) {
      state.depthTest = this.depthTest;
      state.depthWrite = this.depthWrite;
      state.culling = this.cullMode;
      state.transparent = this.transparent;
      state.blending = this.transparent ? BlendingMode.ALPHA : BlendingMode.OPAQUE;
      state.skipDepthPrePass = true;
    }

    // Derive shader-compile flags from the assigned textures so the assembled fragment template
    // actually declares the guarded sampler uniforms (u_emissiveMap -> USE_EMISSIVE_MAP, ...).
    // Without this, any custom material reusing a template with #ifdef-guarded maps compiles its
    // map usage against an undeclared sampler on the GLSL 300 path (StandardMaterial does this
    // explicitly per-typed-slot; a generic material cannot). Unused defines are always harmless.
    // The array is rebuilt in place (stable reference) and the key -> flag mapping is memoised,
    // so the per-frame cost is a key walk without regex or allocation.
    const flags = this._textureFlags;
    flags.length = 0;
    for (const key in this.textures) {
      if (!this.textures[key]) continue;
      const flag = this._flagForTextureKey(key);
      if (undefined !== flag && !flags.includes(flag)) flags.push(flag);
    }
    this._renderManifest.flags = flags;

    return this._renderManifest;
  }

  private _flagForTextureKey(key: string): string | undefined {
    if (this._textureFlagByKey.has(key)) {
      return this._textureFlagByKey.get(key);
    }
    let flag: string | undefined;
    if (key === "u_envMap") {
      flag = "USE_ENV_MAP";
    } else if (key === "u_normalMap") {
      flag = "USE_NORMAL_MAP";
    } else {
      const m = /^u_([a-zA-Z0-9]+?)Map$/.exec(key);
      if (m) flag = `USE_${m[1]!.toUpperCase()}_MAP`;
    }
    this._textureFlagByKey.set(key, flag);
    return flag;
  }

  /** @inheritdoc */
  public override getShaderDefinition(): ShaderDefinition {
    const mappedSources: ShaderDefinition["sources"] = {};
    if (this.sources.wgsl) mappedSources.wgsl = this.sources.wgsl;
    if (this.sources.glsl300) mappedSources.glsl300 = this.sources.glsl300;
    if (this.sources.glsl100) mappedSources.glsl100 = this.sources.glsl100;

    return {
      id: this.type,
      sources: mappedSources,
      layout: this.layout,
      defaultState: {
        culling: this.cullMode,
        blending: this.transparent ? BlendingMode.ALPHA : BlendingMode.OPAQUE,
        depthWrite: this.depthWrite,
        depthTest: this.depthTest,
        transparent: this.transparent,
      },
    };
  }
}
