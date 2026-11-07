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

fn prefilter(color: vec3f) -> vec3f {
    let brightness = max(color.r, max(color.g, color.b));
    var soft = brightness - u.thresholdMinusKnee;
    soft = clamp(soft, 0.0, u.twoKnee);
    soft = soft * soft * u.quarterDivKnee;
    let contribution = max(soft, brightness - u.threshold) / max(brightness, 0.00001);
    return color * contribution;
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
    }

    var downsample = e * 0.125;
    downsample += (a + c + g + i) * 0.03125;
    downsample += (b + d + f + h) * 0.0625;
    downsample += (j + k + l + m) * 0.125;

    return vec4f(downsample, 1.0);
}
