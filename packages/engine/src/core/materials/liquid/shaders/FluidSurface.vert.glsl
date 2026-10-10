#version 300 es
in vec3 a_position;
in vec2 a_uv;
in vec3 a_normal;

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
    // Must match MAX_AREA_LIGHTS in src/core/lights/AreaLight.ts -- GLSL can't import it, so this
    // has to be kept in sync by hand.
    AreaLight u_areaLights[4];
    vec2 u_tileSizePx;
    vec4 u_clusterDims;
};

uniform mat4 u_model;
uniform vec4 u_extraParams; // [intensity, time, flowSpeed, noiseScale]
uniform vec4 u_liquidParams; // [waveFreq, waveAmp, emissive.g, emissive.b]

out vec2 v_uv;
out vec3 v_worldPos;
out vec3 v_normal;

void main() {
    v_uv = a_uv;
    vec3 pos = a_position;
    
    float time = u_extraParams.y;
    float flowSpeed = u_extraParams.z;
    float waveFrequency = u_liquidParams.x;
    float waveAmplitude = u_liquidParams.y;

    vec4 worldPos = u_model * vec4(pos, 1.0);
    float displacementSpeed = time * flowSpeed * 0.5;
    
    // Wave based on world coordinates for seamless tiling
    float px = worldPos.x * waveFrequency + displacementSpeed;
    float pz = worldPos.z * waveFrequency + displacementSpeed;
    float wave = sin(px) * cos(pz) * waveAmplitude;
    pos.y += wave;
    // Analytic slope of the wave above -- tilts the normal so the fragment stage can light it.
    vec2 slope = vec2(cos(px) * cos(pz), -sin(px) * sin(pz)) * (waveAmplitude * waveFrequency);

    // Re-calculate worldPos with displacement
    worldPos = u_model * vec4(pos, 1.0);
    v_worldPos = worldPos.xyz;
    v_normal = normalize((u_model * vec4(a_normal, 0.0)).xyz - vec3(slope.x, 0.0, slope.y));
    gl_Position = u_vp * worldPos;
}
