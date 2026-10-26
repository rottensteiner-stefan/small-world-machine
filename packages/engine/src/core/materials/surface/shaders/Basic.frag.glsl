[BASE_FRAGMENT_HEADER]
[LIGHT_DEFS]
void main() {
  vec4 texColor = texture(u_diffuseMap, v_uv);
  float finalAlpha = u_color.a * texColor.a;
  vec3 albedo = u_color.rgb * texColor.rgb;
#ifdef USE_INSTANCE_COLOR
  albedo *= v_instanceColor.rgb;
  finalAlpha *= v_instanceColor.a;
#endif
  if (finalAlpha < u_extraParams.y) {
    discard;
  }
  fragColor = vec4(displayToTarget(albedo), finalAlpha);
}