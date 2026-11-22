attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec2 a_uv;
attribute vec4 a_tangent; // (tx, ty, tz, w), w = ±1 bitangent handedness (MikkTSpace/glTF)

#ifdef USE_SKINNING
attribute vec4 a_joints;
attribute vec4 a_weights;
uniform mat4 u_boneMatrices[64];
#endif

#ifdef USE_INSTANCING
attribute mat4 a_instanceMatrix;
#ifdef USE_INSTANCE_COLOR
attribute vec4 a_instanceData;
varying vec4 v_instanceColor;
#endif
#endif

// ADR 0059 field lane (WebGL1): WebGL1 has NO integer attributes, so the frozen 16-byte record's
// packed pose word is replaced by an unpacked f32 companion fill (yaw/scale as two float
// attributes) produced by `InstanceFieldGL` from the engine's own `unpackInstancePose`; the record
// storage stays byte-identical on every tier. The pose decode matches the frozen bit layout
// (INSTANCE_POSE_BITS) and the WebGL2/WGSL lanes: yaw around world +Y (toward +Z, right-handed),
// uniform scale prototype-relative.
#ifdef USE_INSTANCE_FIELD
attribute vec3 a_instancePos;
attribute float a_instanceYaw;
attribute float a_instanceScale;

mat4 buildInstanceFieldMatrix(vec3 pos, float yaw, float scale) {
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

uniform mat4 u_vp;
uniform mat4 u_model;
uniform vec2 u_texOffset;
uniform vec2 u_texRepeat;
uniform float u_texRotation;

#ifdef USE_UV1
attribute vec2 a_uv1;
varying vec2 v_uv1;
#endif

varying vec3 v_worldPos;
varying vec3 v_normal;
varying vec2 v_uv;
varying vec2 v_uv0;
varying mat3 v_tbn;
varying vec4 v_clipPos;

mat3 extractMat3(mat4 m) {
    return mat3(m[0].xyz, m[1].xyz, m[2].xyz);
}

mat3 cofactor3(mat3 m) {
    return mat3(
        cross(m[1], m[2]),
        cross(m[2], m[0]),
        cross(m[0], m[1])
    );
}

void main() {
    float skinSign = 1.0;
#ifdef USE_INSTANCE_FIELD
    mat4 modelMat = buildInstanceFieldMatrix(a_instancePos, a_instanceYaw, a_instanceScale);
#else
#ifdef USE_INSTANCING
    mat4 modelMat = u_model * a_instanceMatrix;
#ifdef USE_INSTANCE_COLOR
    v_instanceColor = a_instanceData;
#endif
#else
    mat4 modelMat = u_model;
#endif
#endif
#ifdef USE_SKINNING
    // GPU skinning, mirroring the web_gl2 / web_gpu vertex stages: linear blend of the four
    // bound joint matrices, with zero-sum fallback (AN05) and cofactor3 normal transform (AN06).
    vec4 localPos = vec4(a_position, 1.0);
    vec3 localNormal = a_normal;
    vec3 localTangent = a_tangent.xyz;
    float weightSum = a_weights.x + a_weights.y + a_weights.z + a_weights.w;
    if (weightSum > 1e-4) {
        mat4 skinMat =
            (a_weights.x * u_boneMatrices[int(a_joints.x)] +
            a_weights.y * u_boneMatrices[int(a_joints.y)] +
            a_weights.z * u_boneMatrices[int(a_joints.z)] +
            a_weights.w * u_boneMatrices[int(a_joints.w)]) * (1.0 / weightSum);
        localPos = skinMat * vec4(a_position, 1.0);
        mat3 skinMat3 = extractMat3(skinMat);
        mat3 skinCof = cofactor3(skinMat3);
        float skinDet = dot(skinMat3[0], skinCof[0]);
        skinSign = skinDet < 0.0 ? -1.0 : 1.0;
        localNormal = (skinCof * a_normal) * skinSign;
        localTangent = skinMat3 * a_tangent.xyz;
    }
#else
    vec4 localPos = vec4(a_position, 1.0);
    vec3 localNormal = a_normal;
    vec3 localTangent = a_tangent.xyz;
#endif
    vec4 wp = modelMat * localPos;
    v_worldPos = wp.xyz;
    mat3 m3 = extractMat3(modelMat);
    mat3 mCof = cofactor3(m3);
    float modelDet = dot(m3[0], mCof[0]);
    float modelSign = modelDet < 0.0 ? -1.0 : 1.0;
    vec3 worldN = (mCof * localNormal) * modelSign;
    v_normal = (dot(localNormal, localNormal) < 0.0001 || dot(worldN, worldN) < 1e-20)
        ? vec3(0.0, 1.0, 0.0)
        : normalize(worldN);
    vec2 uvScaled = a_uv * u_texRepeat;
    float uvCos = 1.0;
    float uvSin = 0.0;
    if (u_texRotation != 0.0) {
        uvCos = cos(u_texRotation);
        uvSin = sin(u_texRotation);
    }
    v_uv = vec2(uvCos * uvScaled.x - uvSin * uvScaled.y, uvSin * uvScaled.x + uvCos * uvScaled.y) + u_texOffset;
    v_uv0 = a_uv;
#ifdef USE_UV1
    v_uv1 = a_uv1;
#endif

    vec3 tangent = localTangent;
    // Bitangent handedness w = ±1, folded into B in the vertex stage. Defaults to +1
    // when the tangent is zero/absent (degenerate or disabled attribute).
    float bitangentSign = length(tangent) < 0.0001 ? 1.0 : (a_tangent.w * skinSign * modelSign);
    if (length(tangent) < 0.0001) {
        if (abs(v_normal.y) < 0.999) {
            tangent = cross(v_normal, vec3(0.0, 1.0, 0.0));
        } else {
            tangent = cross(v_normal, vec3(1.0, 0.0, 0.0));
        }
    }

    vec3 T = normalize(m3 * tangent);
    vec3 N = v_normal;
    T = normalize(T - dot(T, N) * N);
    // UV rotation (KHR_texture_transform: uv' = R(theta) * (uv * repeat) + offset) also turns the tangent frame.
    // The map's +u' axis lies along R^T * e_u = (cos, -sin) in mesh-UV space, so T' = cos*T - sin*B and
    // B' = sin*T + cos*B (B carries the handedness sign; the rotation is proper, so T', B', N stay orthonormal).
    // Without it a rotated normal map would shade with the unrotated tangent direction. cos/sin run only when
    // rotated (uniform branch): the identity case needs no trigonometry.
    vec3 B = cross(N, T) * bitangentSign;
    v_tbn = mat3(uvCos * T - uvSin * B, uvSin * T + uvCos * B, N);

    gl_Position = u_vp * wp;
    v_clipPos = gl_Position;
}