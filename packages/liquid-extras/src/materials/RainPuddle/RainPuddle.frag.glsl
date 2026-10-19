[BASE_FRAGMENT_HEADER]
[FOG_DEFS]
[LIGHT_DEFS]

uniform vec4 u_matParam0; // [time, pixelAngle, rainIntensity, dripIntensity]
uniform vec4 u_matParam1; // [asphaltTilePeriod.xy, heightContrastMm, edgeNoise]
uniform vec4 u_matParam2; // [ior, bottomTransmission, reflectionDistortion, reflectionBlur]
uniform vec4 u_matParam3; // [basinDepthMm, dampWidthMm, dampDarkening, specularStrength]
uniform vec4 u_matParam4; // puddle basin 0 [x, z, radiusX, radiusZ]
uniform vec4 u_matParam5; // puddle basin 1
uniform vec4 u_matParam6; // puddle basin 2
uniform vec4 u_matParam7; // puddle basin 3
uniform sampler2D u_reflectionMap;

[RAIN_PUDDLE_COMMON]

void main() {
    float time = u_matParam0.x;
    float pixelAngle = u_matParam0.y;
    float rainIntensity = u_matParam0.z;
    float dripIntensity = u_matParam0.w;
    vec2 asphaltTilePeriod = u_matParam1.xy;
    float heightContrastMm = u_matParam1.z;
    float edgeNoise = u_matParam1.w;
    float ior = u_matParam2.x;
    float bottomTransmission = u_matParam2.y;
    float reflectionDistortion = u_matParam2.z;
    float reflectionBlur = u_matParam2.w;
    float basinDepthMm = u_matParam3.x;
    float dampWidthMm = u_matParam3.y;
    float dampDarkening = u_matParam3.z;
    float specularStrength = u_matParam3.w;

    vec2 p = v_worldPos.xz;
    vec3 asphalt = texture(u_diffuseMap, p / asphaltTilePeriod).rgb;
    float asphaltLuma = dot(asphalt, vec3(0.2126, 0.7152, 0.0722));
    float waterDepthMm = rpWaterDepthMm(p, asphaltLuma, u_matParam4, u_matParam5, u_matParam6, u_matParam7,
                                        basinDepthMm, heightContrastMm, edgeNoise);
    float waterMask = smoothstep(0.0, 0.3, waterDepthMm);
    float dampMask = smoothstep(-dampWidthMm, 0.0, waterDepthMm) * (1.0 - waterMask);
    if (waterMask + dampMask < 0.002) {
        discard;
    }

    float waterDepth = clamp(waterDepthMm, 0.5, 6.0) * 0.001;
    vec3 toEye = u_viewPos - v_worldPos;
    vec3 viewDir = normalize(toEye);
    float footprint = pixelAngle * length(toEye) / max(viewDir.y, 0.15);
    vec3 ripple = vec3(0.0);
    if (waterMask > 0.001) {
        ripple = rpRainField(p, time, rainIntensity, dripIntensity, waterDepth, footprint) * waterMask;
    }
    vec3 N = normalize(vec3(-ripple.x, 1.0, -ripple.y));

    [LIGHT_CALC]

    float fresnel = rpFresnelDielectric(dot(N, viewDir), ior);

    vec4 clipPos = u_vp * vec4(v_worldPos, 1.0);
    vec2 screenUV = clipPos.xy / clipPos.w * 0.5 + 0.5;
    vec2 uv = screenUV + vec2(N.x, N.z) * reflectionDistortion;
    // Unresolved micro-ripples act as roughness: blur the mirror image by their
    // rms slope instead of letting them alias.
    float blurRadius = min(reflectionBlur * sqrt(ripple.z), 0.03);
    vec2 o = vec2(blurRadius, blurRadius * 0.6);
    vec2 lo = vec2(0.001);
    vec2 hi = vec2(0.999);
    vec3 reflectionSrgb = (
        2.0 * texture(u_reflectionMap, clamp(uv, lo, hi)).rgb +
        texture(u_reflectionMap, clamp(uv + o, lo, hi)).rgb +
        texture(u_reflectionMap, clamp(uv - o, lo, hi)).rgb +
        texture(u_reflectionMap, clamp(uv + vec2(-o.y, o.x), lo, hi)).rgb +
        texture(u_reflectionMap, clamp(uv + vec2(o.y, -o.x), lo, hi)).rgb) / 6.0;
    // The mirror pass renders the final, already exposed scene: only the light glints need exposure.
    vec3 reflection = sRGBToLinear(reflectionSrgb);
    vec3 glints = specular * fresnel * specularStrength * u_exposure;

    // Straight-alpha over the street: F of the mirror image plus (1-F) of the street seen through
    // the water, darkened by bottomTransmission.
    float waterAlpha = waterMask * (1.0 - (1.0 - fresnel) * bottomTransmission);
    float dampAlpha = dampMask * dampDarkening;
    vec3 contribution = waterMask * (fresnel * reflection + glints) + dampMask * 0.3 * fresnel * reflection;
    float alpha = clamp(waterAlpha + dampAlpha, 0.0, 1.0);
    fragColor = vec4(linearToSRGB(contribution / max(alpha, 1.0e-3)), alpha);

    [FOG_CALC]
}
