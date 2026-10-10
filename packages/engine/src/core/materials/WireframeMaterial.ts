import fragGLSL from "./shaders/Wireframe.frag.glsl?raw";
import fragGLSL100 from "./shaders/Wireframe.frag.glsl100?raw";
import fragWGSL from "./shaders/Wireframe.frag.wgsl?raw";
import { AbstractMaterial } from "./AbstractMaterial.js";
import { MaterialType, CullMode, Topology } from "../../enums/index.js";
import { Color } from "../colors/index.js";
import {
  RenderManifest,
  ShaderDefinition,
  StandardWebGPULayout,
} from "../../renderers/shaders/index.js";
import { InspectorField } from "../Inspectable.js";

/**
 * Configuration options for WireframeMaterial.
 */
export interface WireframeMaterialOptions {
  /** The wireframe line color. Defaults to white. */
  color?: Color;
  /** Wireframe rendering mode ("structural" or "triangles"). Defaults to "structural". */
  wireframeMode?: "structural" | "triangles";
}

/**
 * A material for wireframe rendering.
 */
export class WireframeMaterial extends AbstractMaterial {
  /** Own field on top of `AbstractMaterial.inspector` -- see `collectInspectorSchema()`. */
  public static override readonly inspector: Record<string, InspectorField> = {
    wireframeMode: {
      type: "choice",
      label: "Wireframe Mode",
      options: { structural: "structural", triangles: "triangles" },
    },
  };

  public wireframeMode: "structural" | "triangles" = "structural";

  /**
   * @param optionsOrColor Line colour, or an options object (`color`, `wireframeMode`). Defaults to white.
   * @param wireframeMode Only used with the colour overload; an options object carries its own mode.
   */
  constructor(
    optionsOrColor: WireframeMaterialOptions | Color = new Color(1, 1, 1, 1),
    wireframeMode: "structural" | "triangles" = "structural",
  ) {
    super(MaterialType.WIREFRAME);
    if (null === optionsOrColor || "object" !== typeof optionsOrColor) {
      throw new TypeError(
        "WireframeMaterial expects a Color or a WireframeMaterialOptions object.",
      );
    }
    const options: WireframeMaterialOptions =
      optionsOrColor instanceof Color ? { color: optionsOrColor, wireframeMode } : optionsOrColor;
    const color = options.color ?? new Color(1, 1, 1, 1);
    this.color = Object.isFrozen(color) ? color.clone() : color;
    this.wireframeMode = options.wireframeMode ?? "structural";
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
        textures: {},
        state: {
          // Wireframes must never occlude anything, so they stay out of the GPU depth pre-pass
          // (see RenderManifest.skipDepthPrePass) -- their thin lines can't cast meaningful
          // depth anyway, and the pre-pass would just waste a draw.
          skipDepthPrePass: true,
          culling: CullMode.NONE, // Often useful for wireframes to see the back
          topology: Topology.LINE_LIST,
          wireframeMode: this.wireframeMode,
        },
      };
    }

    const props = this._renderManifest.properties as Record<string, unknown>;
    props["u_color"] = this.color.toFloat32Array();
    if (this._renderManifest.state) {
      this._renderManifest.state.wireframeMode = this.wireframeMode;
    }

    return this._renderManifest!;
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
        textures: {},
      },
    };
  }
}
