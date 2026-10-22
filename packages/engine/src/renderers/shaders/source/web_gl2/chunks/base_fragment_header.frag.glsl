#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DShadow;
precision highp sampler2DArray;

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
uniform sampler2DShadow u_spotShadowMap[4];
uniform vec4 u_spotShadowInfo[4]; // x=bias, y=normalBias, z=castShadow, w=pad

// Cascaded Shadow Maps
uniform sampler2DShadow u_dirShadowMap;
// Same depth texture as u_dirShadowMap, bound through a non-comparison sampler (TEXTURE_COMPARE_MODE
// = NONE) so PCSS's blocker-search step can read raw depth values instead of a 0/1 comparison result.
uniform sampler2D u_dirShadowMapRaw;
uniform mat4 u_cascadeMatrices[4];
uniform vec4 u_cascadeSplits;
uniform vec4 u_dirShadowInfo; // x=bias, y=normalBias, z=castShadow, w=numCascades

// EVSM (ADR 0007): the exponentially warped variance moment atlas (rgba32float, same cascade grid
// as u_dirShadowMap) and its tuning lanes. Only reached when u_evsmParams.x > 0.5
// (quality.shadowMode === "evsm"); with the default PCSS/pcf mode these uniforms are inert but
// must stay bound (the renderer always binds u_dirEVSMMap, at least to a dummy) because the
// helpers below reference the sampler, which makes it active in every lit program.
uniform sampler2D u_dirEVSMMap;
uniform vec4 u_evsmParams; // x=mode flag (0/1), y=dynamic variance floor MULTIPLIER, z=LBR amount, w=reserved

// One-tailed Chebyshev upper bound (Filament evaluateEVSM / chebyshevUpperBound): fully lit when
// the receiver is in front of the filtered caster mean, otherwise the variance bound hardened by
// the dynamic chain-rule floor `y * mean^2` (a flat floor is wrong -- the warp expands variance
// enormously) and by the light-bleeding-reduction remap. Must stay byte-identical to the WebGPU
// chebyshevUpperBoundEVSM in pbr_math.wgsl and to the moment writer EvsmMoment.frag.glsl.
float chebyshevUpperBoundEVSM(float m1, float m2, float depth) {
    if (depth <= m1) return 1.0;
    float variance = max(m2 - m1 * m1, u_evsmParams.y * m1 * m1);
    float d = depth - m1;
    float pMax = variance / max(variance + d * d, 1e-7);
    float lbr = clamp(u_evsmParams.z, 0.0, 0.999);
    return clamp((pMax - lbr) / max(1.0 - lbr, 1e-7), 0.0, 1.0);
}

// Evaluates the EVSM moments for this cascade's atlas cell (cell-clamped taps so a wide filter
// never bleeds into a neighboring cascade) against the receiver's [0,1] shadow depth. Same remap
// and warp (c = 40, d = depth * 2 - 1) as the moment writer EvsmMoment.frag.glsl; combines the
// positive and negative warped VSMs with min(p, n) exactly like the WebGPU getEVSM.
float evalEVSMDir(vec2 atlasUV, vec2 cellMin, vec2 cellMax, float currentDepth) {
    float pw = exp(40.0 * (currentDepth * 2.0 - 1.0));
    float nw = -1.0 / pw;
    vec2 texel = 1.0 / vec2(textureSize(u_dirEVSMMap, 0));
    vec4 moments = vec4(0.0);
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 tapUV = clamp(atlasUV + vec2(float(x), float(y)) * texel, cellMin, cellMax);
            moments += texture(u_dirEVSMMap, tapUV);
        }
    }
    moments /= 9.0;
    return min(
        chebyshevUpperBoundEVSM(moments.x, moments.y, pw),
        chebyshevUpperBoundEVSM(moments.z, moments.w, nw)
    );
}

out vec4 fragColor;
// Sampling hooks of the lit chunk; Decal.frag.glsl redefines them to use explicit derivatives.
#define SAMPLE_NORMAL_MAP(uv) texture(u_normalMap, uv)
#define SAMPLE_EMISSIVE_MAP(uv) texture(u_emissiveMap, uv)
#ifdef USE_NORMAL_OUT
vec3 g_shadingNormal = vec3(0.0, 1.0, 0.0);
#endif
