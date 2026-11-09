// Auto exposure (ADR 0061), step 1: reduces the HDR frame to a 16x16 grid of center-weighted
// log2 luminance. Each output texel averages 4x4 bilinear taps over its 1/16 screen footprint.
// Output: r = weight * mean(log2 L), g = weight. CPU mirror of the weighting: AutoExposure.test.ts.

@group(0) @binding(0) var srcSampler: sampler;
@group(0) @binding(1) var srcTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: vec4f; // x: centerWeight

const TAPS_PER_AXIS: i32 = 4;
const TAP_SPACING: f32 = 1.0 / 64.0; // 16 texels x 4 taps across the frame
const MIN_LUMINANCE: f32 = 1e-4;
const MIN_WEIGHT: f32 = 0.05;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
    var sumLog = 0.0;
    for (var y = 0; y < TAPS_PER_AXIS; y++) {
        for (var x = 0; x < TAPS_PER_AXIS; x++) {
            let offset = (vec2f(f32(x), f32(y)) - 1.5) * TAP_SPACING;
            let c = textureSampleLevel(srcTexture, srcSampler, uv + offset, 0.0).rgb;
            let lum = dot(c, vec3f(0.2126, 0.7152, 0.0722));
            // NaN/Inf scene pixels must not poison the whole average.
            let safeLum = select(MIN_LUMINANCE, lum, lum == lum && lum < 65504.0);
            sumLog += log2(max(safeLum, MIN_LUMINANCE));
        }
    }
    let meanLog = sumLog / f32(TAPS_PER_AXIS * TAPS_PER_AXIS);
    let radius = length(uv - 0.5) * 2.0;
    let weight = mix(1.0, max(1.0 - radius, MIN_WEIGHT), params.x);
    return vec4f(meanLog * weight, weight, 0.0, 1.0);
}
