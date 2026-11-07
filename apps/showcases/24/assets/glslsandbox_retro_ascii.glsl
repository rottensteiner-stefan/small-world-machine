#ifdef GL_ES
precision mediump float;
#endif

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453123);
}

// A drifting plasma-ish brightness field that the ASCII renderer "prints".
float sourceBrightness(vec2 uv) {
    vec2 p = uv * 3.0;
    float v = 0.0;
    v += sin(p.x * 1.3 + time * 0.6);
    v += sin(p.y * 1.7 - time * 0.4);
    v += sin((p.x + p.y) * 0.8 + time * 0.9);
    v += sin(length(p - vec2(sin(time * 0.3), cos(time * 0.25)) * 2.0) * 2.0 - time);
    return v * 0.25 + 0.5;
}

// Procedural "character" density mask mimicking a . : + # ascii ramp (no font texture needed).
float charMask(vec2 cellUV, float brightness) {
    vec2 c = cellUV - 0.5;
    float d = length(c);

    if (brightness < 0.15) return 0.0;
    if (brightness < 0.35) return step(d, 0.08);
    if (brightness < 0.55) return step(d, 0.16);
    if (brightness < 0.7) {
        float plus = step(abs(c.x), 0.06) + step(abs(c.y), 0.06);
        return clamp(plus, 0.0, 1.0);
    }
    if (brightness < 0.85) {
        float hashLines = step(abs(c.x), 0.06) + step(abs(c.y), 0.06)
                         + step(abs(c.x - c.y), 0.06) + step(abs(c.x + c.y), 0.06);
        return clamp(hashLines, 0.0, 1.0);
    }
    return step(max(abs(c.x), abs(c.y)), 0.42);
}

void main(void) {
    vec2 uv = gl_FragCoord.xy / resolution.xy;

    float cellSize = 10.0;
    vec2 cellCoord = gl_FragCoord.xy / cellSize;
    vec2 cellId = floor(cellCoord);
    vec2 cellUV = fract(cellCoord);

    vec2 sampleUV = (cellId * cellSize) / resolution.xy;
    float brightness = sourceBrightness(sampleUV);
    float mask = charMask(cellUV, brightness);

    // Phosphor green terminal palette
    vec3 phosphor = vec3(0.25, 1.0, 0.35);
    vec3 col = phosphor * mask * (0.7 + 0.3 * hash(cellId + floor(time * 6.0)));

    // Scanlines
    float scan = 0.85 + 0.15 * sin(gl_FragCoord.y * 3.14159);
    col *= scan;

    // Vignette for that CRT feel
    vec2 vc = uv * 2.0 - 1.0;
    float vig = 1.0 - dot(vc * 0.5, vc * 0.5);
    col *= clamp(vig, 0.3, 1.0);

    col += phosphor * 0.02;

    gl_FragColor = vec4(col, 1.0);
}
