@fragment fn fs(i: Out) -> @location(0) vec4f {
    let texCol = textureSample(u_diffuseMap, s, i.uv);
    let specMap = textureSample(u_specularMap, s, i.uv).r;

    [WGSL_LIGHTING]

    let albedo = sRGBToLinear(texCol.rgb) * sRGBToLinear(obj.color.rgb);
    // fL contains ambient + all diffuse components
    // spec contains all specular components
    var color = fL * albedo + spec * sRGBToLinear(obj.specColor.rgb) * specMap;

    // ── Forward-Pass / Post-Pass tonemapping contract ───────────────────────────────────────────
    // global.exposure == 1.0 when PostProcessing is enabled (WebGPURenderer sets it so the
    // PostProcess pass can apply scene exposure itself via ToneMappingElement). Do NOT add
    // Reinhard or other tonemapping here — the PostProcess pass handles it. When PostProcessing
    // is disabled, exposure comes from _quality and linearToSRGB below acts as the final step.
    // See WebGPURenderer.ts "Forward-Pass / Post-Pass" comment block for the full contract.
    color *= global.exposure;

    // Gamma correction — always runs (converts linear to sRGB for the render target format).
    // When PostProcessing is enabled this feeds the HDR render-target; the PostProcess pass
    // re-reads it in linear space via sRGBToLinear before tonemapping. No double-correction.
    color = linearToSRGB(color);

    let finalAlpha = obj.color.a * texCol.a;
    if (finalAlpha < obj.extraParams.y) {
        discard;
    }
    [WGSL_FOG_CALC]
    return vec4f(color, finalAlpha);
}