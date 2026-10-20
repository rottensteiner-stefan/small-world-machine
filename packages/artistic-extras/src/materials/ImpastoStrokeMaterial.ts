import fragGLSL from "./shaders/ImpastoStroke.frag.glsl?raw";
import fragGLSL100 from "./shaders/ImpastoStroke.frag.glsl100?raw";
import fragWGSL from "./shaders/ImpastoStroke.frag.wgsl?raw";
import {
  AbstractMaterial,
  Color,
  ShaderPropertyType,
  StandardWebGPULayout,
} from "@small-world-machine/engine";
import type { RenderManifest, ShaderDefinition, Texture } from "@small-world-machine/engine";

export interface ImpastoStrokeMaterialOptions {
  /** Base albedo tint. Defaults to white. */
  color?: Color;
  /**
   * Live paint color + coverage canvas (alpha = coverage). Reuses the `u_diffuseMap` texture slot.
   * Never leave undefined: provide an empty canvas.
   */
  paintMap?: Texture;
  /**
   * Live stroke direction + pressure canvas (RG = 0..1 encoded plane-UV direction, B = lift,
   * A = pressure). Reuses the always-bound `u_emissiveMap` texture slot.
   */
  dirMap?: Texture;
  /**
   * Background layer (a photo projection or a procedural steel plate). Reuses the `u_aoMap`
   * texture slot. Never leave undefined: provide a steel plate canvas.
   */
  baseMap?: Texture;
  /** Relative strength of the painted relief (0..2). Defaults to 1.0. */
  brushRelief?: number;
  /** How far painted color smears along the stroke direction (0..1). Defaults to 0.28. */
  smearDistance?: number;
  /** Strength of the raised rim along a stroke edge (0..2). Defaults to 0.9. */
  edgeLift?: number;
  /** How much paint replaces the base layer (0..1). Defaults to 0.92. */
  paintOpacity?: number;
  /** Metalness of the impasto surface (0..1). Defaults to 0.55. */
  metallic?: number;
  /** Roughness of the impasto surface (0..1). Defaults to 0.5. */
  roughness?: number;
}

/**
 * A live interactive impasto material: the height field and stroke direction come from two
 * canvas-backed textures the app re-uploads as the user paints (see `StrokeRaster`), so the
 * palette-knife smearing, relief shading and edge lift react in real time.
 *
 * Texture slot reuse (no engine change): the fixed WebGPU material binding table mirrors
 * `structs.wgsl` group(1) names 1:1, so this material mounts the paint canvas on `u_diffuseMap`,
 * the direction canvas on `u_emissiveMap` (always-bound slot 12) and the base layer on `u_aoMap`.
 * All three must be provided by the app.
 */
export class ImpastoStrokeMaterial extends AbstractMaterial {
  public static readonly TYPE: string = "ImpastoStrokeMaterial";

  public paintMap: Texture | undefined;
  public dirMap: Texture | undefined;
  public baseMap: Texture | undefined;
  public brushRelief: number;
  public smearDistance: number;
  public edgeLift: number;
  public paintOpacity: number;
  public metallic: number;
  public roughness: number;
  public time: number = 0.0;

  constructor(options: ImpastoStrokeMaterialOptions = {}) {
    super(ImpastoStrokeMaterial.TYPE);

    this.color = options.color ?? new Color(1, 1, 1);
    this.paintMap = options.paintMap;
    this.dirMap = options.dirMap;
    this.baseMap = options.baseMap;
    this.brushRelief = options.brushRelief ?? 1.0;
    this.smearDistance = options.smearDistance ?? 0.28;
    this.edgeLift = options.edgeLift ?? 0.9;
    this.paintOpacity = options.paintOpacity ?? 0.92;
    this.metallic = options.metallic ?? 0.55;
    this.roughness = options.roughness ?? 0.5;
  }

  /** @inheritdoc */
  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      this._renderManifest = this._createBaseManifest();
      this._renderManifest.properties["u_specColor"] = new Float32Array([1.0, 1.0, 1.0, 1.0]);
      this._renderManifest.properties["u_styleA"] = [0.0, 0.0, 0.0, 0.0];
      this._renderManifest.properties["u_styleB"] = [0.0, 0.0, 0.0, 0.0];
      this._renderManifest.textures["u_diffuseMap"] = this.paintMap;
      this._renderManifest.textures["u_emissiveMap"] = this.dirMap;
      this._renderManifest.textures["u_aoMap"] = this.baseMap;
    }

    this._syncBaseManifestState();

    const props = this._renderManifest.properties as Record<string, unknown>;
    const texs = this._renderManifest.textures as Record<string, unknown>;

    texs["u_diffuseMap"] = this.paintMap;
    texs["u_emissiveMap"] = this.dirMap;
    texs["u_aoMap"] = this.baseMap;
    this._syncTexOffsetRepeat(this.paintMap);

    props["u_metallic"] = this.metallic;
    props["u_roughness"] = this.roughness;
    props["u_time"] = this.time;

    const styleA = props["u_styleA"] as number[];
    styleA[0] = this.brushRelief;
    styleA[1] = this.smearDistance;
    styleA[2] = this.edgeLift;
    styleA[3] = this.paintOpacity;

    // Paint canvas resolution reciprocals, used as finite-difference / smear texel size.
    const pw = this.paintMap?.image ? this.paintMap.image.width : 1;
    const ph = this.paintMap?.image ? this.paintMap.image.height : 1;
    const styleB = props["u_styleB"] as number[];
    styleB[0] = 1 / Math.max(1, pw);
    styleB[1] = 1 / Math.max(1, ph);
    styleB[2] = 0;
    styleB[3] = 0;

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
        textures: {
          u_diffuseMap: { type: ShaderPropertyType.TEXTURE },
          u_emissiveMap: { type: ShaderPropertyType.TEXTURE },
          u_aoMap: { type: ShaderPropertyType.TEXTURE },
        },
      },
    };
  }
}
