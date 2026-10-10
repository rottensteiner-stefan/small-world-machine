#version 300 es
precision highp float;

in vec3 a_position;
in vec3 a_normal;
in vec2 a_uv;
in vec3 a_tangent;

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
uniform vec4 u_extraParams;   // wave1: [dirX, dirY, steepness (Q), wavelength]
uniform vec4 u_liquidParams;  // wave2: [dirX, dirY, steepness (Q), wavelength]
uniform vec4 u_thresholds;    // wave3: [dirX, dirY, steepness (Q), wavelength]
uniform float u_time;
uniform float u_reflectivity; // speed multiplier

out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_uv;

[LIQUID_GERSTNER_WAVE]

void main() {
    float time = u_time;
    float speed = u_reflectivity;

    vec4 worldPosInit = u_model * vec4(a_position, 1.0);
    vec3 wp = worldPosInit.xyz;

    vec4 w1 = u_extraParams;
    vec4 w2 = u_liquidParams;
    vec4 w3 = u_thresholds;
    vec4 w4 = vec4(w1.y, -w1.x, w1.z * 0.45, w1.w * 0.42); // Detail wave 1 (perpendicular)
    vec4 w5 = vec4(-w2.y, w2.x, w2.z * 0.35, w2.w * 0.35); // Detail wave 2
    vec4 w6 = vec4(w1.x * 0.5 - w1.y * 0.866, w1.x * 0.866 + w1.y * 0.5, w1.z * 0.25, w1.w * 0.22); // Bimodal 60-deg cross-swell

    vec3 t = vec3(1.0, 0.0, 0.0);
    vec3 b = vec3(0.0, 0.0, 1.0);
    vec3 displacement = vec3(0.0);

    displacement += gerstnerWave(w1, wp, speed, time, t, b);
    displacement += gerstnerWave(w2, wp, speed, time, t, b);
    if (w3.w > 0.001) {
        displacement += gerstnerWave(w3, wp, speed, time, t, b);
    }
    displacement += gerstnerWave(w4, wp, speed, time, t, b);
    displacement += gerstnerWave(w5, wp, speed, time, t, b);
    displacement += gerstnerWave(w6, wp, speed, time, t, b);

    wp += displacement;
    v_worldPos = wp;
    gl_Position = u_vp * vec4(wp, 1.0);

    v_uv = a_uv;
    v_normal = normalize(cross(b, t));
}
