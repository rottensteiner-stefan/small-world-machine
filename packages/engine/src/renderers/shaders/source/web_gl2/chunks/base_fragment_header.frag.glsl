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

out vec4 fragColor;
