#version 300 es
precision highp float;

in vec3 a_position;
in vec4 a_color;

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
uniform float u_time;

// u_matParam4: [waveSpeed, waveAmount, waveHeight, unused]
uniform vec4 u_matParam4;

out vec3 v_worldPos;
out vec4 v_color;

void main() {
    // Unity's _Time.z is 2 * t.
    float timeZ = u_time * 2.0;

    // Wave movement multiplied by the red vertex color (object-space X*Z diagonal).
    vec4 localPos = vec4(a_position, 1.0);
    localPos.y += sin(timeZ * u_matParam4.x + (a_position.x * a_position.z * u_matParam4.y))
        * u_matParam4.z * a_color.r;

    vec4 worldPos = u_model * localPos;
    v_worldPos = worldPos.xyz;
    v_color = a_color;
    gl_Position = u_vp * worldPos;
}
