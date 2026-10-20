struct MetalReliefUniforms {
    resolution: vec2f,
    time: f32,
    reliefStrength: f32,
    paletteKnifeStrength: f32,
    paletteKnifeScale: f32,
    scratchIntensity: f32,
    scratchScale: f32,
    targetHue: f32,
    hueTolerance: f32,
    desaturation: f32,
    rustStrength: f32,
    edgeGlintStrength: f32,
    wetRainStreaks: f32,
    wireMeshStrength: f32,
    wireMeshScale: f32,
}

@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> u: MetalReliefUniforms;

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

fn getLuma(c: vec3f) -> f32 {
    return dot(c, vec3f(0.299, 0.587, 0.114));
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

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
}

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var out: VertexOutput;
    let x = f32((vertexIndex << 1u) & 2u);
    let y = f32(vertexIndex & 2u);
    out.uv = vec2f(x, 1.0 - y);
    out.position = vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
    return out;
}

@fragment
fn fsMain(in: VertexOutput) -> @location(0) vec4f {
    let texelSize = 1.0 / max(u.resolution, vec2f(1.0));

    let l00 = getLuma(textureSample(uTexture, uSampler, in.uv + vec2f(-1.0, -1.0) * texelSize).rgb);
    let l10 = getLuma(textureSample(uTexture, uSampler, in.uv + vec2f( 0.0, -1.0) * texelSize).rgb);
    let l20 = getLuma(textureSample(uTexture, uSampler, in.uv + vec2f( 1.0, -1.0) * texelSize).rgb);

    let l01 = getLuma(textureSample(uTexture, uSampler, in.uv + vec2f(-1.0,  0.0) * texelSize).rgb);
    let centerTex = textureSample(uTexture, uSampler, in.uv);
    let l11 = getLuma(centerTex.rgb);
    let l21 = getLuma(textureSample(uTexture, uSampler, in.uv + vec2f( 1.0,  0.0) * texelSize).rgb);

    let l02 = getLuma(textureSample(uTexture, uSampler, in.uv + vec2f(-1.0,  1.0) * texelSize).rgb);
    let l12 = getLuma(textureSample(uTexture, uSampler, in.uv + vec2f( 0.0,  1.0) * texelSize).rgb);
    let l22 = getLuma(textureSample(uTexture, uSampler, in.uv + vec2f( 1.0,  1.0) * texelSize).rgb);

    let dX = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
    let dY = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
    let edgeMag = length(vec2f(dX, dY));

    let facets = mr_voronoiFacets(in.uv, u.paletteKnifeScale);
    let facetSlope = facets.xy;

    let reliefN = normalize(vec3f(-dX * u.reliefStrength + facetSlope.x * u.paletteKnifeStrength * 0.3,
                                  -dY * u.reliefStrength + facetSlope.y * u.paletteKnifeStrength * 0.3,
                                  1.0));

    let scratchCoord = (in.uv.x * 0.85 + in.uv.y * 0.53) * u.scratchScale;
    let scratchH = mr_hash(vec2f(floor(scratchCoord), 1.0));
    let scratchNoise = 0.7 + 0.3 * sin(scratchCoord * 6.28318 + scratchH * 6.28);
    var scratchFactor = mix(1.0, scratchNoise, u.scratchIntensity);

    if (u.wireMeshStrength > 0.01) {
        let mUv = fract(in.uv * u.wireMeshScale) - vec2f(0.5);
        let diamond = abs(mUv.x) * 1.5 + abs(mUv.y);
        let wire = smoothstep(0.42, 0.48, diamond) - smoothstep(0.52, 0.58, diamond);
        scratchFactor *= (1.0 - wire * u.wireMeshStrength * 0.5);
    }

    let hsv = mr_rgb2hsv(centerTex.rgb);
    var hueDiff = abs(hsv.x - u.targetHue);
    hueDiff = min(hueDiff, 1.0 - hueDiff);

    let colorMask = smoothstep(u.hueTolerance, u.hueTolerance * 0.3, hueDiff) * smoothstep(0.2, 0.4, hsv.y);

    let rustShadow = vec3f(0.38, 0.22, 0.12) * u.rustStrength + vec3f(l11 * 0.6) * (1.0 - u.rustStrength);
    let steelMid   = vec3f(0.52, 0.56, 0.60) * l11;
    let zincHigh   = vec3f(0.88, 0.90, 0.94) * l11;

    var metalGrad = mix(rustShadow, steelMid, clamp(l11 * 2.2, 0.0, 1.0));
    metalGrad = mix(metalGrad, zincHigh, clamp((l11 - 0.45) * 2.2, 0.0, 1.0));

    let steelAlbedo = mix(centerTex.rgb, metalGrad, u.desaturation);
    let finalAlbedo = mix(steelAlbedo, centerTex.rgb, colorMask) * scratchFactor;

    let L = normalize(vec3f(0.5, 0.7, 0.5));
    let V = vec3f(0.0, 0.0, 1.0);
    let H = normalize(L + V);

    let NdotL = max(dot(reliefN, L), 0.0);
    let NdotH = max(dot(reliefN, H), 0.0);

    let edgeGlint = clamp(edgeMag * 4.0 * u.edgeGlintStrength, 0.0, 1.0);
    let spec = pow(NdotH, 32.0) * (0.4 + 0.6 * edgeGlint);

    var specColor = vec3f(0.9, 0.92, 0.96) * spec * (0.5 + 0.5 * edgeGlint);

    if (u.wetRainStreaks > 0.01) {
        let streakHash = mr_hash(vec2f(floor(in.uv.x * u.resolution.x * 0.15), 3.14));
        let streak = pow(streakHash, 14.0) * smoothstep(0.45, 0.95, in.uv.y) * u.wetRainStreaks;
        specColor += vec3f(0.9, 0.95, 1.0) * streak;
    }

    let shadedColor = finalAlbedo * (0.35 + 0.75 * NdotL) + specColor;
    return vec4f(shadedColor, centerTex.a);
}
