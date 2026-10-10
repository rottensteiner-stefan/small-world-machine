#version 300 es
precision highp float;

in vec3 a_position;
in vec3 a_normal;
in vec2 a_uv;
in vec3 a_tangent;

// GLSL ES 3.00 requires an interface block to have IDENTICAL member layout in every stage it's
// used in (a WebGL2/ANGLE link error otherwise: "Field numbers of uniform block ... differ
// between VERTEX and FRAGMENT shaders") -- only u_vp is actually read below, but this block must
// still mirror the *entire* GlobalUniforms declaration the fragment shader gets from its
// LIGHT_DEFS chunk placeholder (see lights.frag.glsl) byte-for-byte, unused light arrays included.
struct PointLight {
    vec3 pos;
    float distance;
    vec3 color;
    float decay;
};

struct SpotLight {
    vec3 pos;
    float _pad;
    vec3 dir;
    float _pad2;
    vec3 color;
    float _pad3;
    vec4 params;
};

struct AreaLight {
    vec3 pos;
    float _pad;
    vec3 color;
    float _pad2;
    vec3 right;
    float _pad3;
    vec3 up;
    float _pad4;
    vec3 normal;
    float _pad5;
    vec2 size;
    vec2 params; // x: distance, y: decay
};

layout(std140) uniform GlobalUniforms {
    mat4 u_vp;
    vec3 u_viewPos;
    int _pad0;
    vec3 u_ambientColor;
    int _pad1;
    vec3 u_dirLightColor;
    int _pad2;
    vec3 u_dirLightDir;
    int _pad3;
    int u_numPointLights;
    int u_numSpotLights;
    int u_numAreaLights;
    float u_gamma;
    float u_exposure;
    float _pad4;
    vec2 u_cameraNearFar;
    PointLight u_pointLights[16];
    SpotLight u_spotLights[16];
    AreaLight u_areaLights[4];
    vec2 u_tileSizePx;
    vec4 u_clusterDims;
};

uniform mat4 u_model;
uniform vec4 u_extraParams;
uniform vec4 u_liquidParams;
uniform vec4 u_thresholds;
uniform vec4 u_styleA;
uniform vec4 u_matParam2;
uniform float u_time;
uniform float u_reflectivity;

out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_uv;
out float v_crest;

[LIQUID_GERSTNER_WAVE]

void main() {
    float time = u_time;
    float speed = u_reflectivity;

    vec4 worldPosInit = u_model * vec4(a_position, 1.0);
    vec3 wp = worldPosInit.xyz;

    vec4 w1 = u_extraParams;
    vec4 w2 = u_liquidParams;
    vec4 w3 = u_thresholds;
    vec4 w4 = vec4(w1.y, -w1.x, w1.z * 0.45, w1.w * 0.42); // Detail wave 1 (perpendicular, shorter)
    vec4 w5 = vec4(-w2.y, w2.x, w2.z * 0.35, w2.w * 0.35); // Detail wave 2
    vec4 w6 = vec4(w1.x * 0.5 - w1.y * 0.866, w1.x * 0.866 + w1.y * 0.5, w1.z * 0.25, w1.w * 0.22); // Bimodal 60-deg cross-swell

    vec3 t = vec3(1.0, 0.0, 0.0);
    vec3 b = vec3(0.0, 0.0, 1.0);
    vec3 displacement = vec3(0.0);

    displacement += gerstnerWave(w1, wp, speed, time, t, b);
    displacement += gerstnerWave(w2, wp, speed, time, t, b);
    displacement += gerstnerWave(w3, wp, speed, time, t, b);
    displacement += gerstnerWave(w4, wp, speed, time, t, b);
    displacement += gerstnerWave(w5, wp, speed, time, t, b);
    displacement += gerstnerWave(w6, wp, speed, time, t, b);

    // S2 SurfaceRippleField (Splat-Lane): single active impact ring wave
    float splatAge = time - u_styleA.z;
    if (splatAge >= 0.0 && splatAge < 4.0 && u_styleA.w > 0.0) {
        vec2 splatCenter = u_styleA.xy;
        float splatDist = length(wp.xz - splatCenter);
        float rippleRadius = splatAge * 3.5;
        float ringDist = splatDist - rippleRadius;
        float ringWidth = 0.8;
        float ringMask = exp(-ringDist * ringDist / (ringWidth * ringWidth));
        float ringDecay = exp(-splatAge * 1.2) * u_styleA.w;
        float rippleDisp = sin(ringDist * 8.0) * ringMask * ringDecay * 0.15;
        displacement.y += rippleDisp;
        vec2 dir = (splatDist > 0.001) ? (wp.xz - splatCenter) / splatDist : vec2(1.0, 0.0);
        t.y += rippleDisp * dir.x * 4.0;
        b.y += rippleDisp * dir.y * 4.0;
    }

    // S3 Clapotis (Analytical Wall Reflection): the dominant wave w1 reflects off the vertical
    // walls of a square basin centred on the world origin; half extent in matParam2.w, 0 = off.
    float poolHalfExtent = u_matParam2.w;
    bool wallsActive = poolHalfExtent > 0.0;
    float wallDistX = poolHalfExtent - abs(wp.x);
    float wallDistZ = poolHalfExtent - abs(wp.z);
    if (wallsActive && wallDistX < 1.5 && wallDistX > -0.5) {
        vec2 wallNorm = vec2(-sign(wp.x), 0.0);
        vec2 dRef = w1.xy - 2.0 * dot(w1.xy, wallNorm) * wallNorm;
        vec4 wRef = vec4(dRef, w1.z * 0.85, w1.w);
        float wallTrap = smoothstep(1.5, 0.0, wallDistX);
        displacement += gerstnerWave(wRef, wp, speed, time, t, b) * wallTrap;
    }
    if (wallsActive && wallDistZ < 1.5 && wallDistZ > -0.5) {
        vec2 wallNorm = vec2(0.0, -sign(wp.z));
        vec2 dRef = w1.xy - 2.0 * dot(w1.xy, wallNorm) * wallNorm;
        vec4 wRef = vec4(dRef, w1.z * 0.85, w1.w);
        float wallTrap = smoothstep(1.5, 0.0, wallDistZ);
        displacement += gerstnerWave(wRef, wp, speed, time, t, b) * wallTrap;
    }

    wp += displacement;
    v_worldPos = wp;
    gl_Position = u_vp * vec4(wp, 1.0);

    // Crest foam metric: horizontal Jacobian of the Gerstner displacement, J = Tx*Bz - Tz*Bx
    // (t/b are dP/dx, dP/dz). J < 1 means the surface is compressed (wave crest pinching),
    // J <= 0 means folding. Normalised by the summed steepness so the 0..1 range is
    // preset-independent; carried as a varying (no new uniforms -- ADR 0013 layout is full).
    float steepSum = w1.z + w2.z + w3.z + w4.z + w5.z + w6.z;
    float jacobian = t.x * b.z - t.z * b.x;
    v_crest = clamp(2.5 * (1.0 - jacobian) / max(steepSum, 0.001), -1.0, 1.0);

    v_uv = a_uv;
    v_normal = normalize(cross(b, t));
}
