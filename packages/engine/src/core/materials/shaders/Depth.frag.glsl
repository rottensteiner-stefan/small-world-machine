#version 300 es
precision highp float;
precision highp int;

in vec2 v_uv;
uniform sampler2D u_diffuseMap;
uniform vec4 u_extraParams;

out vec4 fragColor;

void main() {
    // Alpha test for cutout objects
    float alpha = texture(u_diffuseMap, v_uv).a;
    if (alpha < u_extraParams.y) {
        discard;
    }
    
    // Depth is automatically written to gl_FragDepth by the hardware.
    // We just output a dummy color.
    fragColor = vec4(1.0); 
}
