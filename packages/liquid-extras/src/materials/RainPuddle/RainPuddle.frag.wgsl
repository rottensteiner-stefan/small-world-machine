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
    // Lanes 8..13: liquid data from DropSurfaceParams (see RainPuddleMaterial.ts).
    let fluid = rpFluid(obj.matParam8.x, obj.matParam8.y);
    let scatteringPerMm = obj.matParam8.z;
    let bubbleLifetime = obj.matParam8.w;
    let absorptionPerMm = obj.matParam9.xyz;
    let scatterAlbedo = obj.matParam10.xyz;

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
    var ripple = vec4f(0.0);
    if (waterMask > 0.001) {
        ripple = rpRainField(p, time, rainIntensity, dripIntensity, obj.matParam11, obj.matParam12, obj.matParam13,
                             fluid, bubbleLifetime, waterDepth, footprint) * waterMask;
    }
    let rippleNormal = normalize(vec3f(-ripple.x, 1.0, -ripple.y));

    var final_spec = vec3f(0.0);
    var final_light = vec3f(0.0);
    {
        var i_perturbed = i;
        i_perturbed.n = rippleNormal;
        let i = i_perturbed;
        [WGSL_LIGHTING]
        final_spec = spec;
        final_light = fL;
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
    let surfaceLight = final_light * global.exposure;

    // Straight-alpha over the street: F of the mirror image plus (1-F) of what comes out of the
    // liquid -- light scattered by its body, and the street seen through the column (Beer-Lambert
    // per channel times the wet-ground darkening). Blending can only darken the street by one scalar,
    // the weakest channel; the other channels' surplus is added back from an estimate of the lit
    // street (its own texture under this pixel's light).
    let opticalDepthMm = max(waterDepthMm, 0.0);
    let transmission = bottomTransmission * rpColumnTransmission(viewDir.y, ior, opticalDepthMm, absorptionPerMm);
    let minTransmission = min(transmission.r, min(transmission.g, transmission.b));
    let bodyOpacity = 1.0 - exp(-scatteringPerMm * opticalDepthMm);
    let throughBody = (1.0 - fresnel) * (1.0 - bodyOpacity);
    let body = (1.0 - fresnel) * bodyOpacity * scatterAlbedo * surfaceLight;
    let tint = throughBody * (transmission - vec3f(minTransmission)) * sRGBToLinear(asphalt) * surfaceLight;
    // Crown rims, jet points and bubble rims: bright, mostly mirror-like specks.
    let sparkle = min(ripple.w, 1.5) * (0.6 * reflection + 0.4 * surfaceLight);
    let waterAlpha = waterMask * (1.0 - throughBody * minTransmission);
    let dampAlpha = dampMask * dampDarkening;
    let contribution = waterMask * (fresnel * reflection + glints + body + tint + sparkle) +
                       dampMask * 0.3 * fresnel * reflection;
    let alpha = clamp(waterAlpha + dampAlpha, 0.0, 1.0);
    var color = linearToSRGB(contribution / max(alpha, 1.0e-3));

    [WGSL_FOG_CALC]
    return vec4f(color, alpha);
}
