#version 300 es
precision highp float;

in vec2 v_uv;

uniform sampler2D u_texture;
// Threshold parameters: x = threshold, y = threshold - knee, z = 2.0 * knee, w = 0.25 / knee
uniform vec4 u_thresholdParams;
// To control downsample behavior: x = texelWidth, y = texelHeight, z = isFirstPass
uniform vec3 u_params;

out vec4 fragColor;

vec3 sanitizeTap(vec3 c) {
    float r = (c.r == c.r && c.r >= 0.0 && c.r <= 65504.0) ? clamp(c.r, 0.0, 65504.0) : 0.0;
    float g = (c.g == c.g && c.g >= 0.0 && c.g <= 65504.0) ? clamp(c.g, 0.0, 65504.0) : 0.0;
    float b = (c.b == c.b && c.b >= 0.0 && c.b <= 65504.0) ? clamp(c.b, 0.0, 65504.0) : 0.0;
    return max(vec3(r, g, b), vec3(0.0));
}

// Quadratic color thresholding
vec3 prefilter(vec3 rawColor) {
    vec3 color = sanitizeTap(rawColor);
    float brightness = max(color.r, max(color.g, color.b));
    float soft = brightness - u_thresholdParams.y;
    soft = clamp(soft, 0.0, u_thresholdParams.z);
    soft = soft * soft * u_thresholdParams.w;
    float contribution = max(soft, brightness - u_thresholdParams.x);
    contribution /= max(brightness, 0.00001);
    return color * contribution;
}

float karisWeight(vec3 boxAvg) {
    float luma = dot(boxAvg, vec3(0.2126, 0.7152, 0.0722));
    return 1.0 / (1.0 + max(luma, 0.0));
}

void main() {
    vec2 texelSize = u_params.xy;
    
    // Dual filtering downsample (13-tap Kawase filter)
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

    // Apply prefilter and Jimenez (2014) Karis-Average ONLY on the first downsample pass
    if (u_params.z > 0.5) {
        a = prefilter(a); b = prefilter(b); c = prefilter(c);
        d = prefilter(d); e = prefilter(e); f = prefilter(f);
        g = prefilter(g); h = prefilter(h); i = prefilter(i);
        j = prefilter(j); k = prefilter(k); l = prefilter(l); m = prefilter(m);

        vec3 b0 = (j + k + l + m) * 0.25;
        vec3 b1 = (a + b + d + e) * 0.25;
        vec3 b2 = (b + c + e + f) * 0.25;
        vec3 b3 = (d + e + g + h) * 0.25;
        vec3 b4 = (e + f + h + i) * 0.25;

        float w0 = karisWeight(b0) * 0.5;
        float w1 = karisWeight(b1) * 0.125;
        float w2 = karisWeight(b2) * 0.125;
        float w3 = karisWeight(b3) * 0.125;
        float w4 = karisWeight(b4) * 0.125;
        float wSum = max(w0 + w1 + w2 + w3 + w4, 0.00001);
        vec3 karisDownsample = (b0 * w0 + b1 * w1 + b2 * w2 + b3 * w3 + b4 * w4) / wSum;
        fragColor = vec4(karisDownsample, 1.0);
        return;
    }
    
    vec3 downsample = e * 0.125;
    downsample += (a + c + g + i) * 0.03125;
    downsample += (b + d + f + h) * 0.0625;
    downsample += (j + k + l + m) * 0.125;
    
    fragColor = vec4(downsample, 1.0);
}
