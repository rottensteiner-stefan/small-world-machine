// Auto exposure (ADR 0061), step 2 (1x1 target): weighted mean of the 16x16 log-luminance grid ->
// target EV -> exponential adaptation from the previous EV. Output: r = 2^ev (multiplier), g = ev.
// CPU mirror: autoExposureStep() in AutoExposureElement.ts.

@group(0) @binding(0) var lumTexture: texture_2d<f32>;
@group(0) @binding(1) var prevTexture: texture_2d<f32>;
// a = (minEv, maxEv, compensationEv, deltaTime), b = (speedDark, speedBright, snap, 0)
@group(0) @binding(2) var<uniform> params: array<vec4f, 2>;

const GRID: i32 = 16;
const LOG2_KEY: f32 = -2.4739311883324; // log2(0.18)

@fragment
fn fs_main() -> @location(0) vec4f {
    var sumW = 0.0;
    var sumLogW = 0.0;
    for (var y = 0; y < GRID; y++) {
        for (var x = 0; x < GRID; x++) {
            let t = textureLoad(lumTexture, vec2i(x, y), 0);
            sumLogW += t.r;
            sumW += t.g;
        }
    }
    let a = params[0];
    let b = params[1];
    let avgLog = sumLogW / max(sumW, 1e-4);
    let targetEv = clamp(LOG2_KEY - avgLog + a.z, a.x, a.y);
    let prevEv = textureLoad(prevTexture, vec2i(0, 0), 0).g;
    let rate = select(b.y, b.x, targetEv > prevEv);
    let blended = prevEv + (targetEv - prevEv) * (1.0 - exp(-max(a.w, 0.0) * rate));
    let finite = blended == blended && abs(blended) < 64.0;
    let ev = select(targetEv, blended, b.z < 0.5 && finite);
    return vec4f(exp2(ev), ev, 0.0, 1.0);
}
