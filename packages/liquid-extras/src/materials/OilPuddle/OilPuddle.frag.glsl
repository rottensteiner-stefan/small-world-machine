[BASE_FRAGMENT_HEADER]
[LIGHT_DEFS]

// First-class OilPuddleMaterial (moved from the-whisper app into @small-world-machine/liquid-extras): a
// settled, viscous oil puddle in the Graphic-Noir style. Parameter carriage uses the dedicated
// semantic matParam lanes 0..5 (see OilPuddleMaterial.ts); no standard slot is repurposed.
uniform vec4 u_matParam0; // [time, iridescenceStrength, timeScale, ringEnabled]
uniform vec4 u_matParam1; // [highlightPoint.x, highlightPoint.y, highlightRadius, highlightIntensity]
uniform vec4 u_matParam2; // [splatterBaseRadius, splatterNoiseAmp, outlineWidth, outlineAlpha]
uniform vec4 u_matParam3; // [meniscusStrength, rimDarkening, floorVisibility, wrinkleStrength]
uniform vec4 u_matParam4; // [ringCount, ringReach, ringSoftness, unused]
uniform vec4 u_matParam5; // [envColor.rgb, envReflectivity]
// Live-captured opaque colour buffer (see LiquidWaveMaterial/OpenWaterMaterial, which pioneered
// this pattern) -- gives the puddle's thin rim a real view of the actual floor beneath it.
uniform sampler2D u_opaqueMap;

// Pseudo-random hash + value noise, used for both the puddle's fixed organic edge shape and the
// slow thin-film thickness variation across its surface.
float hash(vec2 p) {
    vec2 q = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(q.x) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i + vec2(0.0, 0.0));
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// [THIN_FILM_DECL]

void main() {
    float time = u_matParam0.x;
    float iridescenceStrength = u_matParam0.y;
    float timeScale = u_matParam0.z;
    float ringEnabled = u_matParam0.w;
    vec2 highlightPoint = u_matParam1.xy;
    float highlightRadius = max(u_matParam1.z, 0.001);
    float highlightIntensity = u_matParam1.w;
    float splatterBaseRadius = u_matParam2.x;
    float splatterNoiseAmp = u_matParam2.y;
    float outlineWidth = max(u_matParam2.z, 0.0);
    float outlineAlpha = u_matParam2.w > 0.0 ? u_matParam2.w : 0.85;
    float meniscusStrength = u_matParam3.x > 0.0 ? u_matParam3.x : 0.65;
    float rimDarkening = u_matParam3.y > 0.0 ? u_matParam3.y : 0.95;
    float floorVisibility = clamp(u_matParam3.z, 0.0, 1.0);
    float wrinkleStrength = u_matParam3.w;
    float ringCount = u_matParam4.x;
    float ringReach = u_matParam4.y;
    float ringSoftness = u_matParam4.z;
    vec3 envColor = sRGBToLinear(u_matParam5.rgb);
    float envReflectivity = u_matParam5.w;

    // 1. Organic splatter mask & 2-stage ink outline (inner oil pool + outer graphic novel contour)
    vec2 localUV = v_uv - vec2(0.5);
    float distFromCenter = length(localUV);
    float angle = atan(localUV.y, localUV.x);
    vec2 noiseCoord = vec2(cos(angle), sin(angle)) * 3.0;
    float edgeNoise = noise(noiseCoord);
    float radius = splatterBaseRadius + edgeNoise * splatterNoiseAmp;
    float outerRadius = radius + outlineWidth;

    // Discard outside the outermost ink contour
    float outerAlphaMask = smoothstep(outerRadius + 0.01, outerRadius - 0.01, distFromCenter);
    if (outerAlphaMask < 0.05) {
        discard;
    }

    // Inner oil body mask: 1.0 inside oil pool, 0.0 in the outer outline ring
    float innerOilMask = smoothstep(radius + 0.01, radius - 0.01, distFromCenter);

    // 2. Synthetic meniscus normal perturbation (procedural edge curvature catching specular light)
    vec3 N = normalize(v_normal);
    float edgeDist = radius - distFromCenter;
    float meniscusBand = max(splatterBaseRadius * 0.35, 0.02);
    if (edgeDist > -0.02 && edgeDist < meniscusBand) {
        float edgeFactor = 1.0 - clamp(edgeDist / meniscusBand, 0.0, 1.0);
        vec2 outwardDir = distFromCenter > 0.0001 ? normalize(localUV) : vec2(0.0);
        // Perturb normal outwards along the puddle plane (v_normal is up in tangent/world)
        N.xz += outwardDir * edgeFactor * meniscusStrength;
        N = normalize(N);
    }

    // v4 Tar-Skin creases: optional subtle wrinkle perturbation on the oil body (gated, 0 = off).
    if (innerOilMask > 0.0001 && wrinkleStrength > 0.0001) {
        float w1 = noise(v_worldPos.xz * 23.0) * 2.0 - 1.0;
        float w2 = noise(v_worldPos.xz * 31.0 + 7.7) * 2.0 - 1.0;
        N.x += w1 * wrinkleStrength * 0.12;
        N.z += w2 * wrinkleStrength * 0.12;
        N = normalize(N);
    }

    [LIGHT_CALC]

    vec3 viewDir = normalize(u_viewPos - v_worldPos);
    float NdotV = max(dot(N, viewDir), 0.0);

    // 3. Base colour gradient: warm amber-brown core -> deep noir tar-black edge
    vec3 coreColor = sRGBToLinear(u_color.rgb);
    vec3 edgeColor = sRGBToLinear(vec3(0.012, 0.009, 0.007)); // Noir deep tar black

    // Grounded rim: sample the real floor colour beneath the puddle (captured just before this
    // transparent pass, see WebGL2Renderer.copyToOpaqueTexture) and tint it dark by the oil, so
    // the thin rim reads as translucent film over actual pavement instead of a flat painted ring.
    vec2 screenUv = gl_FragCoord.xy / vec2(textureSize(u_opaqueMap, 0));
    vec3 groundColor = sRGBToLinear(texture(u_opaqueMap, screenUv).rgb);
    // Tint by edgeColor's hue only (normalized to its brightest channel), not its raw magnitude --
    // edgeColor itself is a near-black tar constant, so multiplying by it directly would crush the
    // real floor brightness to near-zero regardless of floorVisibility.
    vec3 edgeHue = edgeColor / max(max(edgeColor.r, max(edgeColor.g, edgeColor.b)), 0.0001);
    vec3 groundTinted = groundColor * mix(vec3(1.0), edgeHue, 0.7);

    float radialFactor = clamp(distFromCenter / max(radius, 0.001), 0.0, 1.0);
    vec3 baseColor = mix(coreColor, edgeColor, smoothstep(0.1, 0.95, radialFactor) * rimDarkening);

    // Subtle thin-film shimmer: two independently-scrolling noise layers (opposite directions/
    // speeds, per the Godot reference in docs/research/oil-puddle-shader-technique.md) combined into the thickness
    // variation, giving the shimmer a wandering "wave" structure instead of a single static-
    // frequency drift. Colour-only -- no spatial animation; timeScale = volatility (petrol/diesel).
    vec2 waveUvA = v_worldPos.xz * 4.0 + time * vec2(0.02, 0.015) * timeScale;
    vec2 waveUvB = v_worldPos.xz * 5.5 - time * vec2(0.015, 0.025) * timeScale;
    float swirl = noise(waveUvA) * 0.5 + noise(waveUvB) * 0.5;
    float thickness = 0.5 + swirl * 0.5;
    vec3 iridescence = oilFilmThinFilm(NdotV, thickness, iridescenceStrength);
    float fresnel = pow(1.0 - NdotV, 4.0);
    vec3 colorWithSheen = mix(baseColor, iridescence, fresnel * iridescenceStrength);

    // 4. Localised warm glow pooling near the drip point under the barrel
    float glowDist = distance(v_uv, highlightPoint);
    float glow = highlightIntensity * exp(-(glowDist * glowDist) / (highlightRadius * highlightRadius));

    vec3 tint = sRGBToLinear(u_specColor.rgb);

    // Analytic environment reflection (envColor carried in matParam5): no real cubemap probe by
    // default, so the "reflected surroundings" are approximated as a dim ambient tone weighted by
    // Schlick Fresnel. F0 = Khronos KHR_materials_ior for IOR=1.333 (oil/water), 0.0204.
    const float envF0 = 0.0204;
    float envFresnel = envF0 + (1.0 - envF0) * pow(1.0 - NdotV, 5.0);
    vec3 envReflection = envColor * envFresnel * envReflectivity;

    vec3 litOilColor = colorWithSheen * finalLight + specular * tint + tint * glow + envReflection;

    // v6 Graphic Poster Rainbow Rings: flat, deliberate, muted concentric bands radiating from the
    // drip point (poster-illustration style). Desaturated via oilFilmRainbow's strength. Gated by
    // ringEnabled (0 = off); poster rings are muted, never a bright saturated rainbow.
    if (ringEnabled > 0.5 && ringCount > 0.5) {
        float rgDist = distance(v_uv, highlightPoint);
        float ringReachSafe = max(ringReach, 0.02);
        float bandPos = clamp(rgDist / ringReachSafe, 0.0, 1.0);
        float bandVal = fract(bandPos * ringCount + time * 0.05);
        float ringBand = 1.0 - smoothstep(0.0, max(ringSoftness, 0.0001), bandVal);
        float reachFade = 1.0 - smoothstep(ringReachSafe - 0.01, ringReachSafe, rgDist);
        float ringMask = ringBand * reachFade * 0.45;
        vec3 ringColor = oilFilmRainbow(fract(bandPos) * 6.2831853, 0.45);
        litOilColor = mix(litOilColor, ringColor, clamp(ringMask, 0.0, 1.0));
    }

    // Grounded rim overlay: blend in the real floor colour AFTER lighting, not before -- the
    // captured u_opaqueMap sample is already fully shaded by the main opaque pass (it's the floor's
    // final on-screen colour), so folding it into baseColor and then multiplying by this material's
    // own finalLight would double-darken the rim to near-invisibility in dim scene lighting.
    float rimBlend = smoothstep(0.1, 0.95, radialFactor) * floorVisibility;
    litOilColor = mix(litOilColor, groundTinted, rimBlend);

    // 5. Outer Ink Outline blending (stylized comic / Noir outline outside the liquid body)
    vec3 inkOutlineColor = sRGBToLinear(vec3(0.008, 0.006, 0.005));
    vec3 finalRgb = mix(inkOutlineColor, litOilColor, innerOilMask);

    finalRgb *= u_exposure;
    finalRgb = linearToSRGB(finalRgb);

    // Composite alpha: full viscous opacity for oil body, outlineAlpha for the outer contour
    float finalAlpha = mix(outerAlphaMask * outlineAlpha, innerOilMask * u_color.a, innerOilMask);

    fragColor = vec4(finalRgb, finalAlpha);
}