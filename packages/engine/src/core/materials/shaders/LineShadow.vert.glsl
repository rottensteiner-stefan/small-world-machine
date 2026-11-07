[BASE_VERTEX_HEADER]
// Line-caster shadow expansion (ADR 0045), byte-for-byte the math of LineShadow.vert.wgsl.
// a_position = this endpoint, a_normal = the opposite endpoint, a_uv = (side ±1, +1 at A / -1 at B).
// u_extraParams = [1, alphaTest, one texel in NDC, half width in meters].
uniform vec4 u_extraParams;

void main() {
#ifdef USE_INSTANCING
  mat4 modelMat = u_model * a_instanceMatrix;
#else
  mat4 modelMat = u_model;
#endif

  vec4 wp = modelMat * vec4(a_position, 1.0);
  vec4 clipSelf = u_vp * wp;
  vec4 clipOther = u_vp * (modelMat * vec4(a_normal, 1.0));

  vec2 d = (clipOther.xy / clipOther.w - clipSelf.xy / clipSelf.w) * a_uv.y;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 side = vec2(-dir.y, dir.x) * a_uv.x;

  float scaleX = length(vec3(u_vp[0][0], u_vp[1][0], u_vp[2][0]));
  float scaleY = length(vec3(u_vp[0][1], u_vp[1][1], u_vp[2][1]));
  float halfWidth = u_extraParams.w;
  float minHalf = 0.75 * u_extraParams.z * clipSelf.w;
  vec2 offset = vec2(max(halfWidth * scaleX, minHalf), max(halfWidth * scaleY, minHalf)) * side;

  gl_Position = vec4(clipSelf.xy + offset, clipSelf.zw);
  v_worldPos = wp.xyz;
  v_normal = vec3(0.0, 1.0, 0.0);
  v_uv = vec2(0.0);
}
