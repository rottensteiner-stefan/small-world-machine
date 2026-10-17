import fragGLSL from "./shaders/Basic.frag.glsl?raw";
import fragGLSL100 from "./shaders/Basic.frag.glsl100?raw";
import fragWGSL from "./shaders/Basic.frag.wgsl?raw";
import { AbstractMaterial } from "../AbstractMaterial.js";
import { MaterialType, ShaderPropertyType, BlendingMode } from "../../../enums/index.js";
import type { Color } from "../../colors/index.js";
import type { Texture } from "../../textures/index.js";
import type { RenderManifest, ShaderDefinition } from "../../../renderers/shaders/index.js";
import { StandardWebGPULayout } from "../../../renderers/shaders/index.js";

/**
 * Configuration options for BasicMaterial.
 */
export type BasicMaterialOptions = {
  color?: Color;
  diffuseMap?: Texture;
};

/**
 * A basic material that only uses a flat color.
 */
export class BasicMaterial extends AbstractMaterial {
  /** The diffuse texture map. */
  public diffuseMap: Texture | undefined;

  constructor(options?: BasicMaterialOptions) {
    super(MaterialType.BASIC);
    if (options) {
      if (options.color) {
        this.color.copyFrom(options.color);
      }
      this.diffuseMap = options.diffuseMap;
    }
  }

  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      this._renderManifest = this._createBaseManifest();
    }

    this._syncBaseManifestState();
    this._syncTexOffsetRepeat(this.diffuseMap);

    this._renderManifest.textures["u_diffuseMap"] = this.diffuseMap;

    // `_syncBaseManifestState()` only syncs `state.transparent` -- the pipelines themselves key
    // actual blend state off `state.blending` (see e.g. `GPUPipelineCache`), so without this a
    // `BasicMaterial` with `transparent = true` renders fully opaque regardless of `color.a`.
    // Mirrors `StandardMaterial`/`PhongMaterial`'s own pattern.
    if (this._renderManifest.state) {
      this._renderManifest.state.blending = this.transparent
        ? BlendingMode.ALPHA
        : BlendingMode.OPAQUE;
      this._renderManifest.state.depthWrite = !this.transparent;
    }

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
