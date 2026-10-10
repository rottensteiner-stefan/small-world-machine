@fragment fn fs(i: Out) -> @location(0) vec4f {
  let texCol = textureSample(u_diffuseMap, s, i.uv);
  
  // Note: N is now defined inside WGSL_LIGHTING via normalize(i.n)
  [WGSL_LIGHTING]
  
  let albedo = sRGBToLinear(texCol.rgb) * sRGBToLinear(obj.color.rgb);
  var color = fL * albedo;

  // ── Forward-Pass / Post-Pass tonemapping contract ─────────────────────────────────────────────
  // global.exposure == 1.0 when PostProcessing is enabled. Do NOT add Reinhard here — the
  // PostProcess pass handles tonemapping. See WebGPURenderer.ts "Forward-Pass / Post-Pass" block.
  color *= global.exposure;

  // Gamma correction — always runs. Feeds the HDR render-target when PostProcessing is enabled.
  color = linearToSRGB(color);

  [WGSL_FOG_CALC]
  return vec4f(color, obj.color.a * texCol.a);
}