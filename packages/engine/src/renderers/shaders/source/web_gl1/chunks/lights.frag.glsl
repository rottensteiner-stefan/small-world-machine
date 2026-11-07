uniform vec3 u_ambientColor;
uniform float u_envIntensity;
// A03: forward exposure gain (1.0 while the post pass owns exposure, quality exposure otherwise).
uniform float u_exposure;
// Forward tone curve (ToneMappingMode), see forwardToneMap below.
uniform float u_toneMappingMode;
#ifdef USE_BRDF_LUT
uniform sampler2D u_brdfLUT;
#endif
uniform vec3 u_dirLightColor;
uniform vec3 u_dirLightDir;

uniform int u_numPointLights;
uniform vec3 u_pointLightPos[16];
uniform vec3 u_pointLightColor[16];
uniform float u_pointLightDistance[16];
uniform float u_pointLightDecay[16];

uniform int u_numSpotLights;
uniform vec3 u_spotLightPos[16];
uniform vec3 u_spotLightDir[16];
uniform vec3 u_spotLightColor[16];
uniform vec4 u_spotLightParams[16];

uniform int u_numAreaLights;
uniform vec3 u_areaLightPos[4];
uniform vec3 u_areaLightColor[4];
uniform vec3 u_areaLightRight[4];
uniform vec3 u_areaLightUp[4];
uniform vec3 u_areaLightNormal[4];
uniform vec2 u_areaLightSize[4];
uniform vec2 u_areaLightParams[4]; // G06: x = maxDist (0 = infinite), y = decay -- WebGL1-renderer upload, area range windowing


// Accessors the shared GLASS_PBR_LOOPS chunk reads lights through (GLSL100: plain uniform arrays).
#define GLASS_POINT_POS(i) u_pointLightPos[i]
#define GLASS_POINT_COLOR(i) u_pointLightColor[i]
#define GLASS_POINT_RANGE(i) u_pointLightDistance[i]
#define GLASS_POINT_DECAY(i) u_pointLightDecay[i]
#define GLASS_SPOT_POS(i) u_spotLightPos[i]
#define GLASS_SPOT_DIR(i) u_spotLightDir[i]
#define GLASS_SPOT_COLOR(i) u_spotLightColor[i]
#define GLASS_SPOT_PARAMS(i) u_spotLightParams[i]

// Forward tone curve (quality.toneMapping as ToneMappingMode: 0 none, 1 Reinhard, 2 Cineon, 3 ACES
// filmic), applied after exposure, before linearToSRGB. WebGL1's forward pass is always final.
vec3 forwardToneMap(vec3 c) {
    if (u_toneMappingMode < 0.5) return c;
    if (u_toneMappingMode < 1.5) return c / (c + vec3(1.0));
    if (u_toneMappingMode < 2.5) {
        // Hejl/Burgess-Dawson filmic fit: its output already carries the 2.2 display encode.
        vec3 m = max(vec3(0.0), c - vec3(0.004));
        return pow((m * (6.2 * m + 0.5)) / (m * (6.2 * m + 1.7) + 0.06), vec3(2.2));
    }
    return clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0); // ACES (Narkowicz)
}
