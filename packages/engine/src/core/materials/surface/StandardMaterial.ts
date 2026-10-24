import fragGLSL from "./shaders/Standard.frag.glsl?raw";
import fragGLSL100 from "./shaders/Standard.frag.glsl100?raw";
import fragWGSL from "./shaders/Standard.frag.wgsl?raw";
import { AbstractMaterial } from "../AbstractMaterial.js";
import { Color } from "../../colors/index.js";
import { MaterialType, ShaderPropertyType, BlendingMode } from "../../../enums/index.js";
import type { Texture, CubeTexture } from "../../textures/index.js";
import type { RenderManifest, ShaderDefinition } from "../../../renderers/shaders/index.js";
import { StandardWebGPULayout } from "../../../renderers/shaders/index.js";
import { writeLane } from "../MaterialLanes.js";
import type { MaterialLane } from "../MaterialLanes.js";
import { Vector2D } from "../../../math/index.js";
import type { InspectorField } from "../../Inspectable.js";

/**
 * Configuration options for StandardMaterial.
 */
export interface StandardMaterialOptions {
  /** The base color of the material. Defaults to white. */
  color?: Color;
  /** Metallic factor (0 to 1). Defaults to 0. */
  metallic?: number;
  /** Roughness factor (0 to 1). Defaults to 0.5. */
  roughness?: number;
  /** Ambient occlusion factor (0 to 1). Defaults to 1. */
  ao?: number;
  /** The diffuse texture map. */
  diffuseMap?: Texture | undefined;
  /** The normal map texture. */
  normalMap?: Texture | undefined;
  /** Scale factor for the normal map to control strength and flip X/Y. Defaults to (1, 1). */
  normalScale?: Vector2D;
  /** The metallic texture map. */
  metallicMap?: Texture | undefined;
  /** The roughness texture map. */
  roughnessMap?: Texture | undefined;
  /** Ambient occlusion texture map. */
  aoMap?: Texture | undefined;
  /** The emissive color. Defaults to black. */
  emissiveColor?: Color;
  /** The emissive texture map. */
  emissiveMap?: Texture | undefined;
  /** The alpha mask texture map. */
  alphaMap?: Texture | undefined;
  /** Environment map for Image-Based Lighting reflections. */
  envMap?: CubeTexture | undefined;
  /** Planar reflection map. */
  reflectionMap?: Texture | undefined;
  /** Planar reflection intensity. Defaults to 1.0. */
  reflectivity?: number;
  /**
   * How much of the planar reflection's strength depends on view angle: 0 = constant strength
   * regardless of angle, 1 = pure Schlick Fresnel (strong only within the last few degrees before
   * a grazing angle, effectively invisible everywhere else -- physically correct for a smooth
   * dielectric, but reads as an on/off switch rather than a gradual falloff to a human observer).
   * Defaults to 0.5, matching the engine's original fixed blend. Lower this for a reflection that
   * should stay legible across a wider range of viewing angles (e.g. a puddle meant to be seen
   * from a normal, not-perfectly-grazing camera angle).
   */
  reflectionFresnelBlend?: number;
  /** The intensity of the emissive light. Defaults to 1.0. */
  emissiveIntensity?: number;
  /** Whether the material is transparent. Defaults to false. */
  transparent?: boolean;
  /** Alpha cutoff threshold. Fragments with alpha below this value are discarded. Defaults to 0.0. */
  alphaTest?: number;
  /** Clearcoat layer intensity (0 to 1). Defaults to 0.0. */
  clearcoat?: number;
  /** Clearcoat layer roughness (0 to 1). Defaults to 0.0. */
  clearcoatRoughness?: number;
  /** Clearcoat factor texture map. */
  clearcoatMap?: Texture | undefined;
  /** Clearcoat roughness texture map. */
  clearcoatRoughnessMap?: Texture | undefined;
  /** Clearcoat normal map texture. */
  clearcoatNormalMap?: Texture | undefined;
  /** Sheen color for microfiber grazing highlights. Defaults to black (disabled). */
  sheenColor?: Color;
  /** Sheen roughness (0 to 1). Defaults to 0.0. */
  sheenRoughness?: number;
  /** Sheen color texture map. */
  sheenColorMap?: Texture | undefined;
  /** Sheen roughness texture map. */
  sheenRoughnessMap?: Texture | undefined;
  /** Transmission factor for specular light transmission (0 to 1). Defaults to 0.0. */
  transmission?: number;
  /** Transmission factor texture map. */
  transmissionMap?: Texture | undefined;
  /** Index of refraction. Defaults to 1.5. */
  ior?: number;
  /** Volume thickness factor. Defaults to 0.0. */
  thickness?: number;
  /** Volume thickness texture map. */
  thicknessMap?: Texture | undefined;
  /** Volumetric attenuation distance. Defaults to 1000.0 (no attenuation). */
  attenuationDistance?: number;
  /** Volumetric attenuation color. Defaults to white. */
  attenuationColor?: Color;
  /** Time parameter for shader animations. Defaults to 0.0. */
  time?: number;
}

/**
 * A physically based rendering (PBR) material using the Metallic-Roughness workflow.
 */
export class StandardMaterial extends AbstractMaterial {
  /** Own fields on top of `AbstractMaterial.inspector` -- see `collectInspectorSchema()`. */
  public static override readonly inspector: Record<string, InspectorField> = {
    metallic: { type: "number", label: "Metallic", min: 0, max: 1, step: 0.01, row: "surface" },
    roughness: { type: "number", label: "Roughness", min: 0, max: 1, step: 0.01, row: "surface" },
    ao: { type: "number", label: "AO", min: 0, max: 1, step: 0.01 },
    clearcoat: { type: "number", label: "Clearcoat", min: 0, max: 1, step: 0.01, row: "coat" },
    clearcoatRoughness: {
      type: "number",
      label: "Coat Rough",
      min: 0,
      max: 1,
      step: 0.01,
      row: "coat",
    },
    transmission: {
      type: "number",
      label: "Transmission",
      min: 0,
      max: 1,
      step: 0.01,
      row: "trans",
    },
    ior: { type: "number", label: "IOR", min: 1.0, max: 3.0, step: 0.01, row: "trans" },
    thickness: { type: "number", label: "Thickness", min: 0, max: 10.0, step: 0.05 },
    emissiveColor: { type: "color", label: "Emissive" },
    emissiveIntensity: { type: "number", label: "Emissive Int.", min: 0, max: 10, step: 0.1 },
    alphaTest: { type: "number", label: "Alpha Test", min: 0, max: 1, step: 0.01 },
  };

  /** Metallic factor (0 to 1). */
  public metallic: number;
  /** Roughness factor (0 to 1). */
  public roughness: number;
  /** Ambient occlusion factor (0 to 1). */
  public ao: number;

  /** Clearcoat layer factor (0 to 1). */
  public clearcoat: number;
  /** Clearcoat layer roughness (0 to 1). */
  public clearcoatRoughness: number;
  /** Clearcoat factor texture map. */
  public clearcoatMap: Texture | undefined;
  /** Clearcoat roughness texture map. */
  public clearcoatRoughnessMap: Texture | undefined;
  /** Clearcoat normal map texture. */
  public clearcoatNormalMap: Texture | undefined;

  /** Sheen color for cloth/velvet microfibers. */
  public sheenColor: Color;
  /** Sheen roughness factor (0 to 1). */
  public sheenRoughness: number;
  /** Sheen color texture map. */
  public sheenColorMap: Texture | undefined;
  /** Sheen roughness texture map. */
  public sheenRoughnessMap: Texture | undefined;

  /** Specular transmission factor (0 to 1). */
  public transmission: number;
  /** Transmission factor texture map. */
  public transmissionMap: Texture | undefined;
  /** Index of refraction. */
  public ior: number;
  /** Volumetric thickness. */
  public thickness: number;
  /** Thickness texture map. */
  public thicknessMap: Texture | undefined;
  /** Volumetric attenuation distance. */
  public attenuationDistance: number;
  /** Volumetric attenuation color. */
  public attenuationColor: Color;

  /** The diffuse texture map. */
  public diffuseMap: Texture | undefined;

  /** The normal map texture. */
  public normalMap: Texture | undefined;

  /** Scale factor for the normal map to control strength and flip X/Y. */
  public normalScale: Vector2D;

  /** The metallic map texture. */
  public metallicMap: Texture | undefined;

  /** The roughness map texture. */
  public roughnessMap: Texture | undefined;

  /** Ambient occlusion texture map. */
  public aoMap: Texture | undefined;

  /** The emissive color. */
  public emissiveColor: Color;

  /** The emissive map texture. */
  public emissiveMap: Texture | undefined;

  /** The alpha mask texture map. */
  public alphaMap: Texture | undefined;

  /** The environment map for reflections. */
  public envMap: CubeTexture | undefined;

  /** The planar reflection map. */
  public reflectionMap: Texture | undefined;

  /** The intensity of the planar reflection. */
  public reflectivity: number;

  /** How much of the planar reflection depends on view angle (0 = constant, 1 = pure Fresnel). */
  public reflectionFresnelBlend: number;

  /** The intensity of the emissive glow. */
  public emissiveIntensity: number;

  /** Alpha cutoff threshold. */
  public alphaTest: number;

  /** Time parameter for shader animations. */
  public time: number;

  /**
   * Typed semantic lane table (ADR 0027 / 0039) for this material. `reflectionFresnelBlend` was
   * historically smuggled through a generic padding slot; it now travels in `u_matParam0.x` and
   * the shader reads it from there (see Standard.frag.glsl / Standard.frag.wgsl). The table is the
   * single source of truth: `getRenderManifest` packs through it via `writeLane`, so renaming a
   * semantic or relocating a lane can never silently detach material from shader.
   */
  private static readonly _LANES: readonly [MaterialLane, MaterialLane, MaterialLane] = [
    {
      semantic: "reflectionFresnelBlend",
      lane: "u_matParam0",
      note: "x = blend (0..1), yzw unused",
    },
    {
      semantic: "sheenColor",
      lane: "u_matParam10",
      note:
        "rgb = sheen tint (sRGB, the shaders linearize), w = enable flag: 1.0 iff sheenColor > 0 or " +
        "sheenColorMap present. Decouples sheen from u_specColor (emissive): the w-flag mirrors the " +
        "USE_SHEEN push basis exactly, so the WebGL1/WebGPU runtime gate and the WebGL2 compile gate " +
        "activate identically (ADR 0039 sheen decision). Lane 10 sits clear of the reflection/water/ " +
        "decal/lava semantics that occupy lanes 0..9.",
    },
    // Lane 11 (engine-wide free 11..15): KHR_materials_volume attenuation colour. The shaders
    // previously passed ALBEDO into Beer-Lambert VolumeAbsorption, silently dropping the imported
    // attenuationColor (P3/S1 R1, severity error, E1-A + E2-A). The RGB travels LINEAR/RAW (the
    // ORM/normal 'roh' convention -- no sRGB decode ahead of the Beer-Lambert kernel). The free
    // scalar `u_thresholds[3]` (StandardMaterial.ts:392) cannot hold a vec3, so an owned typed lane
    // carries it and the shaders read obj.matParam11.xyz / u_matParam11.rgb only on tiers with the
    // transmission path (WebGPU + WebGL2; WebGL1 has no transmission block, E-M13).
    // @pending-S5-review: reconcile with the S5 glTF loader color-space conversion once
    // GltfMaterialParser lands.
    {
      semantic: "attenuationColor",
      lane: "u_matParam11",
      note:
        "rgb = volumetric attenuation colour (LINEAR/RAW, @pending-S5-review), w = 1.0. " +
        "Only meaningful with USE_TRANSMISSION; never read on WebGL1 (no transmission path).",
    },
  ];

  /**
   * Sheen setup exists iff a tint color (>0) or a tint map is present. This is the single basis for
   * both the `USE_SHEEN` compile flag (WebGL2) and the `u_matParam10.w` runtime enable (WebGL1/WebGPU),
   * so every backend activates sheen under exactly the same condition.
   */
  private get hasSheenSetup(): boolean {
    return (
      this.sheenColor.r > 0 ||
      this.sheenColor.g > 0 ||
      this.sheenColor.b > 0 ||
      undefined !== this.sheenColorMap
    );
  }

  /**
   * Creates a new StandardMaterial.
   * @param options The configuration options for the material.
   */
  constructor(options: StandardMaterialOptions = {}) {
    super(MaterialType.STANDARD);
    const {
      color = new Color(1, 1, 1, 1),
      metallic = 0.0,
      roughness = 0.5,
      ao = 1.0,
      diffuseMap = undefined,
      normalMap = undefined,
      normalScale = new Vector2D(1, 1),
      metallicMap = undefined,
      roughnessMap = undefined,
      aoMap = undefined,
      emissiveColor = new Color(0, 0, 0),
      emissiveMap = undefined,
      alphaMap = undefined,
      envMap = undefined,
      reflectionMap = undefined,
      reflectivity = 1.0,
      reflectionFresnelBlend = 0.5,
      emissiveIntensity = 1.0,
      transparent = false,
      alphaTest = 0.0,
      clearcoat = 0.0,
      clearcoatRoughness = 0.0,
      clearcoatMap = undefined,
      clearcoatRoughnessMap = undefined,
      clearcoatNormalMap = undefined,
      sheenColor = new Color(0, 0, 0),
      sheenRoughness = 0.0,
      sheenColorMap = undefined,
      sheenRoughnessMap = undefined,
      transmission = 0.0,
      transmissionMap = undefined,
      ior = 1.5,
      thickness = 0.0,
      thicknessMap = undefined,
      attenuationDistance = 1000.0,
      attenuationColor = new Color(1, 1, 1),
      time = 0.0,
    } = options;
    this.color = Object.isFrozen(color) ? color.clone() : color;
    this.metallic = metallic;
    this.roughness = roughness;
    this.ao = ao;
    this.diffuseMap = diffuseMap;
    this.normalMap = normalMap;
    this.normalScale = normalScale;
    this.metallicMap = metallicMap;
    this.roughnessMap = roughnessMap;
    this.aoMap = aoMap;
    this.emissiveColor = emissiveColor;
    this.emissiveMap = emissiveMap;
    this.alphaMap = alphaMap;
    this.envMap = envMap;
    this.reflectionMap = reflectionMap;
    this.reflectivity = reflectivity;
    this.reflectionFresnelBlend = reflectionFresnelBlend;
    this.emissiveIntensity = emissiveIntensity;
    this.transparent = transparent;
    this.alphaTest = alphaTest;
    this.clearcoat = clearcoat;
    this.clearcoatRoughness = clearcoatRoughness;
    this.clearcoatMap = clearcoatMap;
    this.clearcoatRoughnessMap = clearcoatRoughnessMap;
    this.clearcoatNormalMap = clearcoatNormalMap;
    this.sheenColor = Object.isFrozen(sheenColor) ? sheenColor.clone() : sheenColor;
    this.sheenRoughness = sheenRoughness;
    this.sheenColorMap = sheenColorMap;
    this.sheenRoughnessMap = sheenRoughnessMap;
    this.transmission = transmission;
    this.transmissionMap = transmissionMap;
    this.ior = ior;
    this.thickness = thickness;
    this.thicknessMap = thicknessMap;
    this.attenuationDistance = attenuationDistance;
    this.attenuationColor = Object.isFrozen(attenuationColor)
      ? attenuationColor.clone()
      : attenuationColor;
    this.time = time;
  }

  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      this._renderManifest = this._createBaseManifest();
    }

    this._syncBaseManifestState();
    this._syncTexOffsetRepeat(
      this.diffuseMap ||
        this.emissiveMap ||
        this.normalMap ||
        this.metallicMap ||
        this.roughnessMap ||
        this.aoMap ||
        this.alphaMap ||
        this.clearcoatMap ||
        this.sheenColorMap ||
        this.transmissionMap,
    );

    const props = this._renderManifest.properties;
    const texs = this._renderManifest.textures;

    (props["u_specColor"] as Float32Array)[0] = this.emissiveColor.r;
    (props["u_specColor"] as Float32Array)[1] = this.emissiveColor.g;
    (props["u_specColor"] as Float32Array)[2] = this.emissiveColor.b;
    (props["u_specColor"] as Float32Array)[3] = this.emissiveIntensity;
    props["u_metallic"] = this.metallic;
    props["u_roughness"] = this.roughness;
    (props["u_extraParams"] as number[])[0] = this.ao;
    (props["u_extraParams"] as number[])[1] = this.alphaTest;
    (props["u_extraParams"] as number[])[2] = this.normalScale.x;
    (props["u_extraParams"] as number[])[3] = this.normalScale.y;

    (props["u_liquidParams"] as number[])[0] = this.ior;
    (props["u_liquidParams"] as number[])[1] = this.thickness;
    (props["u_liquidParams"] as number[])[2] = this.transmission;
    (props["u_liquidParams"] as number[])[3] = this.clearcoat;

    (props["u_thresholds"] as number[])[0] = this.clearcoatRoughness;
    (props["u_thresholds"] as number[])[1] = this.sheenRoughness;
    (props["u_thresholds"] as number[])[2] = this.attenuationDistance;
    (props["u_thresholds"] as number[])[3] = 0.0;

    texs["u_diffuseMap"] = this.diffuseMap;
    texs["u_normalMap"] = this.normalMap;
    texs["u_metallicMap"] = this.metallicMap;
    texs["u_roughnessMap"] = this.roughnessMap;
    texs["u_aoMap"] = this.aoMap;
    texs["u_emissiveMap"] = this.emissiveMap;
    texs["u_alphaMap"] = this.alphaMap;
    texs["u_envMap"] = this.envMap;
    texs["u_reflectionMap"] = this.reflectionMap;

    texs["u_clearcoatMap"] = this.clearcoatMap;
    texs["u_clearcoatRoughnessMap"] = this.clearcoatRoughnessMap;
    texs["u_clearcoatNormalMap"] = this.clearcoatNormalMap;
    texs["u_sheenColorMap"] = this.sheenColorMap;
    texs["u_sheenRoughnessMap"] = this.sheenRoughnessMap;
    texs["u_transmissionMap"] = this.transmissionMap;
    texs["u_thicknessMap"] = this.thicknessMap;

    props["u_useEnvMap"] = this.envMap ? 1.0 : 0.0;
    props["u_useReflectionMap"] = this.reflectionMap ? 1.0 : 0.0;
    props["u_reflectivity"] = this.reflectivity;
    // Pack through the typed lane table -- the table entry is the single source of truth.
    writeLane(this._renderManifest, StandardMaterial._LANES[0], [
      this.reflectionFresnelBlend,
      0,
      0,
      0,
    ]);
    // Sheen travels decoupled from u_specColor (emissive) in _LANES[1]; see the lane's contract note.
    writeLane(this._renderManifest, StandardMaterial._LANES[1], [
      this.sheenColor.r,
      this.sheenColor.g,
      this.sheenColor.b,
      this.hasSheenSetup ? 1 : 0,
    ]);
    // P3/S1 R1: attenuationColor travels LINEAR/RAW in _LANES[2] so the Beer-Lambert kernel gets the
    // real volumetric absorption colour instead of albedo (see the lane table contract note).
    writeLane(this._renderManifest, StandardMaterial._LANES[2], [
      this.attenuationColor.r,
      this.attenuationColor.g,
      this.attenuationColor.b,
      1.0,
    ]);
    props["u_time"] = this.time;

    const flags: string[] = [];
    if (
      this.diffuseMap &&
      "isTextureArray" in this.diffuseMap &&
      (this.diffuseMap as import("../../textures/index.js").TextureArray).isTextureArray
    ) {
      flags.push("USE_TEXTURE_ARRAY");
    }
    if (this.metallicMap) flags.push("USE_METALLIC_MAP");
    if (this.roughnessMap) flags.push("USE_ROUGHNESS_MAP");
    if (this.aoMap) flags.push("USE_AO_MAP");
    if (this.emissiveMap) flags.push("USE_EMISSIVE_MAP");
    if (this.alphaMap) flags.push("USE_ALPHA_MAP");
    if (this.envMap) flags.push("USE_ENV_MAP");
    if (this.normalMap) flags.push("USE_NORMAL_MAP");
    if (this.reflectionMap) flags.push("USE_REFLECTION_MAP");

    if (this.clearcoat > 0 || this.clearcoatMap) flags.push("USE_CLEARCOAT");
    if (this.clearcoatMap) flags.push("USE_CLEARCOAT_MAP");
    if (this.clearcoatRoughnessMap) flags.push("USE_CLEARCOAT_ROUGHNESS_MAP");
    if (this.clearcoatNormalMap) flags.push("USE_CLEARCOAT_NORMAL_MAP");
    if (this.hasSheenSetup) {
      flags.push("USE_SHEEN");
    }
    if (this.sheenColorMap) flags.push("USE_SHEEN_COLOR_MAP");
    if (this.sheenRoughnessMap) flags.push("USE_SHEEN_ROUGHNESS_MAP");
    if (this.transmission > 0 || this.transmissionMap) flags.push("USE_TRANSMISSION");
    if (this.transmissionMap) flags.push("USE_TRANSMISSION_MAP");
    if (this.thicknessMap) flags.push("USE_THICKNESS_MAP");

    this._renderManifest.flags = flags;

    if (this._renderManifest.state) {
      this._renderManifest.state.blending = this.transparent
        ? BlendingMode.ALPHA
        : BlendingMode.OPAQUE;
      this._renderManifest.state.depthWrite = !this.transparent;
    }

    return this._renderManifest;
  }

  /**
   * Creates an independent copy of this material. Useful before mutating per-instance
   * properties (e.g. an emissive hover glow) on a material that might be shared across
   * multiple objects, where a direct mutation would visibly affect all of them at once.
   */
  public override clone(): StandardMaterial {
    return super.clone() as StandardMaterial;
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
          u_diffuseMap: { type: ShaderPropertyType.TEXTURE },
          u_normalMap: { type: ShaderPropertyType.TEXTURE },
          u_metallicMap: { type: ShaderPropertyType.TEXTURE },
          u_roughnessMap: { type: ShaderPropertyType.TEXTURE },
          u_aoMap: { type: ShaderPropertyType.TEXTURE },
          u_emissiveMap: { type: ShaderPropertyType.TEXTURE },
          u_alphaMap: { type: ShaderPropertyType.TEXTURE },
          u_envMap: { type: ShaderPropertyType.TEXTURE },
          u_reflectionMap: { type: ShaderPropertyType.TEXTURE },
          u_clearcoatMap: { type: ShaderPropertyType.TEXTURE },
          u_clearcoatRoughnessMap: { type: ShaderPropertyType.TEXTURE },
          u_clearcoatNormalMap: { type: ShaderPropertyType.TEXTURE },
          u_sheenColorMap: { type: ShaderPropertyType.TEXTURE },
          u_sheenRoughnessMap: { type: ShaderPropertyType.TEXTURE },
          u_transmissionMap: { type: ShaderPropertyType.TEXTURE },
          u_thicknessMap: { type: ShaderPropertyType.TEXTURE },
          u_opaqueMap: { type: ShaderPropertyType.TEXTURE },
        },
      },
    };
  }
}
