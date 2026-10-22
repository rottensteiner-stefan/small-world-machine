#version 300 es
precision highp float;
precision highp int;

in vec2 v_uv;
uniform sampler2D u_diffuseMap;
uniform vec4 u_extraParams;

out vec4 fragColor;

void main() {
    // Alpha test for cutout objects (mirrors DepthMaterial).
    float alpha = texture(u_diffuseMap, v_uv).a;
    if (alpha < u_extraParams.y) {
        discard;
    }

    // EVSM moment encoding (ADR 0007) -- byte-compatible with EvsmMoment.frag.wgsl:
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
