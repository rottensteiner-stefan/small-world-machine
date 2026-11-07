[BASE_FRAGMENT_HEADER]
// The LIGHT_DEFS block is pulled in only for the GlobalUniforms UBO's u_viewPos (identical block
// to the vertex stage) -- the sprite shader itself is unlit, but scene fog needs the camera
// position to compute distance. NB: keep this comment free of LIKE_THIS bracket tokens, since
// shader assembly substitutes token placeholders inside comments too.
[LIGHT_DEFS]
[FOG_DEFS]
void main() {
  vec4 texColor = texture(u_diffuseMap, v_uv);
  fragColor = u_color * texColor;
  // Cutout mode (SpriteMaterial.alphaTest > 0): discard below the material's threshold so an
  // opaque imposter/billboard writes only its solid silhouette into color and depth. In the
  // transparent (blended) mode the threshold is 0 and nothing is discarded.
  if (texColor.a < u_extraParams.y) discard;
  fragColor.rgb = displayToTarget(fragColor.rgb);
  [FOG_CALC]
}