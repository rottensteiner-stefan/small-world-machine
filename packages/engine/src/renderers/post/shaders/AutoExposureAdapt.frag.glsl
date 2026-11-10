#version 300 es
// Auto exposure (ADR 0061), step 2 -- mirrors AutoExposureAdapt.frag.wgsl.
precision highp float;

out vec4 fragColor;

uniform sampler2D u_luminance;
uniform sampler2D u_previous;
uniform vec4 u_paramsA; // (minEv, maxEv, compensationEv, deltaTime)
uniform vec4 u_paramsB; // (speedDark, speedBright, snap, 0)

const int GRID = 16;
const float LOG2_KEY = -2.4739311883324; // log2(0.18)

void main() {
    float sumW = 0.0;
    float sumLogW = 0.0;
    for (int y = 0; y < GRID; y++) {
        for (int x = 0; x < GRID; x++) {
            vec4 t = texelFetch(u_luminance, ivec2(x, y), 0);
            sumLogW += t.r;
            sumW += t.g;
        }
    }
    float avgLog = sumLogW / max(sumW, 1e-4);
    float targetEv = clamp(LOG2_KEY - avgLog + u_paramsA.z, u_paramsA.x, u_paramsA.y);
    float prevEv = texelFetch(u_previous, ivec2(0, 0), 0).g;
    // WP-C2: a non-finite grid average makes `targetEv` NaN and would permanently poison the 1x1
    // history (exp2(NaN)); guard BOTH EV inputs (NaN/Inf -> safe fallback) before the blend and
    // derive every later value from the sanitized chain -- parity with the WGSL adapt shader.
    float safeTargetEv = (!isnan(targetEv) && !isinf(targetEv)) ? targetEv : 0.0;
    float safePrevEv = (!isnan(prevEv) && !isinf(prevEv)) ? prevEv : safeTargetEv;
    float rate = safeTargetEv > safePrevEv ? u_paramsB.x : u_paramsB.y;
    float blended = safePrevEv + (safeTargetEv - safePrevEv) * (1.0 - exp(-max(u_paramsA.w, 0.0) * rate));
    float ev = (u_paramsB.z < 0.5 && !isnan(blended) && !isinf(blended)) ? blended : safeTargetEv;
    fragColor = vec4(exp2(ev), ev, 0.0, 1.0);
}
