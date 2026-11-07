[BASE_FRAGMENT_HEADER]
[LIGHT_DEFS]

// Opaque-scene depth (ADR 0028 infrastructure): bound by the renderer whenever a material layout
// declares it; on WebGL2 this is the sampled opaque depth, see AbstractWebGLRenderer.
uniform sampler2D u_opaqueDepthMap;

uniform vec4 u_matParam0; // [time, churn, softFadeDistance, softEnabled01]
uniform vec4 u_matParam1; // [lightDir.x, lightDir.y, lightDir.z, lightIntensity]
uniform vec4 u_matParam2; // [ambient, selfShadow, rimStrength, forwardScatter]
uniform vec4 u_matParam3; // [lightScale, lightSlope, lightEnabled01, unused]
uniform vec4 u_matParam4; // [tintStart.rgb, tintStart.a] (birth tint + opacity)
uniform vec4 u_matParam6; // [tintEnd.rgb, tintEnd.a] (death tint + opacity; lane 5 is decal-reserved)

float smokeHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float smokeNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = smokeHash(i);
    float b = smokeHash(i + vec2(1.0, 0.0));
    float c = smokeHash(i + vec2(0.0, 1.0));
    float d = smokeHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Analytic value of the same smoothstep-interpolated cell noise PLUS its exact closed-form
// gradient (d/dp). Within a cell the hash corners are constants, so the chain rule through the
// smoothstep weights yields an exact derivative -- no finite differences, no dFdx. Deterministic
// and byte-parallel across WebGL2/WebGL1/WebGPU.
vec3 smokeNoiseGrad(vec2 p) {
    vec2 i = floor(p);
    vec2 f = p - i;
    vec2 u = f * f * (3.0 - 2.0 * f);
    vec2 du = 6.0 * f * (1.0 - f);
    float a = smokeHash(i);
    float b = smokeHash(i + vec2(1.0, 0.0));
    float c = smokeHash(i + vec2(0.0, 1.0));
    float d = smokeHash(i + vec2(1.0, 1.0));
    float lo = mix(a, b, u.x);
    float hi = mix(c, d, u.x);
    float v = mix(lo, hi, u.y);
    // dlo/dx = (b-a)*du.x ; dv/dx = mix(b-a, d-c, u.y)*du.x ; dv/dy = (hi-lo)*du.y
    float gx = mix(b - a, d - c, u.y) * du.x;
    float gy = (hi - lo) * du.y;
    return vec3(v, gx, gy);
}

// 3-octave FBM of the analytic gradient field: acc.xyz = (density, dD/dx, dD/dy). The chain rule
// multiplies each octave's gradient by its frequency.
vec3 smokeFbmGrad(vec2 p) {
    vec3 acc = vec3(0.0);
    float amp = 0.5;
    float freq = 1.0;
    for (int o = 0; o < 3; o++) {
        vec3 g = smokeNoiseGrad(p * freq);
        acc += vec3(g.x * amp, g.y * amp * freq, g.z * amp * freq);
        freq *= 2.0;
        amp *= 0.5;
    }
    return acc;
}

void main() {
    vec4 inst = vec4(1.0);
#ifdef USE_INSTANCE_COLOR
    inst = v_instanceColor;
#endif
    float d = length(v_uv - vec2(0.5));
    float blob = 1.0 - smoothstep(0.28, 0.5, d);

    // Per-particle seed: inst.r is written once at spawn and never animated (the emitter keeps the
    // colour ramp OFF the rgb channels), so the noise offset is lifetime-stable. The tint is rebuilt
    // from the opacity ramp: k = 1 at birth (alpha = start), 0 at death (alpha = end).
    float ramp = u_matParam4.w - u_matParam6.w;
    float k = abs(ramp) > 1e-4 ? clamp((inst.a - u_matParam6.w) / ramp, 0.0, 1.0) : 1.0;
    vec3 tint = mix(u_matParam6.rgb, u_matParam4.rgb, k);
    float offset = inst.r * 8.0;
    float churnScroll = u_matParam0.x * 0.35 * u_matParam0.y;
    float n = smokeNoise(vec2(
        v_uv.x * 5.0 + offset + churnScroll,
        v_uv.y * 5.0 - churnScroll * 1.3 + offset * 1.7
    ));
    float dissolve = mix(0.1, 0.9, 1.0 - smoothstep(0.0, 0.22, inst.a));
    float rough = 1.0 - (n - 0.5) * dissolve;

    float opacity = blob * rough * inst.a;

    // --- S2: soft particles (WEB_GL2; WEB_GL1 has no depth capture, see Smoke.frag.glsl100) ---
    if (u_matParam0.w > 0.5) {
        vec2 screenUv = gl_FragCoord.xy / vec2(textureSize(u_opaqueDepthMap, 0));
        float rawBg = texture(u_opaqueDepthMap, screenUv).r;
        if (rawBg <= 0.0) rawBg = 1.0;
        float near = u_cameraNearFar.x;
        float far = u_cameraNearFar.y;
        float linBg = (2.0 * near * far) / (far + near - (rawBg * 2.0 - 1.0) * (far - near));
        float linFrag =
            (2.0 * near * far) / (far + near - (gl_FragCoord.z * 2.0 - 1.0) * (far - near));
        // alpha_soft = alpha * clamp((z_scene - z_particle)/d_fade, 0, 1); discard when occluded.
        float soft = clamp((linBg - linFrag) / max(u_matParam0.z, 1e-4), 0.0, 1.0);
        opacity *= soft;
        if (soft <= 0.001) discard;
    }

    vec3 color = tint;

    // --- S3: procedural 6-way volume lighting (0 MB) ---
    // The FBM density gradient supplies the four in-plane axis contributions (±u, ±v); the +z
    // plane normal is the base. Light is analytic directional self-shadowing (density attenuates
    // before diffuse) plus a Henyey-Greenstein forward-scatter rim. Disabled at 0 for golden
    // byte-parity with the pre-S3 material.
    if (u_matParam3.z > 0.5) {
        vec3 den = smokeFbmGrad(v_uv * u_matParam3.x + vec2(offset));
        float rho = clamp(den.x * 1.2, 0.0, 1.0);
        vec3 normal3 = normalize(vec3(-den.y * u_matParam3.y, -den.z * u_matParam3.y, 1.0));
        vec3 lightDir = normalize(u_matParam1.xyz);
        float ndl = max(dot(normal3, lightDir), 0.0);
        float shadow = 1.0 - smoothstep(0.25, 0.9, rho) * u_matParam2.y;
        float mu = dot(normal3, lightDir);
        float g = u_matParam2.w;
        float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5);
        float lightFactor = clamp(
            u_matParam2.x + u_matParam1.w * (ndl * shadow + hg * u_matParam2.z),
            0.0,
            3.0
        );
        color = tint * lightFactor;
    }

    fragColor = vec4(displayToTarget(color), opacity);
}
