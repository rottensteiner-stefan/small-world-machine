attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec2 a_uv;
attribute vec3 a_tangent;

#ifdef USE_INSTANCING
attribute mat4 a_instanceMatrix;
#endif

uniform mat4 u_vp;
uniform mat4 u_model;
uniform vec2 u_texOffset;
uniform vec2 u_texRepeat;

varying vec3 v_worldPos;
varying vec3 v_normal;
varying vec2 v_uv;
varying mat3 v_tbn;

mat3 extractMat3(mat4 m) {
    return mat3(m[0].xyz, m[1].xyz, m[2].xyz);
}

void main() {
#ifdef USE_INSTANCING
    mat4 modelMat = u_model * a_instanceMatrix;
#else
    mat4 modelMat = u_model;
#endif
    vec4 wp = modelMat * vec4(a_position, 1.0);
    v_worldPos = wp.xyz;
    mat3 m3 = extractMat3(modelMat);
    v_normal = normalize(m3 * a_normal);
    v_uv = (a_uv * u_texRepeat) + u_texOffset;

    vec3 tangent = a_tangent;
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
    vec3 B = cross(N, T);
    v_tbn = mat3(T, B, N);

    gl_Position = u_vp * wp;
}