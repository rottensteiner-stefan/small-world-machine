import {
  Color,
  StylizedWaterMaterial,
  StylizedWaterMaterialOptions,
  composeStylizedWaterSources,
  ShaderDefinition,
  RenderManifest,
} from "@small-world-machine/engine";

export interface NoirWaterMaterialOptions extends StylizedWaterMaterialOptions {
  /** Number of ink tone levels, 2 = pure black/white, 3-6 = comic ink (default 4). Clamped to 2..8. */
  posterizeSteps?: number;
  /** Primary floating object world-space XZ position for concentric ink ripple rings. Default [-1.1, 1.1]. */
  rippleCenter?: [number, number];
  /** Secondary floating object world-space XZ position. Default [1.1, -0.9]. */
  rippleCenter2?: [number, number];
  /** Tertiary floating/dropping object world-space XZ position. Default [0.3, 0.2]. */
  rippleCenter3?: [number, number];
}

/**
 * NoirWaterMaterial demonstrates hook-based shader extension on top of
 * StylizedWaterMaterial without modifying or forking the engine core (ADR 0025).
 * The surface hook desaturates to luma, renders concentric white ink shockwaves with
 * variable-width stroke inking around floating objects, casts a directional ink contact shadow,
 * draws a crisp white meniscus shoreline, and quantizes the tone in perceptual (gamma) space
 * into `posterizeSteps` ink levels.
 *
 * Uniform lane reuse (the style struct is full):
 * - `u_styleA.xy`: `rippleCenter.xz` (floater 1 center)
 * - `u_styleA.z`: `rippleCenter2.x` (floater 2 X)
 * - `u_styleA.w`: `posterizeSteps` (lineWidth lane)
 * - `u_styleB.x`: `rippleCenter2.y` (floater 2 Z)
 * - `u_styleB.y`: `rippleCenter3.x` (floater 3 X)
 * - `u_styleB.z`: `rippleCenter3.y` (floater 3 Z)
 * - `u_styleB.w`: `styleId` (3.0)
 */
export class NoirWaterMaterial extends StylizedWaterMaterial {
  public static readonly TYPE = "NoirWaterMaterial";

  constructor(options: NoirWaterMaterialOptions = {}) {
    const {
      shallowWaterColor = new Color(0.92, 0.92, 0.92),
      deepWaterColor = new Color(0.08, 0.08, 0.1),
      edgeColor = new Color(0.95, 0.95, 0.95),
      foamColor = new Color(0.95, 0.95, 0.95),
      waterAbsorption = [0.08, 0.08, 0.08],
      causticStrength = 0.05,
      specularStrength = 0.35,
      rampSoftness = 0.1,
      washAmount = 0.1,
      foamSoftness = 0.02,
      skyTint = 0.08,
      foamDistance = 0.35,
      foamCutoff = 0.4,
      foamNoiseScale = 6.0,
      styleId = 3.0,
      posterizeSteps = 4,
      rippleCenter = [-1.1, 1.1],
      rippleCenter2 = [1.1, -0.9],
      rippleCenter3 = [0.3, 0.2],
      ...rest
    } = options;

    super(
      {
        shallowWaterColor,
        deepWaterColor,
        edgeColor,
        foamColor,
        waterAbsorption,
        causticStrength,
        specularStrength,
        rampSoftness,
        washAmount,
        foamSoftness,
        foamDistance,
        foamCutoff,
        foamNoiseScale,
        skyTint,
        styleId,
        ...rest,
        style: "custom",
        lineDensity: 0.0, // lane reuse: ripple lines off
        lineWidth: 0.0,
        glitterStrength: 0.0, // lane reuse: glitter off
      },
      NoirWaterMaterial.TYPE,
    );

    this.posterizeSteps = posterizeSteps;
    this._rippleCenter = [rippleCenter[0], rippleCenter[1]];
    this._rippleCenter2 = [rippleCenter2[0], rippleCenter2[1]];
    this._rippleCenter3 = [rippleCenter3[0], rippleCenter3[1]];
  }

  private _posterizeSteps = 4;
  private _rippleCenter: [number, number] = [-1.1, 1.1];
  private _rippleCenter2: [number, number] = [1.1, -0.9];
  private _rippleCenter3: [number, number] = [0.3, 0.2];

  public get posterizeSteps(): number {
    return this._posterizeSteps;
  }

  public set posterizeSteps(value: number) {
    this._posterizeSteps = Math.min(8, Math.max(2, Math.round(value)));
  }

  public get rippleCenter(): [number, number] {
    return [this._rippleCenter[0], this._rippleCenter[1]];
  }

  public set rippleCenter(value: [number, number]) {
    this._rippleCenter[0] = value[0];
    this._rippleCenter[1] = value[1];
  }

  public get rippleCenter2(): [number, number] {
    return [this._rippleCenter2[0], this._rippleCenter2[1]];
  }

  public set rippleCenter2(value: [number, number]) {
    this._rippleCenter2[0] = value[0];
    this._rippleCenter2[1] = value[1];
  }

  public get rippleCenter3(): [number, number] {
    return [this._rippleCenter3[0], this._rippleCenter3[1]];
  }

  public set rippleCenter3(value: [number, number]) {
    this._rippleCenter3[0] = value[0];
    this._rippleCenter3[1] = value[1];
  }

  public override getRenderManifest(): RenderManifest {
    const manifest = super.getRenderManifest();
    const styleA = this._styleAArray;
    styleA[0] = this._rippleCenter[0];
    styleA[1] = this._rippleCenter[1];
    styleA[2] = this._rippleCenter2[0];
    styleA[3] = this._posterizeSteps;

    const styleB = this._styleBArray;
    styleB[0] = this._rippleCenter2[1];
    styleB[1] = this._rippleCenter3[0];
    styleB[2] = this._rippleCenter3[1];
    styleB[3] = this.styleId;
    return manifest;
  }

  protected override _getLiquidWaveShaderSources(): ShaderDefinition["sources"] {
    const glslSurface = `
    // 1. Organic, undulating white Tusche meniscus along pool walls (Ufersaum)
    float shoreWarp = 0.012 * sin(v_worldPos.x * 7.5 + v_worldPos.z * 6.5) + 
                      0.007 * sin(v_worldPos.x * 15.0 - v_worldPos.z * 13.0);
    float shoreEdge = (1.0 - smoothstep(0.006, 0.036 + shoreWarp, depthDiff)) * 0.98;

    // 2. Fetter schwarzer Tusche-Kontaktschatten underneath floating objects
    vec2 sc1 = u_styleA.xy + vec2(0.12, 0.14);
    vec2 sc2 = vec2(u_styleA.z, u_styleB.x) + vec2(0.10, 0.12);
    vec2 sc3 = u_styleB.yz + vec2(0.12, 0.14);

    float sd1 = length((v_worldPos.xz - sc1) / vec2(0.85, 1.15));
    float sd2 = length((v_worldPos.xz - sc2) / vec2(0.95, 1.25));
    float sd3 = length((v_worldPos.xz - sc3) / vec2(0.85, 1.15));

    float cs1 = 1.0 - smoothstep(0.26, 0.36, sd1);
    float cs2 = 1.0 - smoothstep(0.30, 0.42, sd2);
    float cs3 = 1.0 - smoothstep(0.26, 0.36, sd3);
    float contactShadow = max(cs1, max(cs2, cs3));

    // 3. Dynamische weiße Tusche-Stoßwellen (concentric expanding G-pen wave arcs)
    float ripStroke = 0.0;
    for (int j = 0; j < 3; j++) {
      vec2 cj = j == 0 ? u_styleA.xy : (j == 1 ? vec2(u_styleA.z, u_styleB.x) : u_styleB.yz);
      vec2 dj = v_worldPos.xz - cj;
      float rj = length(dj);
      float aj = atan(dj.y, dj.x);

      for (int k = 0; k < 5; k++) {
        float fk = float(k);
        float fj = float(j);
        float age = fract(u_time * 0.22 + fk * 0.20 + fj * 0.33);

        // Expanding radius with subtle organic liquid perturbation
        float waveWarp = 0.035 * sin(3.0 * aj + fk * 1.7 + fj) + 0.02 * sin(6.0 * aj - fk * 2.1);
        float r0 = 0.34 + age * 2.15 + waveWarp;
        float dr = abs(rj - r0);

        // Angular harmonic wave for gapped arcs (Lücken)
        float phi = fk * 2.4 + fj * 1.8;
        float h = sin(2.0 * aj + phi) + 0.38 * sin(4.0 * aj - phi * 1.3);

        // Gap threshold rises with age (young = wide sweeping arc, old = broken dashes)
        float tau = mix(-0.30, 0.45, age);
        float taper = max(0.0, (h - tau) / (1.38 - tau));

        // Calligraphic stroke width: crest flattens/widens with age, needle-sharp tips
        float crestWidth = mix(0.034, 0.076, age);
        float strokeHalfW = crestWidth * pow(taper, 0.62);

        // Crisp anti-aliased comic stroke
        float arc = 1.0 - smoothstep(strokeHalfW * 0.65, strokeHalfW, dr);
        float ageFade = 1.0 - smoothstep(0.60, 0.96, age);
        float arcAlpha = step(0.001, strokeHalfW) * arc * ageFade;

        ripStroke = max(ripStroke, arcAlpha);
      }
    }

    // 4. Underwater floor contrast & depth gradient (sauberer Graustufen-Tiefenverlauf)
    // High dynamic range contrast expansion so the wave-refracted tile grid pops crisply:
    float rawLuma = dot(finalColor, vec3(0.299, 0.587, 0.114));
    float inkTone = smoothstep(0.04, 0.68, rawLuma);

    // Depth progression: deeper water gently attenuates into a deep noir atmosphere
    float depthAtten = clamp(depthDiff * 0.32, 0.0, 0.65);
    inkTone = mix(inkTone, inkTone * 0.42, depthAtten);

    // Apply deep contact shadow (cuts directly to solid black ink)
    inkTone = inkTone * (1.0 - contactShadow * 0.98);

    // Layer white ink shockwave rings (pure Tusche white)
    inkTone = max(inkTone, ripStroke * 0.98);

    // Layer wavy shoreline meniscus (pure Tusche white)
    inkTone = max(inkTone, shoreEdge);

    // Comic posterization into clean ink steps (rich graphic novel range)
    float inkSteps = max(u_styleA.w - 1.0, 1.0);
    float inkPosterized = floor(inkTone * inkSteps + 0.5) / inkSteps;
    finalColor = vec3(pow(inkPosterized, 2.2));
    `;

    const wgslSurface = `
    // 1. Organic, undulating white Tusche meniscus along pool walls (Ufersaum)
    let shoreWarp = 0.012 * sin(i.wp.x * 7.5 + i.wp.z * 6.5) + 
                    0.007 * sin(i.wp.x * 15.0 - i.wp.z * 13.0);
    let shoreEdge = (1.0 - smoothstep(0.006, 0.036 + shoreWarp, depthDiff)) * 0.98;

    // 2. Fetter schwarzer Tusche-Kontaktschatten underneath floating objects
    let sc1 = obj.styleA.xy + vec2<f32>(0.12, 0.14);
    let sc2 = vec2<f32>(obj.styleA.z, obj.styleB.x) + vec2<f32>(0.10, 0.12);
    let sc3 = obj.styleB.yz + vec2<f32>(0.12, 0.14);

    let sd1 = length((i.wp.xz - sc1) / vec2<f32>(0.85, 1.15));
    let sd2 = length((i.wp.xz - sc2) / vec2<f32>(0.95, 1.25));
    let sd3 = length((i.wp.xz - sc3) / vec2<f32>(0.85, 1.15));

    let cs1 = 1.0 - smoothstep(0.26, 0.36, sd1);
    let cs2 = 1.0 - smoothstep(0.30, 0.42, sd2);
    let cs3 = 1.0 - smoothstep(0.26, 0.36, sd3);
    let contactShadow = max(cs1, max(cs2, cs3));

    // 3. Dynamische weiße Tusche-Stoßwellen (concentric expanding G-pen wave arcs)
    var ripStroke: f32 = 0.0;
    for (var j: i32 = 0; j < 3; j = j + 1) {
      let fj = f32(j);
      var cj = obj.styleB.yz;
      if (j == 0) { cj = obj.styleA.xy; }
      if (j == 1) { cj = vec2<f32>(obj.styleA.z, obj.styleB.x); }
      let dj = i.wp.xz - cj;
      let rj = length(dj);
      let aj = atan2(dj.y, dj.x);

      for (var k: i32 = 0; k < 5; k = k + 1) {
        let fk = f32(k);
        let age = fract(obj.time * 0.22 + fk * 0.20 + fj * 0.33);

        // Expanding radius with subtle organic liquid perturbation
        let waveWarp = 0.035 * sin(3.0 * aj + fk * 1.7 + fj) + 0.02 * sin(6.0 * aj - fk * 2.1);
        let r0 = 0.34 + age * 2.15 + waveWarp;
        let dr = abs(rj - r0);

        // Angular harmonic wave for gapped arcs (Lücken)
        let phi = fk * 2.4 + fj * 1.8;
        let h = sin(2.0 * aj + phi) + 0.38 * sin(4.0 * aj - phi * 1.3);

        // Gap threshold rises with age (young = wide sweeping arc, old = broken dashes)
        let tau = mix(-0.30, 0.45, age);
        let taper = max(0.0, (h - tau) / (1.38 - tau));

        // Calligraphic stroke width: crest flattens/widens with age, needle-sharp tips
        let crestWidth = mix(0.034, 0.076, age);
        let strokeHalfW = crestWidth * pow(taper, 0.62);

        // Crisp anti-aliased comic stroke
        let arc = 1.0 - smoothstep(strokeHalfW * 0.65, strokeHalfW, dr);
        let ageFade = 1.0 - smoothstep(0.60, 0.96, age);
        let arcAlpha = select(0.0, arc * ageFade, strokeHalfW > 0.001);

        ripStroke = max(ripStroke, arcAlpha);
      }
    }

    // 4. Underwater floor contrast & depth gradient (sauberer Graustufen-Tiefenverlauf)
    // High dynamic range contrast expansion so the wave-refracted tile grid pops crisply:
    let rawLuma = dot(finalColor, vec3<f32>(0.299, 0.587, 0.114));
    var inkTone = smoothstep(0.04, 0.68, rawLuma);

    // Depth progression: deeper water gently attenuates into a deep noir atmosphere
    let depthAtten = clamp(depthDiff * 0.32, 0.0, 0.65);
    inkTone = mix(inkTone, inkTone * 0.42, depthAtten);

    // Apply deep contact shadow (cuts directly to solid black ink)
    inkTone = inkTone * (1.0 - contactShadow * 0.98);

    // Layer white ink shockwave rings (pure Tusche white)
    inkTone = max(inkTone, ripStroke * 0.98);

    // Layer wavy shoreline meniscus (pure Tusche white)
    inkTone = max(inkTone, shoreEdge);

    // Comic posterization into clean ink steps (rich graphic novel range)
    let inkSteps = max(obj.styleA.w - 1.0, 1.0);
    let inkPosterized = floor(inkTone * inkSteps + 0.5) / inkSteps;
    finalColor = vec3<f32>(pow(inkPosterized, 2.2));
    `;

    const baseSources = composeStylizedWaterSources({
      // WebGL1 has no depth texture, so the base stylized-water fragment never declares
      // `depthDiff` (it relies on fresnel/UV proxies for the shoreline). The full glsl300/`wgsl`
      // variants declare the real value from the opaque depth capture; only the glsl100 shader
      // needs a fallback so the extension surface compiles at all. `GL_ES_VERSION_3_0` is only
      // defined by GLSL ES 3.00, so this injection is a no-op on WebGL2 while fixing WebGL1.
      decl: `
#ifndef GL_ES_VERSION_3_0
        float depthDiff = 0.0;
#endif
`,
      surface: glslSurface,
    });
    const wgslSources = composeStylizedWaterSources({
      surface: wgslSurface,
    });

    const sources: ShaderDefinition["sources"] = {};
    if (baseSources.glsl300) sources.glsl300 = baseSources.glsl300;
    if (baseSources.glsl100) sources.glsl100 = baseSources.glsl100;
    if (wgslSources.wgsl) sources.wgsl = wgslSources.wgsl;
    return sources;
  }
}
