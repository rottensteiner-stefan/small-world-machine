@group(0) @binding(0) var s: sampler;
@group(0) @binding(1) var u_texture: texture_2d<f32>;

struct DownUniforms {
    threshold: f32,
    thresholdMinusKnee: f32,
    twoKnee: f32,
    quarterDivKnee: f32,
    texelWidth: f32,
    texelHeight: f32,
    isFirstPass: f32,
    _pad: f32,
}
@group(0) @binding(2) var<uniform> u: DownUniforms;

fn sanitizeTap(c: vec3f) -> vec3f {
    let validR = select(0.0, clamp(c.r, 0.0, 65504.0), c.r == c.r && c.r >= 0.0 && c.r <= 65504.0);
    let validG = select(0.0, clamp(c.g, 0.0, 65504.0), c.g == c.g && c.g >= 0.0 && c.g <= 65504.0);
    let validB = select(0.0, clamp(c.b, 0.0, 65504.0), c.b == c.b && c.b >= 0.0 && c.b <= 65504.0);
    return max(vec3f(validR, validG, validB), vec3f(0.0));
}

fn prefilter(rawColor: vec3f) -> vec3f {
    let color = sanitizeTap(rawColor);
    let brightness = max(color.r, max(color.g, color.b));
    var soft = brightness - u.thresholdMinusKnee;
    soft = clamp(soft, 0.0, u.twoKnee);
    soft = soft * soft * u.quarterDivKnee;
    let contribution = max(soft, brightness - u.threshold) / max(brightness, 0.00001);
    return color * contribution;
}

fn karisWeight(boxAvg: vec3f) -> f32 {
    let luma = dot(boxAvg, vec3f(0.2126, 0.7152, 0.0722));
    return 1.0 / (1.0 + max(luma, 0.0));
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
    let texelSize = vec2f(u.texelWidth, u.texelHeight);

    var a = textureSample(u_texture, s, vec2f(uv.x - 2.0 * texelSize.x, uv.y + 2.0 * texelSize.y)).rgb;
    var b = textureSample(u_texture, s, vec2f(uv.x,                     uv.y + 2.0 * texelSize.y)).rgb;
    var c = textureSample(u_texture, s, vec2f(uv.x + 2.0 * texelSize.x, uv.y + 2.0 * texelSize.y)).rgb;

    var d = textureSample(u_texture, s, vec2f(uv.x - 2.0 * texelSize.x, uv.y)).rgb;
    var e = textureSample(u_texture, s, vec2f(uv.x,                     uv.y)).rgb;
    var f = textureSample(u_texture, s, vec2f(uv.x + 2.0 * texelSize.x, uv.y)).rgb;

    var g = textureSample(u_texture, s, vec2f(uv.x - 2.0 * texelSize.x, uv.y - 2.0 * texelSize.y)).rgb;
    var h = textureSample(u_texture, s, vec2f(uv.x,                     uv.y - 2.0 * texelSize.y)).rgb;
    var i = textureSample(u_texture, s, vec2f(uv.x + 2.0 * texelSize.x, uv.y - 2.0 * texelSize.y)).rgb;

    var j = textureSample(u_texture, s, vec2f(uv.x - texelSize.x, uv.y + texelSize.y)).rgb;
    var k = textureSample(u_texture, s, vec2f(uv.x + texelSize.x, uv.y + texelSize.y)).rgb;
    var l = textureSample(u_texture, s, vec2f(uv.x - texelSize.x, uv.y - texelSize.y)).rgb;
    var m = textureSample(u_texture, s, vec2f(uv.x + texelSize.x, uv.y - texelSize.y)).rgb;

    if (0.5 < u.isFirstPass) {
        a = prefilter(a); b = prefilter(b); c = prefilter(c);
        d = prefilter(d); e = prefilter(e); f = prefilter(f);
        g = prefilter(g); h = prefilter(h); i = prefilter(i);
        j = prefilter(j); k = prefilter(k); l = prefilter(l); m = prefilter(m);

        let b0 = (j + k + l + m) * 0.25;
        let b1 = (a + b + d + e) * 0.25;
        let b2 = (b + c + e + f) * 0.25;
        let b3 = (d + e + g + h) * 0.25;
        let b4 = (e + f + h + i) * 0.25;

        let w0 = karisWeight(b0) * 0.5;
        let w1 = karisWeight(b1) * 0.125;
        let w2 = karisWeight(b2) * 0.125;
        let w3 = karisWeight(b3) * 0.125;
        let w4 = karisWeight(b4) * 0.125;
        let wSum = max(w0 + w1 + w2 + w3 + w4, 0.00001);
        let karisDownsample = (b0 * w0 + b1 * w1 + b2 * w2 + b3 * w3 + b4 * w4) / wSum;
        return vec4f(karisDownsample, 1.0);
    }

    var downsample = e * 0.125;
    downsample += (a + c + g + i) * 0.03125;
    downsample += (b + d + f + h) * 0.0625;
    downsample += (j + k + l + m) * 0.125;

    return vec4f(downsample, 1.0);
}
