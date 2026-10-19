[RAIN_PUDDLE_COMMON]

@fragment fn fs(i: Out) -> @location(0) vec4f {
    let time = obj.matParam0.x;
    let pixelAngle = obj.matParam0.y;
    let rainIntensity = obj.matParam0.z;
    let dripIntensity = obj.matParam0.w;
    let asphaltTilePeriod = obj.matParam1.xy;
    let heightContrastMm = obj.matParam1.z;
    let edgeNoise = obj.matParam1.w;
    let ior = obj.matParam2.x;
    let bottomTransmission = obj.matParam2.y;
    let reflectionDistortion = obj.matParam2.z;
    let reflectionBlur = obj.matParam2.w;
    let basinDepthMm = obj.matParam3.x;
    let dampWidthMm = obj.matParam3.y;
    let dampDarkening = obj.matParam3.z;
    let specularStrength = obj.matParam3.w;

    let p = i.wp.xz;
    // Sampled in uniform control flow (before any discard) so implicit mip selection stays valid.
    let asphalt = textureSample(u_diffuseMap, s, p / asphaltTilePeriod).rgb;
    let asphaltLuma = dot(asphalt, vec3f(0.2126, 0.7152, 0.0722));
    let waterDepthMm = rpWaterDepthMm(p, asphaltLuma, obj.matParam4, obj.matParam5, obj.matParam6, obj.matParam7,
                                      basinDepthMm, heightContrastMm, edgeNoise);
    let waterMask = smoothstep(0.0, 0.3, waterDepthMm);
    let dampMask = smoothstep(-dampWidthMm, 0.0, waterDepthMm) * (1.0 - waterMask);
    if (waterMask + dampMask < 0.002) {
        discard;
    }

    let waterDepth = clamp(waterDepthMm, 0.5, 6.0) * 0.001;
    let toEye = global.viewPos.xyz - i.wp;
    let viewDir = normalize(toEye);
    let footprint = pixelAngle * length(toEye) / max(viewDir.y, 0.15);
    var ripple = vec3f(0.0);
    if (waterMask > 0.001) {
        ripple = rpRainField(p, time, rainIntensity, dripIntensity, waterDepth, footprint) * waterMask;
    }
    let rippleNormal = normalize(vec3f(-ripple.x, 1.0, -ripple.y));

    var final_spec = vec3f(0.0);
    {
        var i_perturbed = i;
        i_perturbed.n = rippleNormal;
        let i = i_perturbed;
        [WGSL_LIGHTING]
        final_spec = spec;
    }

    let fresnel = rpFresnelDielectric(dot(rippleNormal, viewDir), ior);

    let clipPos = global.vp * vec4f(i.wp, 1.0);
    let ndc = clipPos.xy / clipPos.w;
    let screenUV = vec2f(ndc.x * 0.5 + 0.5, ndc.y * -0.5 + 0.5);
    let uv = screenUV + vec2f(rippleNormal.x, -rippleNormal.z) * reflectionDistortion;
    // Unresolved micro-ripples act as roughness: blur the mirror image by their
    // rms slope instead of letting them alias.
    let blurRadius = min(reflectionBlur * sqrt(ripple.z), 0.03);
    let o = vec2f(blurRadius, blurRadius * 0.6);
    let lo = vec2f(0.001);
    let hi = vec2f(0.999);
    let reflectionSrgb = (
        2.0 * textureSampleLevel(u_reflectionMap, s, clamp(uv, lo, hi), 0.0).rgb +
        textureSampleLevel(u_reflectionMap, s, clamp(uv + o, lo, hi), 0.0).rgb +
        textureSampleLevel(u_reflectionMap, s, clamp(uv - o, lo, hi), 0.0).rgb +
        textureSampleLevel(u_reflectionMap, s, clamp(uv + vec2f(-o.y, o.x), lo, hi), 0.0).rgb +
        textureSampleLevel(u_reflectionMap, s, clamp(uv + vec2f(o.y, -o.x), lo, hi), 0.0).rgb) / 6.0;
    // The mirror pass renders the final, already exposed scene: only the light glints need exposure.
    let reflection = sRGBToLinear(reflectionSrgb);
    let glints = final_spec * fresnel * specularStrength * global.exposure;

    // Straight-alpha over the street: F of the mirror image plus (1-F) of the street seen through
    // the water, darkened by bottomTransmission.
    let waterAlpha = waterMask * (1.0 - (1.0 - fresnel) * bottomTransmission);
    let dampAlpha = dampMask * dampDarkening;
    let contribution = waterMask * (fresnel * reflection + glints) + dampMask * 0.3 * fresnel * reflection;
    let alpha = clamp(waterAlpha + dampAlpha, 0.0, 1.0);
    var color = linearToSRGB(contribution / max(alpha, 1.0e-3));

    [WGSL_FOG_CALC]
    return vec4f(color, alpha);
}
