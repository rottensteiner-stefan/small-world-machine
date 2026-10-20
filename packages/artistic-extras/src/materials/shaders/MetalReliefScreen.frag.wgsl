fn mrs_hash(p: vec2f) -> f32 {
    let p3 = fract(vec3f(p.xyx) * 0.1031);
    let p4 = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p4.x + p4.y) * p4.z);
}

fn mrs_hash2(p: vec2f) -> vec2f {
    let p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
    let p4 = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p4.xx + p4.yz) * p4.zy);
}

fn mrs_rgb2hsv(c: vec3f) -> vec3f {
    let K = vec4f(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    let p = mix(vec4f(c.bg, K.wz), vec4f(c.gb, K.xy), step(c.b, c.g));
    let q = mix(vec4f(p.xyw, c.r), vec4f(c.r, p.yzx), step(p.x, c.r));

    let d = q.x - min(q.w, q.y);
    let e = 1.0e-10;
    return vec3f(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn mrs_luma(c: vec3f) -> f32 {
    return dot(c, vec3f(0.299, 0.587, 0.114));
}

fn mrs_voronoiFacets(uv: vec2f, scale: f32) -> vec3f {
    let st = uv * scale;
    let i_st = floor(st);
    let f_st = fract(st);

    var minDist: f32 = 8.0;
    var bestCell: vec2f = vec2f(0.0);

    for (var y: i32 = -1; y <= 1; y = y + 1) {
        for (var x: i32 = -1; x <= 1; x = x + 1) {
            let neighbor = vec2f(f32(x), f32(y));
            let point = mrs_hash2(i_st + neighbor);
            let diff = neighbor + point - f_st;
            let dist = dot(diff, diff);
            if (dist < minDist) {
                minDist = dist;
                bestCell = i_st + neighbor;
            }
        }
    }

    let slope = (mrs_hash2(bestCell * 1.33) - vec2f(0.5)) * 2.0;
    let facetHeight = mrs_hash(bestCell * 0.77);
    return vec3f(slope, facetHeight);
}

@fragment fn fs(i: Out) -> @location(0) vec4f {
    let reliefStrength       = obj.extraParams.x;
    let paletteKnifeStrength = obj.extraParams.y;
    let paletteKnifeScale    = obj.extraParams.z;
    let scratchIntensity     = obj.extraParams.w;

    let scratchScale         = obj.liquidParams.x;
    let edgeGlintStrength    = obj.liquidParams.y;
    let wetRainStreaks       = obj.liquidParams.z;
    let wireMeshStrength     = obj.liquidParams.w;

    let targetHue            = obj.styleA.x;
    let hueTolerance         = obj.styleA.y;
    let desaturation         = obj.styleA.z;
    let rustStrength         = obj.styleA.w;

    let texelSize = vec2f(1.0 / 512.0, 1.0 / 512.0);

    let l00 = mrs_luma(textureSample(u_diffuseMap, s, i.uv + vec2f(-1.0, -1.0) * texelSize).rgb);
    let l10 = mrs_luma(textureSample(u_diffuseMap, s, i.uv + vec2f( 0.0, -1.0) * texelSize).rgb);
    let l20 = mrs_luma(textureSample(u_diffuseMap, s, i.uv + vec2f( 1.0, -1.0) * texelSize).rgb);

    let l01 = mrs_luma(textureSample(u_diffuseMap, s, i.uv + vec2f(-1.0,  0.0) * texelSize).rgb);
    let centerTex = textureSample(u_diffuseMap, s, i.uv);
    let l11 = mrs_luma(centerTex.rgb);
    let l21 = mrs_luma(textureSample(u_diffuseMap, s, i.uv + vec2f( 1.0,  0.0) * texelSize).rgb);

    let l02 = mrs_luma(textureSample(u_diffuseMap, s, i.uv + vec2f(-1.0,  1.0) * texelSize).rgb);
    let l12 = mrs_luma(textureSample(u_diffuseMap, s, i.uv + vec2f( 0.0,  1.0) * texelSize).rgb);
    let l22 = mrs_luma(textureSample(u_diffuseMap, s, i.uv + vec2f( 1.0,  1.0) * texelSize).rgb);

    let dX = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
    let dY = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
    let edgeMag = length(vec2f(dX, dY));

    let facets = mrs_voronoiFacets(i.uv, paletteKnifeScale);
    let facetSlope = facets.xy;

    let reliefN = normalize(vec3f(-dX * reliefStrength + facetSlope.x * paletteKnifeStrength * 0.35,
                                  -dY * reliefStrength + facetSlope.y * paletteKnifeStrength * 0.35,
                                  1.0));

    let scratchCoord = (i.uv.x * 0.85 + i.uv.y * 0.53) * scratchScale;
    let scratchH = mrs_hash(vec2f(floor(scratchCoord), 1.0));
    let scratchNoise = 0.7 + 0.3 * sin(scratchCoord * 6.28318 + scratchH * 6.28);
    let scratchFactor = mix(1.0, scratchNoise, scratchIntensity);

    let hsv = mrs_rgb2hsv(centerTex.rgb);
    var hueDiff = abs(hsv.x - targetHue);
    hueDiff = min(hueDiff, 1.0 - hueDiff);

    let colorMask = smoothstep(hueTolerance, hueTolerance * 0.3, hueDiff) * smoothstep(0.2, 0.4, hsv.y);

    let rustShadow = vec3f(0.38, 0.22, 0.12) * rustStrength + vec3f(l11 * 0.6) * (1.0 - rustStrength);
    let steelMid   = vec3f(0.52, 0.56, 0.60) * l11;
    let zincHigh   = vec3f(0.88, 0.90, 0.94) * l11;

    var metalGrad = mix(rustShadow, steelMid, clamp(l11 * 2.2, 0.0, 1.0));
    metalGrad = mix(metalGrad, zincHigh, clamp((l11 - 0.45) * 2.2, 0.0, 1.0));

    let steelAlbedo = mix(centerTex.rgb, metalGrad, desaturation);
    let finalAlbedo = mix(steelAlbedo, centerTex.rgb, colorMask) * scratchFactor;

    let L = normalize(vec3f(0.5, 0.7, 0.5));
    let V = vec3f(0.0, 0.0, 1.0);
    let H = normalize(L + V);

    let NdotL = max(dot(reliefN, L), 0.0);
    let NdotH = max(dot(reliefN, H), 0.0);

    let edgeGlint = clamp(edgeMag * 4.0 * edgeGlintStrength, 0.0, 1.0);
    let spec = pow(NdotH, 32.0) * (0.4 + 0.6 * edgeGlint);

    var specColor = vec3f(0.9, 0.92, 0.96) * spec * (0.5 + 0.5 * edgeGlint);

    if (wetRainStreaks > 0.01) {
        let streakHash = mrs_hash(vec2f(floor(i.uv.x * 240.0), 3.14));
        let streak = pow(streakHash, 14.0) * smoothstep(0.45, 0.95, i.uv.y) * wetRainStreaks;
        specColor += vec3f(0.9, 0.95, 1.0) * streak;
    }

    var color = finalAlbedo * (0.35 + 0.75 * NdotL) + specColor;

    let splitPos = obj.styleB.x;
    if (splitPos >= 0.0 && i.uv.x < splitPos) {
        color = centerTex.rgb;
    }

    [WGSL_FOG_CALC]

    return vec4f(color, centerTex.a);
}
