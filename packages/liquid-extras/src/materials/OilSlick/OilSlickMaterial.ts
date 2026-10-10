import {
  Color,
  StylizedWaterMaterial,
  StylizedWaterMaterialOptions,
  composeStylizedWaterSources,
  ShaderDefinition,
  RenderManifest,
} from "@small-world-machine/engine";
import { THIN_FILM_GLSL_DECL, THIN_FILM_WGSL_DECL } from "../../shading/thinFilm/thinFilm.js";

export interface OilSlickMaterialOptions extends StylizedWaterMaterialOptions {
  /** Strength of the rainbow sheen patches on the oil film, 0 = pure black oil (default 0.6, clamped to 0..1). */
  iridescenceStrength?: number;
}

/**
 * OilSlickMaterial implements a dark, viscous crude oil / petroleum surface on top of
 * StylizedWaterMaterial via compile-time extension hooks (ADR 0025). A smooth, domain-warped
 * flow noise drives the sparsely placed sheen patches through the canonical muted thin-film
 * interference model (`../../shading/thinFilm/thinFilm.ts`, KHR_materials_iridescence style, two-beam
 * approximation, desaturated via `strength` — see the style contract in that module). Only the
 * desaturated chroma of the physical tint leaks through, so the film stays dark and tar-like
 * instead of showing a bright saturated rainbow (Graphic-Noir style limit v2). The sheen is
 * strongest at grazing angles and around the sun reflection, so it behaves like a glossy film
 * instead of a decal. Hook-based sheen is suppressed inside shoreline foam.
 *
 * Uniform lane reuse (the style struct is full): `iridescenceStrength` travels in `u_styleA.w`
 * (lineWidth), ripple lines (lineDensity) and glitter are forced off. `specularStrength` is
 * clamped to 0.5 so the toon sun highlight cannot dominate a dark film.
 */
export class OilSlickMaterial extends StylizedWaterMaterial {
  public static readonly TYPE = "OilSlickMaterial";

  private _iridescenceStrength = 0.6;

  constructor(options: OilSlickMaterialOptions = {}) {
    const {
      shallowWaterColor = new Color(0.38, 0.34, 0.27),
      deepWaterColor = new Color(0.004, 0.003, 0.003),
      edgeColor = new Color(0.12, 0.09, 0.05),
      foamColor = new Color(0.02, 0.018, 0.015),
      foamCutoff = 0.9,
      causticStrength = 0.0,
      specularStrength = 0.3,
      rampSoftness = 0.2,
      washAmount = 0.4,
      foamSoftness = 0.05,
      waterAbsorption = [1.8, 1.5, 1.2],
      refractionStrength = 0.01,
      speed = 0.35,
      wave1 = [0.6, 0.3, 0.07, 2.5],
      wave2 = [0.2, 0.7, 0.05, 1.8],
      wave3 = [-0.3, 0.4, 0.03, 1.2],
      styleId = 3.0,
      iridescenceStrength = 0.6,
      ...rest
    } = options;

    super(
      {
        shallowWaterColor,
        deepWaterColor,
        edgeColor,
        foamColor,
        foamCutoff,
        causticStrength,
        specularStrength: Math.min(specularStrength, 0.5),
        rampSoftness,
        washAmount,
        foamSoftness,
        waterAbsorption,
        refractionStrength,
        speed,
        wave1,
        wave2,
        wave3,
        styleId,
        ...rest,
        style: "custom",
        lineDensity: 0.0, // lane reuse: ripple lines off
        lineWidth: 0.0,
        glitterStrength: 0.0, // lane reuse: glitter off
      },
      OilSlickMaterial.TYPE,
    );

    this.iridescenceStrength = iridescenceStrength;
  }

  public get iridescenceStrength(): number {
    return this._iridescenceStrength;
  }

  public set iridescenceStrength(value: number) {
    this._iridescenceStrength = Math.min(1, Math.max(0, value));
  }

  public override getRenderManifest(): RenderManifest {
    const manifest = super.getRenderManifest();
    this._styleAArray[3] = this._iridescenceStrength;
    return manifest;
  }

  protected override _getLiquidWaveShaderSources(): ShaderDefinition["sources"] {
    const glslDecl = `
    ${THIN_FILM_GLSL_DECL}
    float oilValueNoise(vec2 p) {
        vec2 c = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(waterHash(c), waterHash(c + vec2(1.0, 0.0)), f.x),
                   mix(waterHash(c + vec2(0.0, 1.0)), waterHash(c + vec2(1.0, 1.0)), f.x), f.y);
    }
    // Smooth domain-warped flow noise, slow like viscous liquid
    float oilFlowNoise(vec2 p, float t) {
        vec2 warp = vec2(oilValueNoise(p * 0.8 + vec2(t * 0.05, 3.1)), oilValueNoise(p * 0.8 + vec2(7.7, -t * 0.04)));
        vec2 q = p + (warp - 0.5) * 1.6;
        return oilValueNoise(q * 1.1 + t * 0.03) * 0.65 + oilValueNoise(q * 2.3 - t * 0.04) * 0.35;
    }
    `;

    const glslSurface = `
    // Dark oil film: muted physical thin-film sheen tied to fresnel and the sun reflection
    vec3 oilView = normalize(u_viewPos - v_worldPos);
    float oilCos = clamp(dot(v_normal, oilView), 0.0, 1.0);
    float oilFlow = oilFlowNoise(v_worldPos.xz * 0.6, u_time);
    float oilShadow = sampleDirShadow(v_worldPos, v_normal);
    float oilSun = pow(clamp(dot(reflect(-oilView, v_normal), normalize(u_dirLightDir)), 0.0, 1.0), 6.0) * oilShadow;
    vec3 oilSheen = oilFilmThinFilm(oilCos, oilFlow, u_styleA.w);
    float oilSheenLum = dot(oilSheen, vec3(0.299, 0.587, 0.114));
    // Chroma-leak only: amplify the desaturated physical tint gently so it reads on the
    // near-black film without flooding it; luma is dropped to keep the tar body dark.
    vec3 oilTint = max(oilSheen - oilSheenLum, 0.0) * 5.0;
    float oilMask = smoothstep(0.45, 0.8, oilFlow) * (0.2 + 0.8 * pow(1.0 - oilCos, 2.0) + 0.6 * oilSun);
    finalColor = mix(finalColor, finalColor + oilTint, clamp(oilMask, 0.0, 1.0) * u_styleA.w * (1.0 - finalShoreFoam));
    finalColor *= mix(0.5, 1.0, oilShadow);
    `;

    const wgslDecl = `
    ${THIN_FILM_WGSL_DECL}
    fn oilValueNoise(p: vec2<f32>) -> f32 {
        let c = floor(p);
        var f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(waterHash(c), waterHash(c + vec2<f32>(1.0, 0.0)), f.x),
                   mix(waterHash(c + vec2<f32>(0.0, 1.0)), waterHash(c + vec2<f32>(1.0, 1.0)), f.x), f.y);
    }
    fn oilFlowNoise(p: vec2<f32>, t: f32) -> f32 {
        let warp = vec2<f32>(oilValueNoise(p * 0.8 + vec2<f32>(t * 0.05, 3.1)), oilValueNoise(p * 0.8 + vec2<f32>(7.7, -t * 0.04)));
        let q = p + (warp - 0.5) * 1.6;
        return oilValueNoise(q * 1.1 + vec2<f32>(t * 0.03)) * 0.65 + oilValueNoise(q * 2.3 - vec2<f32>(t * 0.04)) * 0.35;
    }
    `;

    const wgslSurface = `
    let oilView = normalize(global.viewPos.xyz - i.wp);
    let oilCos = clamp(dot(i.n, oilView), 0.0, 1.0);
    let oilFlow = oilFlowNoise(i.wp.xz * 0.6, obj.time);
    let oilShadow = sampleDirShadow(i.wp, i.n);
    let oilSun = pow(clamp(dot(reflect(-oilView, i.n), normalize(global.dirLightDir.xyz)), 0.0, 1.0), 6.0) * oilShadow;
    let oilSheen = oilFilmThinFilm(oilCos, oilFlow, obj.styleA.w);
    let oilSheenLum = dot(oilSheen, vec3<f32>(0.299, 0.587, 0.114));
    // Chroma-leak only: amplify the desaturated physical tint gently so it reads on the
    // near-black film without flooding it; luma is dropped to keep the tar body dark.
    let oilTint = max(oilSheen - oilSheenLum, vec3<f32>(0.0)) * 5.0;
    let oilMask = smoothstep(0.45, 0.8, oilFlow) * (0.2 + 0.8 * pow(1.0 - oilCos, 2.0) + 0.6 * oilSun);
    finalColor = mix(finalColor, finalColor + oilTint, clamp(oilMask, 0.0, 1.0) * obj.styleA.w * (1.0 - finalShoreFoam));
    finalColor = finalColor * mix(0.5, 1.0, oilShadow);
    `;
    const baseSources = composeStylizedWaterSources({
      decl: glslDecl,
      surface: glslSurface,
    });
    const wgslSources = composeStylizedWaterSources({
      decl: wgslDecl,
      surface: wgslSurface,
    });

    const sources: ShaderDefinition["sources"] = {};
    if (baseSources.glsl300) sources.glsl300 = baseSources.glsl300;
    if (baseSources.glsl100) sources.glsl100 = baseSources.glsl100;
    if (wgslSources.wgsl) sources.wgsl = wgslSources.wgsl;
    return sources;
  }
}
