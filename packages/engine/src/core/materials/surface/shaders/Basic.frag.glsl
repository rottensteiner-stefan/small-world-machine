[BASE_FRAGMENT_HEADER]
void main() {
  vec4 texColor = texture(u_diffuseMap, v_uv);
  float finalAlpha = u_color.a * texColor.a;
  if (finalAlpha < u_extraParams.y) {
    discard;
  }
  fragColor = vec4(u_color.rgb * texColor.rgb, finalAlpha);
}