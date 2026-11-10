#version 300 es
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

// ADR 0059 field lane (WebGL2): the frozen 16-byte instance record (INSTANCE_RECORD_LAYOUT)
// binds as `a_instancePos` (bytes 0..11, vec3 f32) + `a_instancePose` (bytes 12..15, u32 read
// via `vertexAttribIPointer`). Decode is the frozen bit layout (INSTANCE_POSE_BITS), bit-identical
// to the CPU packer `packInstancePose`, the cull unpack in `InstanceFieldGL` and the WebGPU pull
// shader `field_pull.wgsl`: yaw = [15:0] / 0xFFFF * 2pi around world +Y (toward +Z, right-handed,
// +X right, +Y up, +Z backward), uniformScale = [31:16] / 256. The pose matrix replaces `u_model`
// entirely; no material flag may put `a_instanceData`-driven outputs (v_texIndex/v_instanceColor)
// on a field program (the renderer strips TEXTURE_ARRAY/INSTANCE_COLOR from field flags).
#ifdef USE_INSTANCE_FIELD
in vec3 a_instancePos;
in uint a_instancePose;

// ADR 0059 step 1b wind field, single-sourced from the shared `vegetation-extras` chunk (same
// code the WGSL pull lane compiles). `u_windHeight` is the runtime master switch mirroring the
// WGSL `fieldInfo.windHeight` gate -- omitted/zero uniform keeps the lane fail-closed static.
// Struct-declaring chunk: the GL header owns the `SwmWind` type, so the full (not
// struct-stripped) registry variant is used.
[WIND_FIELD]

uniform SwmWind u_wind;
uniform float u_windHeight;

mat4 buildInstanceFieldMatrix(vec3 pos, uint packedPose) {
    float yaw = (float(packedPose & 0xFFFFu) / 65535.0) * 6.283185307179586;
    float scale = float(packedPose >> 16u) * (1.0 / 256.0);
    float c = cos(yaw);
    float s = sin(yaw);
    return mat4(
        scale * c, 0.0, scale * s, 0.0,
        0.0, scale, 0.0, 0.0,
        -scale * s, 0.0, scale * c, 0.0,
        pos.x, pos.y, pos.z, 1.0
    );
}
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
    float u_toneMappingMode; // forward tone curve (ToneMappingMode), 0 while post-processing owns it
    vec2 u_cameraNearFar;
    PointLight u_pointLights[16];
    SpotLight u_spotLights[16];
    // Must match MAX_AREA_LIGHTS in src/core/lights/AreaLight.ts -- GLSL can't import it, so this
    // has to be kept in sync by hand.
    AreaLight u_areaLights[4];
    vec2 u_tileSizePx;
    float u_toneMappingWhite; // forward REINHARD_EXTENDED white point (std140 gap before u_clusterDims)
    vec4 u_clusterDims;
};

uniform mat4 u_model;
uniform vec2 u_texOffset;
uniform vec2 u_texRepeat;
uniform float u_texRotation;

// Shadow Mapping
uniform mat4 u_spotShadowMatrix[4];
uniform vec4 u_spotShadowInfo[4]; // x=bias, y=normalBias, z=castShadow, w=pad

out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_uv;
out mat3 v_tbn;
out vec4 v_spotLightSpacePos[4];
