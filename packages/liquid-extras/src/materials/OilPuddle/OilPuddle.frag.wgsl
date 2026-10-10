// [THIN_FILM_DECL]

fn hash(p: vec2f) -> f32 {
    let q = vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)));
    return fract(sin(q.x) * 43758.5453);
}

fn noise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let a = hash(i + vec2f(0.0, 0.0));
    let b = hash(i + vec2f(1.0, 0.0));
    let c = hash(i + vec2f(0.0, 1.0));
    let d = hash(i + vec2f(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// First-class OilPuddleMaterial (moved from the-whisper app into @small-world-machine/liquid-extras):
// a settled, viscous oil puddle in the Graphic-Noir style. Parameter carriage uses the dedicated
// semantic matParam lanes 0..5 (see OilPuddleMaterial.ts); no standard slot is repurposed.
// The thin-film model is the canonical shared module (oilFilmThinFilm), injected above.
@fragment fn fs(i: Out) -> @location(0) vec4f {
    let time = obj.matParam0.x;
    let iridescenceStrength = obj.matParam0.y;
    let timeScale = obj.matParam0.z;
    let ringEnabled = obj.matParam0.w;
    let highlightPoint = obj.matParam1.xy;
    let highlightRadius = max(obj.matParam1.z, 0.001);
    let highlightIntensity = obj.matParam1.w;
    let splatterBaseRadius = obj.matParam2.x;
    let splatterNoiseAmp = obj.matParam2.y;
    let outlineWidth = max(obj.matParam2.z, 0.0);
    let outlineAlpha = select(0.85, obj.matParam2.w, obj.matParam2.w > 0.0);
    let meniscusStrength = select(0.65, obj.matParam3.x, obj.matParam3.x > 0.0);
    let rimDarkening = select(0.95, obj.matParam3.y, obj.matParam3.y > 0.0);
    let floorVisibility = clamp(obj.matParam3.z, 0.0, 1.0);
    let wrinkleStrength = obj.matParam3.w;
    let ringCount = obj.matParam4.x;
    let ringReach = obj.matParam4.y;
    let ringSoftness = obj.matParam4.z;
    let envColor = sRGBToLinear(obj.matParam5.xyz);
    let envReflectivity = obj.matParam5.w;

    // 1. Organic splatter mask & 2-stage ink outline (inner oil pool + outer graphic novel contour)
    let localUV = i.uv - vec2f(0.5);
    let distFromCenter = length(localUV);
    let angle = atan2(localUV.y, localUV.x);
    let noiseCoord = vec2f(cos(angle), sin(angle)) * 3.0;
    let edgeNoise = noise(noiseCoord);
    let radius = splatterBaseRadius + edgeNoise * splatterNoiseAmp;
    let outerRadius = radius + outlineWidth;

    // Discard outside the outermost ink contour
    let outerAlphaMask = smoothstep(outerRadius + 0.01, outerRadius - 0.01, distFromCenter);
    if (outerAlphaMask < 0.05) {
        discard;
    }

    // Inner oil body mask: 1.0 inside oil pool, 0.0 in the outer outline ring
    let innerOilMask = smoothstep(radius + 0.01, radius - 0.01, distFromCenter);

    // 2. Synthetic meniscus normal perturbation (procedural edge curvature catching specular light)
    var localNormal = normalize(i.n);
    let edgeDist = radius - distFromCenter;
    let meniscusBand = max(splatterBaseRadius * 0.35, 0.02);
    if (edgeDist > -0.02 && edgeDist < meniscusBand) {
        let edgeFactor = 1.0 - clamp(edgeDist / meniscusBand, 0.0, 1.0);
        let outwardDir = select(vec2f(0.0), normalize(localUV), distFromCenter > 0.0001);
        localNormal.x += outwardDir.x * edgeFactor * meniscusStrength;
        localNormal.z += outwardDir.y * edgeFactor * meniscusStrength;
        localNormal = normalize(localNormal);
    }

    // v4 Tar-Skin creases: optional subtle wrinkle perturbation on the oil body (gated, 0 = off).
    if (innerOilMask > 0.0001 && wrinkleStrength > 0.0001) {
        let w1 = noise(i.wp.xz * 23.0) * 2.0 - 1.0;
        let w2 = noise(i.wp.xz * 31.0 + 7.7) * 2.0 - 1.0;
        localNormal.x += w1 * wrinkleStrength * 0.12;
        localNormal.z += w2 * wrinkleStrength * 0.12;
        localNormal = normalize(localNormal);
    }

    // Evaluate lighting using perturbed normal in a scoped block
    var final_fL = vec3f(0.0);
    var final_spec = vec3f(0.0);
    {
        var i_perturbed = i;
        i_perturbed.n = localNormal;
        let i = i_perturbed;
        [WGSL_LIGHTING]
        final_fL = fL;
        final_spec = spec;
    }
    let fL = final_fL;
    let spec = final_spec;

    let viewDir = normalize(global.viewPos.xyz - i.wp);
    let nDir = localNormal;
    let NdotV = max(dot(nDir, viewDir), 0.0);

    // 3. Base colour gradient: warm amber-brown core -> deep noir tar-black edge
    let coreColor = sRGBToLinear(obj.color.rgb);
    let edgeColor = sRGBToLinear(vec3f(0.012, 0.009, 0.007)); // Noir deep tar black

    // Grounded rim: sample the real floor colour beneath the puddle (captured just before this
    // transparent pass, see u_opaqueMap fallback) and tint it dark by the oil, so the thin rim
    // reads as translucent film over actual pavement instead of a flat painted ring.
    let groundScreenRes = vec2f(textureDimensions(u_opaqueMap));
    let groundScreenUv = i.pos.xy / groundScreenRes;
    let groundColor = sRGBToLinear(textureSample(u_opaqueMap, s, groundScreenUv).rgb);
    // Tint by edgeColor's hue only (normalized to its brightest channel), not its raw magnitude --
    // multiplying by edgeColor directly crushes the real floor brightness to near-zero.
    let edgeHue = edgeColor / max(max(edgeColor.r, max(edgeColor.g, edgeColor.b)), 0.0001);
    let groundTinted = groundColor * mix(vec3f(1.0), edgeHue, 0.7);

    let radialFactor = clamp(distFromCenter / max(radius, 0.001), 0.0, 1.0);
    let baseColor = mix(coreColor, edgeColor, smoothstep(0.1, 0.95, radialFactor) * rimDarkening);

    // Subtle thin-film shimmer: two independently-scrolling noise layers (opposite directions/
    // speeds, per the Godot reference in .agents/notes/oil.md) combined into the thickness
    // variation, giving the shimmer a wandering "wave" structure instead of a single static-
    // frequency drift. Colour-only -- no spatial animation; timeScale = volatility (petrol/diesel).
    let waveUvA = i.wp.xz * 4.0 + time * vec2f(0.02, 0.015) * timeScale;
    let waveUvB = i.wp.xz * 5.5 - time * vec2f(0.015, 0.025) * timeScale;
    let swirl = noise(waveUvA) * 0.5 + noise(waveUvB) * 0.5;
    let thickness = 0.5 + swirl * 0.5;
    let iridescence = oilFilmThinFilm(NdotV, thickness, iridescenceStrength);
    let fresnel = pow(1.0 - NdotV, 4.0);
    let colorWithSheen = mix(baseColor, iridescence, fresnel * iridescenceStrength);

    // 4. Localised warm glow pooling near the drip point under the barrel
    let glowDist = distance(i.uv, highlightPoint);
    let glow = highlightIntensity * exp(-(glowDist * glowDist) / (highlightRadius * highlightRadius));

    let tint = sRGBToLinear(obj.specColor.rgb);

    // Analytic environment reflection (envColor carried in matParam5): no real cubemap probe by
    // default, so the "reflected surroundings" are approximated as a dim ambient tone weighted by
    // Schlick Fresnel. F0 = Khronos KHR_materials_ior for IOR=1.333 (oil/water), 0.0204.
    let envF0 = 0.0204;
    let envFresnel = envF0 + (1.0 - envF0) * pow(1.0 - NdotV, 5.0);
    let envReflection = envColor * envFresnel * envReflectivity;

    var litOilColor = colorWithSheen * fL + spec * tint + tint * glow + envReflection;

    // v6 Graphic Poster Rainbow Rings: flat, deliberate, muted concentric bands radiating from the
    // drip point (poster-illustration style). Desaturated via oilFilmRainbow's strength. Gated by
    // ringEnabled (0 = off); poster rings are muted, never a bright saturated rainbow.
    if (ringEnabled > 0.5 && ringCount > 0.5) {
        let rgDist = distance(i.uv, highlightPoint);
        let ringReachSafe = max(ringReach, 0.02);
        let bandPos = clamp(rgDist / ringReachSafe, 0.0, 1.0);
        let bandVal = fract(bandPos * ringCount + time * 0.05);
        let bandBand = 1.0 - smoothstep(0.0, max(ringSoftness, 0.0001), bandVal);
        let reachFade = 1.0 - smoothstep(ringReachSafe - 0.01, ringReachSafe, rgDist);
        let ringMask = bandBand * reachFade * 0.45;
        let ringColor = oilFilmRainbow(fract(bandPos) * 6.2831853, 0.45);
        litOilColor = mix(litOilColor, ringColor, clamp(ringMask, 0.0, 1.0));
    }

    // Grounded rim overlay: blend in the real floor colour AFTER lighting -- folding it into
    // baseColor and re-lighting it double-darkens the rim.
    let rimBlend = smoothstep(0.1, 0.95, radialFactor) * floorVisibility;
    litOilColor = mix(litOilColor, groundTinted, rimBlend);

    // 5. Outer Ink Outline blending (stylized comic / Noir outline outside the liquid body)
    let inkOutlineColor = sRGBToLinear(vec3f(0.008, 0.006, 0.005));
    let finalRgbLinear = mix(inkOutlineColor, litOilColor, innerOilMask);

    var litColor = finalRgbLinear * global.exposure;
    litColor = linearToSRGB(litColor);

    // Composite alpha: full viscous opacity for oil body, outlineAlpha for the outer contour
    let finalAlpha = mix(outerAlphaMask * outlineAlpha, innerOilMask * obj.color.a, innerOilMask);

    return vec4f(litColor, finalAlpha);
}
