#version 300 es
precision highp float;

in vec2 v_uv;

uniform sampler2D u_texture;
// Threshold parameters: x = threshold, y = threshold - knee, z = 2.0 * knee, w = 0.25 / knee
uniform vec4 u_thresholdParams;
// To control downsample behavior: x = texelWidth, y = texelHeight, z = isFirstPass
uniform vec3 u_params;

out vec4 fragColor;

// Quadratic color thresholding
vec3 prefilter(vec3 color) {
    float brightness = max(color.r, max(color.g, color.b));
    float soft = brightness - u_thresholdParams.y;
    soft = clamp(soft, 0.0, u_thresholdParams.z);
    soft = soft * soft * u_thresholdParams.w;
    float contribution = max(soft, brightness - u_thresholdParams.x);
    contribution /= max(brightness, 0.00001);
    return color * contribution;
}

void main() {
    vec2 texelSize = u_params.xy;
    
    // Dual filtering downsample (13-tap Kawase filter)
    // A B C
    // D E F
    // G H I
    // J K L
    // M N O
    // (We read 13 specific samples)
    
    vec3 a = texture(u_texture, vec2(v_uv.x - 2.0 * texelSize.x, v_uv.y + 2.0 * texelSize.y)).rgb;
    vec3 b = texture(u_texture, vec2(v_uv.x,                     v_uv.y + 2.0 * texelSize.y)).rgb;
    vec3 c = texture(u_texture, vec2(v_uv.x + 2.0 * texelSize.x, v_uv.y + 2.0 * texelSize.y)).rgb;
    
    vec3 d = texture(u_texture, vec2(v_uv.x - 2.0 * texelSize.x, v_uv.y)).rgb;
    vec3 e = texture(u_texture, vec2(v_uv.x,                     v_uv.y)).rgb;
    vec3 f = texture(u_texture, vec2(v_uv.x + 2.0 * texelSize.x, v_uv.y)).rgb;
    
    vec3 g = texture(u_texture, vec2(v_uv.x - 2.0 * texelSize.x, v_uv.y - 2.0 * texelSize.y)).rgb;
    vec3 h = texture(u_texture, vec2(v_uv.x,                     v_uv.y - 2.0 * texelSize.y)).rgb;
    vec3 i = texture(u_texture, vec2(v_uv.x + 2.0 * texelSize.x, v_uv.y - 2.0 * texelSize.y)).rgb;
    
    vec3 j = texture(u_texture, vec2(v_uv.x - texelSize.x, v_uv.y + texelSize.y)).rgb;
    vec3 k = texture(u_texture, vec2(v_uv.x + texelSize.x, v_uv.y + texelSize.y)).rgb;
    vec3 l = texture(u_texture, vec2(v_uv.x - texelSize.x, v_uv.y - texelSize.y)).rgb;
    vec3 m = texture(u_texture, vec2(v_uv.x + texelSize.x, v_uv.y - texelSize.y)).rgb;

    // Apply prefilter ONLY on the first downsample pass
    if (u_params.z > 0.5) {
        a = prefilter(a); b = prefilter(b); c = prefilter(c);
        d = prefilter(d); e = prefilter(e); f = prefilter(f);
        g = prefilter(g); h = prefilter(h); i = prefilter(i);
        j = prefilter(j); k = prefilter(k); l = prefilter(l); m = prefilter(m);
    }
    
    vec3 downsample = e * 0.125;
    downsample += (a + c + g + i) * 0.03125;
    downsample += (b + d + f + h) * 0.0625;
    downsample += (j + k + l + m) * 0.125;
    
    fragColor = vec4(downsample, 1.0);
}
