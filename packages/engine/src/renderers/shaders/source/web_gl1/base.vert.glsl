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

uniform mat4 u_vp;
uniform mat4 u_model;
uniform vec2 u_texOffset;
uniform vec2 u_texRepeat;
uniform float u_texRotation;

varying vec3 v_worldPos;
varying vec3 v_normal;
varying vec2 v_uv;
varying mat3 v_tbn;
varying vec4 v_clipPos;

mat3 extractMat3(mat4 m) {
    return mat3(m[0].xyz, m[1].xyz, m[2].xyz);
}

void main() {
#ifdef USE_INSTANCING
    mat4 modelMat = u_model * a_instanceMatrix;
#ifdef USE_INSTANCE_COLOR
    v_instanceColor = a_instanceData;
#endif
#else
    mat4 modelMat = u_model;
#endif
#ifdef USE_SKINNING
    // GPU skinning, mirroring the web_gl2 / web_gpu vertex stages: linear blend of the four
    // bound joint matrices, applied to the bind-pose local attributes before the model matrix.
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
    vec4 wp = modelMat * localPos;
    v_worldPos = wp.xyz;
    mat3 m3 = extractMat3(modelMat);
    v_normal = normalize(m3 * localNormal);
    vec2 uvScaled = a_uv * u_texRepeat;
    float uvCos = 1.0;
    float uvSin = 0.0;
    if (u_texRotation != 0.0) {
        uvCos = cos(u_texRotation);
        uvSin = sin(u_texRotation);
    }
    v_uv = vec2(uvCos * uvScaled.x - uvSin * uvScaled.y, uvSin * uvScaled.x + uvCos * uvScaled.y) + u_texOffset;

    vec3 tangent = localTangent;
    // Bitangent handedness w = ±1, folded into B in the vertex stage. Defaults to +1
    // when the tangent is zero/absent (degenerate or disabled attribute).
    float bitangentSign = length(tangent) < 0.0001 ? 1.0 : a_tangent.w;
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