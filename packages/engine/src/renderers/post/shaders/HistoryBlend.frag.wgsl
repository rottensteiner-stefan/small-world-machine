@group(0) @binding(0) var taaSampler: sampler;
@group(0) @binding(1) var currentTexture: texture_2d<f32>;
@group(0) @binding(2) var historyTexture: texture_2d<f32>;

struct HistoryBlendUniforms {
    feedback: f32,
    hasHistory: f32, // 0.0 or 1.0
    pad0: f32,
    pad1: f32,
}
@group(0) @binding(3) var<uniform> u: HistoryBlendUniforms;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
    let current = textureSample(currentTexture, taaSampler, uv).rgb;

    if (u.hasHistory < 0.5) {
        return vec4f(current, 1.0);
    }

    let history = textureSample(historyTexture, taaSampler, uv).rgb;
    let resolved = mix(current, history, u.feedback);
    return vec4f(resolved, 1.0);
}
