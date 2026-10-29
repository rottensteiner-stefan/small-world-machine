#version 300 es
// FireMaterial vertex shader (GLSL 300 es), fully custom in the BlockMaterial style. The engine
// feeds every program the same GlobalUniforms std140 block and the per-draw u_model, so this file
// declares THAT block VERBATIM (structs + field order byte-identical to
// packages/engine/src/renderers/shaders/source/web_gl2/chunks/base_vertex_header.vert.glsl) and
// mirrors the base vertex main 1:1. The ONLY functional divergence is the world-space lean shear
// below — keep the rest in sync with base_vertex_header/base_vertex_main.
precision highp float;
precision highp int;

in vec3 a_position;
in vec3 a_normal;
in vec2 a_uv;
in vec4 a_tangent; // (tx, ty, tz, w), w = ±1 bitangent handedness (MikkTSpace/glTF)

#ifdef USE_SKINNING
in vec4 a_joints;
in vec4 a_weights;
uniform mat4 u_boneMatrices[64];
#endif

#ifdef USE_INSTANCING
in mat4 a_instanceMatrix;
in vec4 a_instanceData;
#ifdef USE_INSTANCE_COLOR
out vec4 v_instanceColor;
#endif
#ifdef USE_TEXTURE_ARRAY
out float v_texIndex;
#endif
#endif

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
uniform vec2 u_texOffset;
uniform vec2 u_texRepeat;
uniform vec4 u_matParam4; // [lean.xyz (world-space tip displacement in m), unused]

// Shadow Mapping
uniform mat4 u_spotShadowMatrix[4];
uniform vec4 u_spotShadowInfo[4]; // x=bias, y=normalBias, z=castShadow, w=pad

out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_uv;
out mat3 v_tbn;
out vec4 v_spotLightSpacePos[4];

void main() {
#ifdef USE_SKINNING
  mat4 skinMat =
      a_weights.x * u_boneMatrices[int(a_joints.x)] +
      a_weights.y * u_boneMatrices[int(a_joints.y)] +
      a_weights.z * u_boneMatrices[int(a_joints.z)] +
      a_weights.w * u_boneMatrices[int(a_joints.w)];

  vec4 localPos = skinMat * vec4(a_position, 1.0);
  vec3 localNormal = mat3(skinMat) * a_normal;
  vec3 localTangent = mat3(skinMat) * a_tangent.xyz;
#else
  vec4 localPos = vec4(a_position, 1.0);
  vec3 localNormal = a_normal;
  vec3 localTangent = a_tangent.xyz;
#endif

#ifdef USE_INSTANCING
  mat4 modelMat = u_model * a_instanceMatrix;
#ifdef USE_TEXTURE_ARRAY
  v_texIndex = a_instanceData.x;
#endif
#ifdef USE_INSTANCE_COLOR
  v_instanceColor = a_instanceData;
#endif
#else
  mat4 modelMat = u_model;
#endif

  vec4 wp = modelMat * localPos;
  // Height fraction for the world-space lean shear (the same expression the base main later uses
  // for v_uv, computed here before the shear so the vertex and fragment agree on "height").
  vec2 fireUv = (a_uv * u_texRepeat) + u_texOffset;
  // World-space fire lean shear (2b): displace along the world-space lean axis by the SQUARED height
  // fraction, so the base stays anchored and the tip leans. Applied to the world position, every
  // crossed card shears identically — the per-card fragment shear it replaces could not lean a card
  // perpendicular to the wind and visibly split the flame into two tongues.
  wp.xyz += u_matParam4.xyz * (fireUv.y * fireUv.y);
  v_worldPos = wp.xyz;
  vec3 computedNormal = mat3(modelMat) * localNormal;
  // Fallback only for a genuinely missing/zero vertex normal. The test must run on the LOCAL normal:
  // testing the transformed one made it depend on the mesh scale (a 0.008-scaled model has
  // |N|^2 = 6.4e-5 < 0.0001 and every normal collapsed to +Y).
  if (dot(localNormal, localNormal) < 0.0001 || dot(computedNormal, computedNormal) < 1e-20) {
    computedNormal = vec3(0.0, 1.0, 0.0);
  }
  v_normal = normalize(computedNormal);
  v_uv = fireUv;

  vec3 tangent = localTangent;
  // Bitangent handedness w = ±1: folded into B in the VERTEX stage (fragment/material
  // shaders reconstruct the TBN unmodified). Defaults to +1 when the tangent is zero or
  // absent, so mirrored-UV islands still get their sign from authored/derived data only.
  float bitangentSign = dot(tangent, tangent) < 0.0001 ? 1.0 : a_tangent.w;
  if (dot(tangent, tangent) < 0.0001) {
    if (abs(v_normal.y) < 0.999) {
      tangent = cross(v_normal, vec3(0, 1, 0));
    } else {
      tangent = cross(v_normal, vec3(1, 0, 0));
    }
  }

  vec3 T = normalize(mat3(modelMat) * tangent);
  vec3 N_v = v_normal;
  T = normalize(T - dot(T, N_v) * N_v);
  vec3 B = cross(N_v, T) * bitangentSign;
  v_tbn = mat3(T, B, N_v);

  gl_Position = u_vp * wp;

  // Shadow Maps Light Space Transforms
  for (int i = 0; i < 4; i++) {
    if (i >= u_numSpotLights) break;
    // Normal-offset bias, scaled by NdotL so grazing angles get the biggest offset (see
    // light_calc.frag.glsl's directional-light shadow for the same technique).
    vec3 spotL = normalize(u_spotLights[i].pos - wp.xyz);
    float spotNdotL = max(dot(v_normal, spotL), 0.0);
    vec3 spotShadowSamplePos = wp.xyz + v_normal * u_spotShadowInfo[i].y * (1.0 - spotNdotL);
    v_spotLightSpacePos[i] = u_spotShadowMatrix[i] * vec4(spotShadowSamplePos, 1.0);
  }
}
