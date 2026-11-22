#version 300 es
precision highp float;
precision highp int;

in vec2 v_uv;
in vec2 v_uv0;
#ifdef USE_UV1
in vec2 v_uv1;
#endif
uniform sampler2D u_diffuseMap;
uniform vec4 u_extraParams;
#ifdef USE_UV_TRANSFORMS
uniform vec4 u_uvTransforms[38];
#endif

out vec4 fragColor;

void main() {
    // Alpha test for cutout objects (mirrors DepthMaterial).
#ifdef USE_UV_TRANSFORMS
    vec4 p0 = u_uvTransforms[0];
    vec4 p1 = u_uvTransforms[1];
#ifdef USE_UV1
    vec2 baseUv = p1.z > 0.5 ? v_uv1 : v_uv0;
#else
    vec2 baseUv = v_uv0;
#endif
    vec2 uvScaled = baseUv * p0.zw;
    vec2 diffuseUv = vec2(p1.x * uvScaled.x - p1.y * uvScaled.y, p1.y * uvScaled.x + p1.x * uvScaled.y) + p0.xy;
#else
    vec2 diffuseUv = v_uv;
#endif
    float alpha = texture(u_diffuseMap, diffuseUv).a;
    if (alpha < u_extraParams.y) {
        discard;
    }

    // EVSM moment encoding (ADR 0043) -- byte-compatible with EvsmMoment.frag.wgsl:
    // (e^{c·d}, e^{2c·d}, -e^{-c·d}, e^{-2c·d}) with d in [-1,1] and c = 40 (the Filament
    // vsm-exponent). Every stored value stays inside the fp32 representable range (see WGSL
    // header for the exact magnitude reasoning).
    float depth = clamp(gl_FragCoord.z, 0.0, 1.0);
    float d = clamp(depth * 2.0 - 1.0, -1.0, 1.0);
    float c = 40.0;
    float e = exp(c * d);
    float e2 = e * e;
    float n = -1.0 / e;
    float n2 = n * n;
    fragColor = vec4(e, e2, n, n2);
}
