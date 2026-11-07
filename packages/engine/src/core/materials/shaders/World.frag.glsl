[BASE_FRAGMENT_HEADER]
[LIGHT_DEFS]
[FOG_DEFS]
uniform vec2 u_texRepeat;
void main() {
  vec3 blendWeights = abs(v_normal);
  blendWeights = pow(blendWeights, vec3(4.0));
  blendWeights /= (blendWeights.x + blendWeights.y + blendWeights.z);
  vec2 coordX = v_worldPos.zy * u_texRepeat;
  vec2 coordY = v_worldPos.xz * u_texRepeat;
  vec2 coordZ = v_worldPos.xy * u_texRepeat;
  if (v_normal.x < 0.0) coordX.x = -coordX.x;
  if (v_normal.y < 0.0) coordY.x = -coordY.x;
  if (v_normal.z >= 0.0) coordZ.x = -coordZ.x;
  vec4 colX = texture(u_diffuseMap, coordX);
  vec4 colY = texture(u_diffuseMap, coordY);
  vec4 colZ = texture(u_diffuseMap, coordZ);
  vec4 finalTexColor = colX * blendWeights.x + colY * blendWeights.y + colZ * blendWeights.z;
  vec3 N = normalize(v_normal);
  [LIGHT_CALC]
  vec3 albedo = sRGBToLinear(finalTexColor.rgb) * sRGBToLinear(u_color.rgb);
  vec3 finalColor = linearToSRGB(finalLight * albedo * u_exposure);
  fragColor = vec4(finalColor, u_color.a * finalTexColor.a);
  [FOG_CALC]
}