#version 300 es
precision highp float;

in vec3 a_position;
in vec3 a_normal;
in vec2 a_uv;
in vec4 a_tangent;

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
    vec2 params;
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
    float u_toneMappingMode;
    vec2 u_cameraNearFar;
    PointLight u_pointLights[16];
    SpotLight u_spotLights[16];
    AreaLight u_areaLights[4];
    vec2 u_tileSizePx;
    float u_toneMappingWhite;
    vec4 u_clusterDims;
};

uniform mat4 u_model;
uniform vec4 u_matParam2; // [windDirX, windDirZ, waveScale, waveWavelength]
uniform vec4 u_matParam3; // [swellFadeStart, swellFadeEnd, foamCoverage, detailScale]
uniform float u_time;
uniform float u_reflectivity; // windSpeed

out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_uv;
out float v_crest;

const float OCEAN_PI = 3.14159265359;
const float OCEAN_G = 9.81;

vec2 rot2D(vec2 v, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

vec3 evalOceanWave(
    vec2 dir,
    float steepness,
    float wavelength,
    vec3 wp,
    float speed,
    float time,
    float phaseOffset,
    inout vec3 t,
    inout vec3 b
) {
    if (steepness <= 0.0001 || wavelength <= 0.001) {
        return vec3(0.0);
    }
    float k = (2.0 * OCEAN_PI) / wavelength;
    float c = sqrt(OCEAN_G / k) * speed;
    vec2 perp = vec2(-dir.y, dir.x);
    float groupEnv = 0.78 + 0.22 * cos(dot(wp.xz, perp) * (k * 0.19) + time * 0.28 + phaseOffset);
    float amp = (steepness / k) * groupEnv;
    float f = k * (dot(dir, wp.xz) - c * time) + phaseOffset;
    float sinF = sin(f);
    float cosF = cos(f);
    float q = clamp(steepness * groupEnv, 0.0, 0.85);

    t += vec3(
        -dir.x * dir.x * (q * sinF),
        dir.x * (q * cosF),
        -dir.x * dir.y * (q * sinF)
    );
    b += vec3(
        -dir.x * dir.y * (q * sinF),
        dir.y * (q * cosF),
        -dir.y * dir.y * (q * sinF)
    );

    return vec3(
        dir.x * (amp * cosF),
        amp * sinF,
        dir.y * (amp * cosF)
    );
}

void main() {
    float time = u_time;
    float speed = u_reflectivity;
    vec2 rawWind = u_matParam2.xy;
    float windLen = length(rawWind);
    vec2 windDir = (windLen > 1e-4) ? (rawWind / windLen) : vec2(0.84, 0.54);
    float waveScale = max(u_matParam2.z, 0.0);
    float lambda = max(u_matParam2.w, 2.0);
    float fadeStart = u_matParam3.x;
    float fadeEnd = max(u_matParam3.y, fadeStart + 1.0);

    vec3 wp = (u_model * vec4(a_position, 1.0)).xyz;
    float radialDist = length(wp.xz - u_viewPos.xz);
    float swellFade = 1.0 - smoothstep(fadeStart, fadeEnd, radialDist);

    vec3 t = vec3(1.0, 0.0, 0.0);
    vec3 b = vec3(0.0, 0.0, 1.0);
    vec3 disp = vec3(0.0);

    disp += evalOceanWave(windDir,               0.19 * waveScale * swellFade, lambda,        wp, speed, time, 0.0,  t, b);
    disp += evalOceanWave(rot2D(windDir,  0.42), 0.16 * waveScale * swellFade, lambda * 0.64, wp, speed, time, 1.37, t, b);
    disp += evalOceanWave(rot2D(windDir, -0.58), 0.13 * waveScale * swellFade, lambda * 0.43, wp, speed, time, 2.91, t, b);
    disp += evalOceanWave(rot2D(windDir,  1.17), 0.10 * waveScale * swellFade, lambda * 0.27, wp, speed, time, 4.13, t, b);
    disp += evalOceanWave(rot2D(windDir, -1.40), 0.08 * waveScale * swellFade, lambda * 0.17, wp, speed, time, 5.48, t, b);

    wp += disp;
    v_worldPos = wp;
    gl_Position = u_vp * vec4(wp, 1.0);

    vec3 waveN = normalize(cross(b, t));
    v_normal = normalize(mix(vec3(0.0, 1.0, 0.0), waveN, swellFade));
    v_uv = a_uv;

    float jacobian = t.x * b.z - t.z * b.x;
    float heightMetric = clamp(disp.y / max(waveScale * 1.4, 0.15), 0.0, 1.0);
    float pinchMetric = clamp((1.0 - jacobian) * 1.4, 0.0, 1.0);
    v_crest = clamp((heightMetric * 0.65 + pinchMetric * 0.55) * swellFade, 0.0, 1.0);
}
