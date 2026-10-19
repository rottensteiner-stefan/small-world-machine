struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

struct DofUniforms {
    near: f32,
    far: f32,
    focusDistance: f32,
    cocScale: f32,
    maxCoc: f32,
    pad0: f32,
    pad1: f32,
    pad2: f32,
}

@group(0) @binding(0) var linearSampler: sampler;
@group(0) @binding(1) var cocMap: texture_2d<f32>;
@group(0) @binding(2) var<uniform> u: DofUniforms;

const TAP_COUNT: u32 = 64u;
const GOLDEN_ANGLE: f32 = 2.39996323;
const HALF_RES_RADIUS_SCALE: f32 = 0.25;
// Fraction of covering near-field taps at which the composite fully switches to the gathered
// result; below it the sharp full-res pixel shows through the thin edge of the foreground blur.
const NEAR_COVERAGE_GAIN: f32 = 4.0;

// Scatter-as-gather bokeh: every tap asks "does this sample's blur disc reach me?" instead of
// scattering sprites, so the cost is fixed per pixel.
@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    let texel = 1.0 / vec2f(textureDimensions(cocMap));
    let center = textureSampleLevel(cocMap, linearSampler, in.uv, 0.0);
    let centerRadius = abs(center.a);
    let maxRadius = u.maxCoc * HALF_RES_RADIUS_SCALE;

    var acc = center.rgb;
    var total = 1.0;
    var nearCovering = 0.0;
    for (var i = 0u; i < TAP_COUNT; i++) {
        let fi = f32(i);
        let radius = sqrt((fi + 0.5) / f32(TAP_COUNT)) * maxRadius;
        let theta = fi * GOLDEN_ANGLE;
        let offset = vec2f(cos(theta), sin(theta)) * radius * texel;
        let s = textureSampleLevel(cocMap, linearSampler, in.uv + offset, 0.0);

        let isBehind = step(center.a, s.a);
        // A sample behind the centre may spread no wider than the centre's own blur: a sharp
        // foreground must never be overdrawn by the defocused background behind it.
        let sampleRadius = mix(abs(s.a), min(abs(s.a), centerRadius * 2.0), isBehind);
        let covers = smoothstep(radius - 0.5, radius + 0.5, sampleRadius);

        acc += mix(acc / total, s.rgb, covers);
        total += 1.0;
        nearCovering += covers * (1.0 - isBehind);
    }

    let nearCoverage = clamp(nearCovering / f32(TAP_COUNT) * NEAR_COVERAGE_GAIN, 0.0, 1.0);
    return vec4f(acc / total, nearCoverage);
}
