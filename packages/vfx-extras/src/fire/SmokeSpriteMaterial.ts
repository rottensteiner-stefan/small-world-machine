import fragGLSL from "./Smoke.frag.glsl?raw";
import fragGLSL100 from "./Smoke.frag.glsl100?raw";
import fragWGSL from "./Smoke.frag.wgsl?raw";
import type { RenderManifest, ShaderDefinition } from "@small-world-machine/engine";
import {
  AbstractMaterial,
  BlendingMode,
  Color,
  CullMode,
  ShaderPropertyType,
  StandardWebGPULayout,
  Vector3D,
} from "@small-world-machine/engine";

// Shader lane anatomy (`Smoke.frag.*`):
//   u_matParam0 = [time, churn, softFadeDistance, softEnabled01]
//   u_matParam1 = [lightDir.x, lightDir.y, lightDir.z, lightIntensity]
//   u_matParam2 = [ambient, selfShadowStrength, rimStrength, forwardScatter]
//   u_matParam3 = [lightScale, lightSlope, lightEnabled01, unused]
//   u_matParam4 = [tintStart.rgb, tintStart.a]  (birth tint + opacity)
//   u_matParam6 = [tintEnd.rgb, tintEnd.a]      (death tint + opacity; lane 5 is decal-reserved)
const DEFAULT_LIGHT_DIRECTION = new Vector3D(0.45, 0.3, -0.84); // from above-left-front

/**
 * Configuration options for {@link SmokeSpriteMaterial}.
 */
export interface SmokeSpriteMaterialOptions {
  /**
   * Birth tint (sRGB) and birth opacity (`a`). The fragment rebuilds the age-faded tint from the
   * instance opacity ramp between this and {@link tintEnd}, so the instance rgb is free to carry a
   * lifetime-stable per-particle seed. Must match the emitter's colour ramp. Defaults to the
   * `FireSmokeEmitter` default (0.62, 0.58, 0.55, 0.36).
   * @domain birth tint + opacity (opacity ramp endpoints, tint lerp anchor)
   */
  tintStart?: Color | undefined;
  /**
   * Death tint (sRGB) and death opacity (`a`); see {@link tintStart}. Defaults to the
   * `FireSmokeEmitter` default (0.16, 0.15, 0.14, 0).
   * @domain death tint + opacity
   */
  tintEnd?: Color | undefined;
  /** Animation time in seconds; advances the edge churn. Defaults to 0. */
  time?: number;
  /** Churn strength (>=0); 0 = perfectly smooth billboard. Defaults to 1. */
  churn?: number;
  /**
   * Soft-particle fade distance in meters (>0). When enabled the fragment samples the shared
   * opaque-scene depth and fades the smoke out within this distance of opaque geometry
   * (`alpha_soft = alpha * clamp((z_scene - z_particle) / d_fade, 0, 1)`), discarding when fully
   * occluded. 0 = disabled (default): output stays byte-identical to the pre-soft material.
   * WEB_GL1 has no depth capture and degrades cleanly (no depth read).
   */
  softFadeDistance?: number | undefined;
  /**
   * Direction of the procedural volume light, in camera-aligned space (billboards face the
   * camera, so this is an artist-facing approximation). Normalized at construction. Only read
   * while `lightIntensity > 0`.
   * @domain lighting direction (normalized in camera-aligned space)
   */
  lightDirection?: Vector3D | undefined;
  /**
   * Strength of the procedural 6-way volume lighting (>=0). 0 = disabled (default): color stays
   * byte-identical to the pre-lighting material.
   * @domain volume-light intensity multiplier
   */
  lightIntensity?: number | undefined;
  /**
   * Ambient contribution of the procedural volume lighting, in [0,1]. Defaults to 1.
   * @domain volume-light ambient floor
   */
  ambientLight?: number | undefined;
  /**
   * How strongly the smoke density self-occludes the procedural light, in [0,1]. 0 = no
   * self-shadowing. Defaults to 0.5.
   * @domain directional self-shadow strength
   */
  selfShadowStrength?: number | undefined;
  /**
   * Henyey-Greenstein forward-scatter rim strength (>=0). 0 = no rim. Defaults to 1.2.
   * @domain HG rim brightness
   */
  rimStrength?: number | undefined;
  /**
   * Henyey-Greenstein asymmetry, in (-1, 1). >0 = forward scatter. Defaults to 0.6.
   * @domain HG phase-function asymmetry
   */
  forwardScatter?: number | undefined;
  /**
   * UV scale of the lighting density field (same noise family as the alpha churn). Defaults to 4.
   * @domain lighting-noise field scale
   */
  lightScale?: number | undefined;
  /**
   * How strongly the FBM density gradient tilts the pseudo-normal (bump slope). Defaults to 3.
   * @domain lighting-normal slope
   */
  lightSlope?: number | undefined;
}

/**
 * Alpha-blended soft smoke billboard for `FireSmokeEmitter`. Purely procedural (no texture): a soft
 * radial blob, roughened by a scrolling value-noise edge that grows harsher as the particle fades —
 * a dissolving plume, never a hard-edged quad. The per-instance buffer is read directly in the
 * fragment: r = lifetime-stable per-particle noise seed (g, b unused), a = opacity; the warm-lit → cold
 * dark tint is rebuilt from the opacity ramp (`tintStart`/`tintEnd`).
 * Because alpha is opacity here, the paired renderer must run with `foldAlphaIntoScale = false`.
 */
export class SmokeSpriteMaterial extends AbstractMaterial {
  public static readonly TYPE = "SmokeSpriteMaterial";

  /** @domain birth tint + opacity (ramp anchor). */
  public tintStart: Color;
  /** @domain death tint + opacity (ramp anchor). */
  public tintEnd: Color;
  /** @domain animation time in seconds, advanced by the owner every frame; pause freezes the plume. */
  public time: number;
  /** @domain churn strength (>=0); 0 = perfectly smooth puff. */
  public churn: number;
  /** @domain soft-particle fade distance in meters (0 = disabled); see options. */
  public softFadeDistance: number;
  /** @domain volume-light direction (normalized, camera-aligned space). */
  public lightDirection: Vector3D;
  /** @domain volume-light intensity (0 = disabled). */
  public lightIntensity: number;
  /** @domain ambient floor of the volume lighting ([0,1]). */
  public ambientLight: number;
  /** @domain directional self-shadow strength ([0,1]). */
  public selfShadowStrength: number;
  /** @domain HG forward-scatter rim strength (>=0). */
  public rimStrength: number;
  /** @domain HG phase-function asymmetry g in (-1, 1). */
  public forwardScatter: number;
  /** @domain lighting density-field UV scale (>0). */
  public lightScale: number;
  /** @domain lighting pseudo-normal slope (>0). */
  public lightSlope: number;

  constructor(options: SmokeSpriteMaterialOptions = {}) {
    super(SmokeSpriteMaterial.TYPE);
    this.tintStart = (options.tintStart ?? new Color(0.62, 0.58, 0.55, 0.36)).clone();
    this.tintEnd = (options.tintEnd ?? new Color(0.16, 0.15, 0.14, 0)).clone();
    this.time = options.time ?? 0;
    this.churn = options.churn ?? 1;
    this.softFadeDistance = Math.max(0, options.softFadeDistance ?? 0);
    this.lightDirection = new Vector3D(0, 0, 0)
      .copyFrom(options.lightDirection ?? DEFAULT_LIGHT_DIRECTION)
      .normalize();
    this.lightIntensity = Math.max(0, options.lightIntensity ?? 0);
    this.ambientLight = Math.min(1, Math.max(0, options.ambientLight ?? 1));
    this.selfShadowStrength = Math.min(1, Math.max(0, options.selfShadowStrength ?? 0.5));
    this.rimStrength = Math.max(0, options.rimStrength ?? 1.2);
    this.forwardScatter = Math.min(0.99, Math.max(-0.99, options.forwardScatter ?? 0.6));
    this.lightScale = Math.max(0.1, options.lightScale ?? 4);
    this.lightSlope = Math.max(0, options.lightSlope ?? 3);

    this.transparent = true;
    this.depthWrite = false;
    this.cullMode = CullMode.NONE;
  }

  /** @inheritdoc */
  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      this._renderManifest = this._createBaseManifest();
      this._renderManifest.properties["u_matParam0"] = [0, 0, 0, 0];
      this._renderManifest.properties["u_matParam1"] = [0, 0, 0, 0];
      this._renderManifest.properties["u_matParam2"] = [0, 0, 0, 0];
      this._renderManifest.properties["u_matParam3"] = [0, 0, 0, 0];
      this._renderManifest.properties["u_matParam4"] = [0, 0, 0, 0];
      this._renderManifest.properties["u_matParam6"] = [0, 0, 0, 0];
      const state = this._renderManifest.state!;
      // Straight-alpha smoke: the fragment alpha fades the quad out of existence.
      state.blending = BlendingMode.ALPHA;
      // CPU-side billboarding (ParticleMeshRenderer) cannot be reproduced by the shared depth
      // pre-pass pipeline — same exclusion as the flame and the ember sprites.
      state.skipDepthPrePass = true;
    }
    this._syncBaseManifestState();

    const props = this._renderManifest.properties;
    const p0 = props["u_matParam0"] as number[];
    p0[0] = this.time;
    p0[1] = this.churn;
    p0[2] = this.softFadeDistance;
    p0[3] = this.softFadeDistance > 0 ? 1 : 0;

    const p1 = props["u_matParam1"] as number[];
    p1[0] = this.lightDirection.x;
    p1[1] = this.lightDirection.y;
    p1[2] = this.lightDirection.z;
    p1[3] = this.lightIntensity;

    const p2 = props["u_matParam2"] as number[];
    p2[0] = this.ambientLight;
    p2[1] = this.selfShadowStrength;
    p2[2] = this.rimStrength;
    p2[3] = this.forwardScatter;

    const p3 = props["u_matParam3"] as number[];
    p3[0] = this.lightScale;
    p3[1] = this.lightSlope;
    p3[2] = this.lightIntensity > 0 ? 1 : 0;
    p3[3] = 0;

    const p4 = props["u_matParam4"] as number[];
    p4[0] = this.tintStart.r;
    p4[1] = this.tintStart.g;
    p4[2] = this.tintStart.b;
    p4[3] = this.tintStart.a;

    const p6 = props["u_matParam6"] as number[];
    p6[0] = this.tintEnd.r;
    p6[1] = this.tintEnd.g;
    p6[2] = this.tintEnd.b;
    p6[3] = this.tintEnd.a;

    return this._renderManifest;
  }

  /** @inheritdoc */
  public override getShaderDefinition(): ShaderDefinition {
    return {
      id: SmokeSpriteMaterial.TYPE,
      sources: {
        glsl300: { vs: "[BASE_VERTEX_HEADER][BASE_VERTEX_MAIN]", fs: fragGLSL },
        glsl100: { vs: "[BASE_VS]", fs: fragGLSL100 },
        wgsl: `[WGSL_STRUCTS]\n[WGSL_VS]\n${fragWGSL}`,
      },
      layout: {
        ...StandardWebGPULayout,
        textures: {
          // Declared so the renderers capture + bind the opaque scene depth (`u_opaqueDepthMap`),
          // consumed by the S2 soft-particle branch. WebGL1 falls back to its default far-depth
          // texture, which the GLSL100 variant never samples.
          u_opaqueDepthMap: { type: ShaderPropertyType.TEXTURE },
        },
      },
    };
  }
}
