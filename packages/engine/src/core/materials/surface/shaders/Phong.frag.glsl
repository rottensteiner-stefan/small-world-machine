[BASE_FRAGMENT_HEADER]
[LIGHT_DEFS]
[FOG_DEFS]
void main() {
  vec4 texColor = texture(u_diffuseMap, v_uv);
#ifdef USE_SPECULAR_MAP
  float specMapValue = texture(u_specularMap, v_uv).r;
#else
  float specMapValue = 1.0;
#endif

#ifdef USE_NORMAL_MAP
  vec3 normalMapValue = texture(u_normalMap, v_uv).rgb;
  vec3 normalMap = normalize(normalMapValue * 2.0 - 1.0);
  normalMap.xy *= u_extraParams.zw;
  vec3 N = v_tbn * normalMap;
  if (dot(N, N) < 0.0001) {
    N = v_normal;
  }
  if (dot(N, N) < 0.0001) {
    N = vec3(0.0, 0.0, 1.0);
  }
  N = normalize(N);
#else
  vec3 N = v_normal;
  if (dot(N, N) < 0.0001) {
    N = vec3(0.0, 0.0, 1.0);
  }
  N = normalize(N);
#endif

  [LIGHT_CALC]

  vec3 albedo = sRGBToLinear(texColor.rgb) * sRGBToLinear(u_color.rgb);
  // finalLight already contains ambient + all diffuse components
  // specular contains all specular components
  vec3 finalColor = finalLight * albedo + specular * sRGBToLinear(u_specColor.rgb) * specMapValue;
  
  // Exposure
  finalColor *= u_exposure;

  // Gamma Correction
  finalColor = linearToSRGB(finalColor);

  float finalAlpha = u_color.a * texColor.a;
  if (finalAlpha < u_extraParams.y) {
    discard;
  }

  fragColor = vec4(finalColor, finalAlpha);
  [FOG_CALC]
}