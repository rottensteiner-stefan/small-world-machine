uniform vec3 u_ambientColor;
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
