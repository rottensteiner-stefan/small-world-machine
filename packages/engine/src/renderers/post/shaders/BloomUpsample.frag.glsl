#version 300 es
precision highp float;

in vec2 v_uv;

uniform sampler2D u_texture;
// x = texelWidth, y = texelHeight, z = radius
uniform vec3 u_params;

out vec4 fragColor;

void main() {
    float x = u_params.z * u_params.x;
    float y = u_params.z * u_params.y;
    
    // 9-tap bilinear upsample filter (Kawase)
    vec3 a = texture(u_texture, vec2(v_uv.x - x, v_uv.y + y)).rgb;
    vec3 b = texture(u_texture, vec2(v_uv.x,     v_uv.y + y)).rgb;
    vec3 c = texture(u_texture, vec2(v_uv.x + x, v_uv.y + y)).rgb;
    
    vec3 d = texture(u_texture, vec2(v_uv.x - x, v_uv.y)).rgb;
    vec3 e = texture(u_texture, vec2(v_uv.x,     v_uv.y)).rgb;
    vec3 f = texture(u_texture, vec2(v_uv.x + x, v_uv.y)).rgb;
    
    vec3 g = texture(u_texture, vec2(v_uv.x - x, v_uv.y - y)).rgb;
    vec3 h = texture(u_texture, vec2(v_uv.x,     v_uv.y - y)).rgb;
    vec3 i = texture(u_texture, vec2(v_uv.x + x, v_uv.y - y)).rgb;
    
    vec3 upsample = e * 4.0;
    upsample += (b + d + f + h) * 2.0;
    upsample += (a + c + g + i);
    upsample *= 1.0 / 16.0;
    
    fragColor = vec4(upsample, 1.0);
}
