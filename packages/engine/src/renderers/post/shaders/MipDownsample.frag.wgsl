@group(0) @binding(0) var s: sampler;
@group(0) @binding(1) var u_texture: texture_2d<f32>;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
    return textureSample(u_texture, s, uv);
}
