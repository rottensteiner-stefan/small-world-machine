@group(0) @binding(0) var s: sampler;
@group(0) @binding(1) var u_texture: texture_2d<f32>;

struct UpUniforms {
    texelWidth: f32,
    texelHeight: f32,
    radius: f32,
    _pad: f32,
}
@group(0) @binding(2) var<uniform> u: UpUniforms;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
    let x = u.radius * u.texelWidth;
    let y = u.radius * u.texelHeight;

    let a = textureSample(u_texture, s, vec2f(uv.x - x, uv.y + y)).rgb;
    let b = textureSample(u_texture, s, vec2f(uv.x,     uv.y + y)).rgb;
    let c = textureSample(u_texture, s, vec2f(uv.x + x, uv.y + y)).rgb;

    let d = textureSample(u_texture, s, vec2f(uv.x - x, uv.y)).rgb;
    let e = textureSample(u_texture, s, vec2f(uv.x,     uv.y)).rgb;
    let f = textureSample(u_texture, s, vec2f(uv.x + x, uv.y)).rgb;

    let g = textureSample(u_texture, s, vec2f(uv.x - x, uv.y - y)).rgb;
    let h = textureSample(u_texture, s, vec2f(uv.x,     uv.y - y)).rgb;
    let i = textureSample(u_texture, s, vec2f(uv.x + x, uv.y - y)).rgb;

    var upsample = e * 4.0;
    upsample += (b + d + f + h) * 2.0;
    upsample += (a + c + g + i);
    upsample *= 1.0 / 16.0;

    return vec4f(upsample, 1.0);
}
