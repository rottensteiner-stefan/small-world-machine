#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DShadow;
precision highp sampler2DArray;
precision highp sampler2DArrayShadow;

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;
in mat3 v_tbn;

#if defined(USE_INSTANCING) && defined(USE_TEXTURE_ARRAY)
in float v_texIndex;
#endif

#ifdef USE_INSTANCE_COLOR
in vec4 v_instanceColor;
#endif

uniform vec4 u_color;
uniform vec4 u_specColor;
uniform float u_shininess;
uniform vec4 u_extraParams;

#ifdef USE_TEXTURE_ARRAY
uniform sampler2DArray u_diffuseMap;
#else
uniform sampler2D u_diffuseMap;
#endif
#ifdef USE_NORMAL_MAP
uniform sampler2D u_normalMap;
#endif
#ifdef USE_SPECULAR_MAP
uniform sampler2D u_specularMap;
#endif

// Global IBL Maps
#ifdef USE_IBL
uniform samplerCube u_irradianceMap;
uniform samplerCube u_prefilterMap;
uniform sampler2D u_brdfLUT;
uniform float u_envIntensity;
#endif

// Shadow Mapping
in vec4 v_spotLightSpacePos[4];
// One layer per spot slot (the first 4 sLights), same layout as the WebGPU texture_depth_2d_array.
uniform sampler2DArrayShadow u_spotShadowMap;
uniform vec4 u_spotShadowInfo[4]; // x=bias, y=normalBias, z=castShadow, w=pad

// Point-light shadows (ADR 0052): six 90 degree cube faces per shadow slot in layers
// 4 + slot * 6 + face of u_spotShadowMap. Light-space position is computed here from the world
// position (12 more varyings would not fit). Face matrices: slot * 6 + face.
uniform mat4 u_pointShadowMatrix[12];
uniform vec4 u_pointShadowInfo[2]; // x=bias, y=normalBias, z=u_pointLights index, w=castShadow

// Must match cubeFaceForDirection in core/lights/PointLightShadow.ts: major axis, ties X > Y > Z.
int pointShadowFace(vec3 d) {
    vec3 a = abs(d);
    if (a.x >= a.y && a.x >= a.z) return d.x >= 0.0 ? 0 : 1;
    if (a.y >= a.z) return d.y >= 0.0 ? 2 : 3;
    return d.z >= 0.0 ? 4 : 5;
}

// Shadow factor of point light `lightIndex` (1.0 = lit, exactly 1.0 when it has no shadow slot).
// worldPos/geomNormal are parameters because decals remap v_worldPos/v_normal after this header.
float pointShadowFactor(int lightIndex, vec3 lightPos, vec3 worldPos, vec3 geomNormal) {
    for (int s = 0; s < 2; s++) {
        vec4 info = u_pointShadowInfo[s];
        if (info.w < 0.5 || int(info.z + 0.5) != lightIndex) continue;
        int face = pointShadowFace(worldPos - lightPos);
        // Normal-offset bias scaled by 1 - NdotL, as for spot lights (base_vertex_main).
        vec3 n = normalize(geomNormal);
        vec3 toLight = lightPos - worldPos;
        float dist = length(toLight);
        float ndotl = max(dot(n, toLight / max(dist, 1e-4)), 0.0);
        // Cube faces use a 5 cm near plane, so a depth-space bias would grow to decimetres a few
        // metres out (shadows detach). Bias in metres toward the light instead: shadowBias plus
        // 1.5 shadow texels at this distance (ADR 0052).
        float texelWorld = 2.0 * dist / float(textureSize(u_spotShadowMap, 0).x);
        vec3 samplePos = worldPos + n * info.y * (1.0 - ndotl) + toLight / max(dist, 1e-4) * (info.x + 1.5 * texelWorld);
        vec4 ls = u_pointShadowMatrix[s * 6 + face] * vec4(samplePos, 1.0);
        vec3 projCoords = ls.xyz / ls.w * 0.5 + 0.5;
        if (projCoords.x < 0.0 || projCoords.x > 1.0 || projCoords.y < 0.0 || projCoords.y > 1.0 || projCoords.z > 1.0) return 1.0;
        float layer = float(4 + s * 6 + face);
        float ref = projCoords.z;
        vec2 texelSize = 1.0 / vec2(textureSize(u_spotShadowMap, 0).xy);
        float shadow = 0.0;
        for (int x = -1; x <= 1; ++x) {
            for (int y = -1; y <= 1; ++y) {
                shadow += texture(u_spotShadowMap, vec4(projCoords.xy + vec2(x, y) * texelSize, layer, ref));
            }
        }
        return shadow / 9.0;
    }
    return 1.0;
}

// Cascaded Shadow Maps
uniform sampler2DShadow u_dirShadowMap;
// Same depth texture as u_dirShadowMap, bound through a non-comparison sampler (TEXTURE_COMPARE_MODE
// = NONE) so PCSS's blocker-search step can read raw depth values instead of a 0/1 comparison result.
uniform sampler2D u_dirShadowMapRaw;
uniform mat4 u_cascadeMatrices[4];
uniform vec4 u_cascadeSplits;
uniform vec4 u_dirShadowInfo; // x=bias, y=normalBias, z=castShadow, w=numCascades
// E10 (P3): per-cascade normal-offset bias lanes, indexed by cascadeIndex (baked from k * texel
// size in DirectionalLight.updateCascades). y in u_dirShadowInfo is now reserved/no-op for
// directional shadows; only these lanes are used.
uniform vec4 u_dirShadowBias;
uniform vec4 u_shadowSoftness; // x=penumbra scale (quality.shadowSoftness), y=PCF radius cap in texels (quality.shadowMaxPcfRadius)

// EVSM (ADR 0043): the exponentially warped variance moment atlas (rgba32float, same cascade grid
// as u_dirShadowMap) and its tuning lanes. Only reached when u_evsmParams.x > 0.5
// (quality.shadowMode === "evsm"). The sampler and helpers exist only in the USE_EVSM program
// variant the renderer selects in that mode; the mode lane stays declared for the call sites.
uniform vec4 u_evsmParams; // x=mode flag (0/1), y=dynamic variance floor MULTIPLIER, z=LBR amount, w=receiver depth bias
#ifdef USE_EVSM
uniform sampler2D u_dirEVSMMap;

// One-tailed Chebyshev upper bound (Filament evaluateEVSM / chebyshevUpperBound): fully lit when
// the receiver is in front of the filtered caster mean, otherwise the variance bound hardened by
// the dynamic chain-rule floor `y * mean^2` (a flat floor is wrong -- the warp expands variance
// enormously) and by the light-bleeding-reduction remap. Must stay byte-identical to the WebGPU
// chebyshevUpperBoundEVSM in pbr_math.wgsl and to the moment writer EvsmMoment.frag.glsl.
float chebyshevUpperBoundEVSM(float m1, float m2, float depth) {
    if (depth <= m1) return 1.0;
    float rawVar = max(m2 - m1 * m1, 0.0);
    float variance = max(m2 - m1 * m1, u_evsmParams.y * m1 * m1);
    variance = max(rawVar, variance * 0.06);
    float d = depth - m1;
    float pMax = variance / max(variance + d * d, 1e-7);
    float lbr = clamp(u_evsmParams.z, 0.0, 0.999);
    return clamp((pMax - lbr) / max(1.0 - lbr, 1e-7), 0.0, 1.0);
}

// Evaluates the EVSM moments for this cascade's atlas cell (cell-clamped taps so a wide filter
// never bleeds into a neighboring cascade) against the receiver's [0,1] shadow depth. Same remap
// and warp (c = 40, d = depth * 2 - 1) as the moment writer EvsmMoment.frag.glsl; combines the
// positive and negative warped VSMs with min(p, n) exactly like the WebGPU getEVSM. The w lane is
// a tiny RECEIVER depth bias in this same [0,1] light-depth domain (three.js VSM adds the shadow
// bias to the receiver depth before evaluation): it pushes the receiver warp past the caster mean
// at the silhouette to counter peter-panning, and stays negligible on fully-lit receivers whose
// own depth is their caster mean (GPU Gems 3 §8.4.2 bias caution).
float evalEVSMDir(vec2 atlasUV, vec2 cellMin, vec2 cellMax, float currentDepth) {
    float pw = exp(40.0 * ((currentDepth + u_evsmParams.w) * 2.0 - 1.0));
    float nw = -1.0 / pw;
    vec4 rMoment = vec4(pw, pw * pw, nw, nw * nw);
    // Receiver-horizon-clamped two-slice moment filter + blocker-min gap blend (ADR 0043).
    // Byte-parallel with WebGPU getEVSM (pbr_math.wgsl): clamping non-blocking taps (`rawTap.x >= pw`)
    // to `rMoment` prevents far-plane clear texels (e^{40}) from exploding the positive warp or
    // pulling the negative warp mean above `nw` at the caster base (Peter-Panning / contact light
    // bleed), while `minPos` recovers the true occluder depth across the entire penumbra width and
    // the 5x5 wide kernel (step 4 texels) diffuses thin casters smoothly without stepping over them.
    const int EVSM_FILTER_RADIUS = 1;
    const int EVSM_WIDE_STEP = 4;
    const float EVSM_BLEND_DEPTH = 0.012;
    vec2 texel = 1.0 / vec2(textureSize(u_dirEVSMMap, 0));

    vec4 tight = vec4(0.0);
    float tightBlockerSum = 0.0;
    float tightBlockerCount = 0.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 tapUV = clamp(atlasUV + vec2(float(x * EVSM_FILTER_RADIUS), float(y * EVSM_FILTER_RADIUS)) * texel, cellMin, cellMax);
            vec4 rawTap = texture(u_dirEVSMMap, tapUV);
            if (rawTap.x < pw) {
                tightBlockerSum += rawTap.x;
                tightBlockerCount += 1.0;
            }
            tight += (rawTap.x >= pw) ? rMoment : rawTap;
        }
    }
    tight /= 9.0;

    vec4 wide = vec4(0.0);
    float wideBlockerSum = 0.0;
    float wideBlockerCount = 0.0;
    for (int y = -2; y <= 2; y++) {
        for (int x = -2; x <= 2; x++) {
            vec2 tapOffset = vec2(float(x * EVSM_WIDE_STEP + y), float(y * EVSM_WIDE_STEP - x));
            vec2 tapUV = clamp(atlasUV + tapOffset * texel, cellMin, cellMax);
            vec4 rawTap = texture(u_dirEVSMMap, tapUV);
            if (rawTap.x < pw) {
                wideBlockerSum += rawTap.x;
                wideBlockerCount += 1.0;
            }
            wide += (rawTap.x >= pw) ? rMoment : rawTap;
        }
    }
    wide /= 25.0;

    float pTight = min(
        chebyshevUpperBoundEVSM(tight.x, tight.y, pw),
        chebyshevUpperBoundEVSM(tight.z, tight.w, nw)
    );
    float pWide = min(
        chebyshevUpperBoundEVSM(wide.x, wide.y, pw),
        chebyshevUpperBoundEVSM(wide.z, wide.w, nw)
    );
    // True local occluder depth in [0,1] light-depth domain (exact inversion of the c = 40 warp
    // from the blocker-only mean, preferring the tight local neighborhood so the pole base stays at
    // gap ~ 0 and falling back to the wide blocker mean in the outer penumbra skirt).
    float blockerPos = pw;
    if (tightBlockerCount > 0.0) {
        blockerPos = tightBlockerSum / tightBlockerCount;
    } else if (wideBlockerCount > 0.0) {
        blockerPos = wideBlockerSum / wideBlockerCount;
    }
    float occluderDepth = (log(blockerPos) / 40.0 + 1.0) * 0.5;
    float gap = max(currentDepth + u_evsmParams.w - occluderDepth, 0.0);
    float blend = smoothstep(0.0015, EVSM_BLEND_DEPTH, gap);
    return mix(pTight, pWide, blend);
}
#else
// Default PCSS/PCF mode: no moment atlas sampler (one texture unit less in every lit program). The
// call sites only reach this behind u_evsmParams.x > 0.5, which the renderer never sets without
// USE_EVSM.
float evalEVSMDir(vec2 atlasUV, vec2 cellMin, vec2 cellMax, float currentDepth) {
    return 1.0;
}
#endif

// PCSS for the directional cascade atlas (evalPCSSDir, shared with dir_shadow.glsl).
[DIR_PCSS]

out vec4 fragColor;
// Sampling hooks of the lit chunk; Decal.frag.glsl redefines them to use explicit derivatives.
#define SAMPLE_NORMAL_MAP(uv) texture(u_normalMap, uv)
#define SAMPLE_EMISSIVE_MAP(uv) texture(u_emissiveMap, uv)
#ifdef USE_NORMAL_OUT
vec3 g_shadingNormal = vec3(0.0, 1.0, 0.0);
#endif
