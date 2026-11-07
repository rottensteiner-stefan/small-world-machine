// Polar Matrix Tunnel
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    
    float a = atan(uv.y, uv.x) + iTime * 0.2;
    float r = length(uv);
    
    vec2 polar = vec2(a * 4.0, 0.5 / r + iTime * 0.5);
    
    vec2 id = floor(polar * 8.0);
    vec2 f = fract(polar * 8.0);
    
    float speed = hash(vec2(id.x, 0.0)) * 0.5 + 0.5;
    float y = polar.y * 8.0 * speed + iTime * 4.0;
    
    float rowId = floor(y);
    float glyph = step(0.3, hash(id + rowId));
    
    float brightness = fract(y);
    brightness = pow(brightness, 1.5);
    
    float head = step(0.9, brightness);
    
    vec3 green = vec3(0.0, 1.0, 0.2);
    vec3 white = vec3(1.0, 1.0, 1.0);
    
    vec3 col = mix(green, white, head) * glyph * brightness;
    
    col *= step(0.1, f.x) * step(0.1, f.y);
    col *= smoothstep(0.0, 0.3, r) * (1.0 - smoothstep(0.4, 1.5, r));
    
    fragColor = vec4(col, 1.0);
}
