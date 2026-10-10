void main() {
#ifdef USE_SKINNING
  mat4 skinMat =
      a_weights.x * u_boneMatrices[int(a_joints.x)] +
      a_weights.y * u_boneMatrices[int(a_joints.y)] +
      a_weights.z * u_boneMatrices[int(a_joints.z)] +
      a_weights.w * u_boneMatrices[int(a_joints.w)];

  vec4 localPos = skinMat * vec4(a_position, 1.0);
  vec3 localNormal = mat3(skinMat) * a_normal;
  vec3 localTangent = mat3(skinMat) * a_tangent;
#else
  vec4 localPos = vec4(a_position, 1.0);
  vec3 localNormal = a_normal;
  vec3 localTangent = a_tangent;
#endif

#ifdef USE_INSTANCING
  mat4 modelMat = u_model * a_instanceMatrix;
#ifdef USE_TEXTURE_ARRAY
  v_texIndex = a_instanceData.x;
#endif
#else
  mat4 modelMat = u_model;
#endif

  vec4 wp = modelMat * localPos;
  v_worldPos = wp.xyz;
  vec3 computedNormal = mat3(modelMat) * localNormal;
  // Fallback only for a genuinely missing/zero vertex normal. The test must run on the LOCAL normal:
  // testing the transformed one made it depend on the mesh scale (a 0.008-scaled model has
  // |N|^2 = 6.4e-5 < 0.0001 and every normal collapsed to +Y).
  if (dot(localNormal, localNormal) < 0.0001 || dot(computedNormal, computedNormal) < 1e-20) {
    computedNormal = vec3(0.0, 1.0, 0.0);
  }
  v_normal = normalize(computedNormal);
  v_uv = (a_uv * u_texRepeat) + u_texOffset;

  vec3 tangent = localTangent;
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
  vec3 B = cross(N_v, T);
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
