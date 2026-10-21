fn mr_hash(p: vec2f) -> f32 {
    let p3 = fract(vec3f(p.xyx) * 0.1031);
    let p4 = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p4.x + p4.y) * p4.z);
}

fn mr_hash2(p: vec2f) -> vec2f {
    let p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
    let p4 = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p4.xx + p4.yz) * p4.zy);
}

fn mr_rgb2hsv(c: vec3f) -> vec3f {
    let K = vec4f(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    let p = mix(vec4f(c.bg, K.wz), vec4f(c.gb, K.xy), step(c.b, c.g));
    let q = mix(vec4f(p.xyw, c.r), vec4f(c.r, p.yzx), step(p.x, c.r));

    let d = q.x - min(q.w, q.y);
    let e = 1.0e-10;
    return vec3f(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn mr_voronoiFacets(uv: vec2f, scale: f32) -> vec3f {
    let st = uv * scale;
    let i_st = floor(st);
    let f_st = fract(st);

    var minDist: f32 = 8.0;
    var bestCell: vec2f = vec2f(0.0);

    for (var y: i32 = -1; y <= 1; y = y + 1) {
        for (var x: i32 = -1; x <= 1; x = x + 1) {
            let neighbor = vec2f(f32(x), f32(y));
            let point = mr_hash2(i_st + neighbor);
            let diff = neighbor + point - f_st;
            let dist = dot(diff, diff);
            if (dist < minDist) {
                minDist = dist;
                bestCell = i_st + neighbor;
            }
        }
    }

    let slope = (mr_hash2(bestCell * 1.33) - vec2f(0.5)) * 2.0;
    let facetHeight = mr_hash(bestCell * 0.77);
    return vec3f(slope, facetHeight);
}

@fragment fn fs(i: Out) -> @location(0) vec4f {
    let paletteKnifeStrength = obj.matParam0.x;
    let paletteKnifeScale    = obj.matParam0.y;
    let scratchIntensity     = obj.matParam0.z;
    let scratchScale         = obj.matParam0.w;

    let edgeBevelStrength    = obj.matParam1.x;
    let wireMeshStrength     = obj.matParam1.y;
    let wireMeshScale        = obj.matParam1.z;
    let wetRainStreaks       = obj.matParam1.w;

    let targetHue            = obj.styleA.x;
    let hueTolerance         = obj.styleA.y;
    let desaturation         = obj.styleA.z;
    let rustStrength         = obj.styleA.w;

    let texel = textureSample(u_diffuseMap, s, i.uv);
    let baseAlbedo = texel * obj.color;

    // 1. Voronoi Facets
    let facets = mr_voronoiFacets(i.uv, paletteKnifeScale);
    let facetSlope = facets.xy;

    let N = normalize(i.n);
    let up = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(N.y) < 0.999);
    let T = normalize(cross(up, N));
    let B = cross(N, T);

    var perturbedN = normalize(N + (T * facetSlope.x + B * facetSlope.y) * paletteKnifeStrength);

    // 2. Scratches
    let scratchCoord = (i.uv.x * 0.85 + i.uv.y * 0.53) * scratchScale;
    let scratchH = mr_hash(vec2f(floor(scratchCoord), 1.0));
    let scratchNoise = 0.7 + 0.3 * sin(scratchCoord * 6.28318 + scratchH * 6.28);
    var scratchFactor = mix(1.0, scratchNoise, scratchIntensity);

    // 3. Wire mesh
    if (wireMeshStrength > 0.01) {
        let mUv = fract(i.uv * wireMeshScale) - vec2f(0.5);
        let diamond = abs(mUv.x) * 1.5 + abs(mUv.y);
        let wire = smoothstep(0.42, 0.48, diamond) - smoothstep(0.52, 0.58, diamond);
        perturbedN = normalize(perturbedN + (T * (mUv.x * wire) + B * (mUv.y * wire)) * wireMeshStrength * 2.0);
        scratchFactor *= (1.0 - wire * wireMeshStrength * 0.4);
    }

    // 4. Edge bevel / Curvature
    let curvature = length(abs(dpdx(perturbedN)) + abs(dpdy(perturbedN))) * 6.0;
    let edgeGlint = clamp(curvature * edgeBevelStrength, 0.0, 1.0);

    // 5. Selective Color
    let hsv = mr_rgb2hsv(baseAlbedo.rgb);
    var hueDiff = abs(hsv.x - targetHue);
    hueDiff = min(hueDiff, 1.0 - hueDiff);

    let colorMask = smoothstep(hueTolerance, hueTolerance * 0.3, hueDiff) * smoothstep(0.2, 0.4, hsv.y);
    let luma = dot(baseAlbedo.rgb, vec3f(0.299, 0.587, 0.114));

    let rustShadow = vec3f(0.38, 0.22, 0.12) * rustStrength + vec3f(luma * 0.6) * (1.0 - rustStrength);
    let steelMid   = vec3f(0.52, 0.56, 0.60) * luma;
    let zincHigh   = vec3f(0.88, 0.90, 0.94) * luma;

    var metalGrad = mix(rustShadow, steelMid, clamp(luma * 2.2, 0.0, 1.0));
    metalGrad = mix(metalGrad, zincHigh, clamp((luma - 0.45) * 2.2, 0.0, 1.0));

    let steelAlbedo = mix(baseAlbedo.rgb, metalGrad, desaturation);
    let finalAlbedo = mix(steelAlbedo, baseAlbedo.rgb, colorMask) * scratchFactor;

    var dynamicMetallic = mix(obj.metallic, 0.95, edgeGlint * 0.8);
    var dynamicRoughness = mix(obj.roughness, 0.08, edgeGlint * 0.9);

    if (wetRainStreaks > 0.01) {
        let streakHash = mr_hash(vec2f(floor(i.uv.x * 120.0), 3.14));
        let streak = pow(streakHash, 14.0) * smoothstep(0.4, 0.9, i.uv.y) * wetRainStreaks;
        dynamicRoughness = mix(dynamicRoughness, 0.04, streak);
        dynamicMetallic  = mix(dynamicMetallic, 0.98, streak);
    }

    let L = normalize(vec3f(0.4, 0.8, 0.5));
    let V = normalize(-i.wp);
    let H = normalize(L + V);

    let NdotL = max(dot(perturbedN, L), 0.0);
    let NdotH = max(dot(perturbedN, H), 0.0);

    let specPower = mix(16.0, 128.0, 1.0 - dynamicRoughness);
    let spec = pow(NdotH, specPower) * (1.0 - dynamicRoughness);

    let specColor = mix(vec3f(0.3), vec3f(1.0, 0.98, 0.95), dynamicMetallic) + vec3f(edgeGlint * 0.7);

    let diffuseLight = finalAlbedo * (vec3f(0.25) + vec3f(0.85) * NdotL);
    let specularLight = specColor * spec * select(0.0, 1.0, NdotL > 0.0);

    var color = diffuseLight + specularLight;
    [WGSL_FOG_CALC]

    return vec4f(color, baseAlbedo.a);
}
