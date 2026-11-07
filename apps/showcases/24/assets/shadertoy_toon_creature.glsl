// A stylized, cel-shaded sci-fi droid / mecha.
// Hard black outlines, comic halftone shadows, and a glowing cyan visor.
mat2 rot(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float map(vec3 p) {
    p.y += sin(iTime * 2.5) * 0.15;
    
    vec3 hq = p - vec3(0.0, 1.1, 0.0);
    hq.xz *= rot(sin(iTime)*0.3);
    float headDome = length(hq - vec3(0.0, clamp(hq.y, 0.0, 0.1), 0.0)) - 0.45;
    
    vec3 vq = hq - vec3(0.0, 0.1, 0.4);
    float visor = length(vq - vec3(clamp(vq.x, -0.2, 0.2), 0.0, 0.0)) - 0.12;
    float head = max(headDome, -visor);
    
    vec3 aq = hq - vec3(0.2, 0.5, -0.1);
    float antenna = length(aq - vec3(0.0, clamp(aq.y, 0.0, 0.4), 0.0)) - 0.02;
    head = min(head, antenna);
    
    vec3 bq = p - vec3(0.0, 0.3, 0.0);
    float body = length(bq - vec3(0.0, clamp(bq.y, 0.0, 0.4), 0.0)) - 0.55;
    
    vec3 sq1 = p - vec3(0.65, 0.6, 0.0);
    vec3 sq2 = p - vec3(-0.65, 0.6, 0.0);
    float shoulders = min(length(sq1) - 0.25, length(sq2) - 0.25);
    
    vec3 hq1 = p - vec3(0.8, 0.2 + sin(iTime*3.0)*0.1, 0.3);
    vec3 hq2 = p - vec3(-0.8, 0.2 + cos(iTime*3.0)*0.1, 0.3);
    float hands = min(length(max(abs(hq1) - vec3(0.1, 0.2, 0.15), 0.0)) - 0.05,
                      length(max(abs(hq2) - vec3(0.1, 0.2, 0.15), 0.0)) - 0.05);
    
    float d = smin(head, body, 0.1);
    d = min(d, shoulders);
    d = min(d, hands);
    
    return d;
}

vec3 getNormal(vec3 p) {
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
    ));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;

    float camAngle = iTime * 0.4;
    vec3 ro = vec3(sin(camAngle) * 4.0, 1.2, cos(camAngle) * 4.0);
    vec3 target = vec3(0.0, 0.6, 0.0);
    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 up = cross(fwd, right);
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    float t = 0.0;
    int hit = 0;
    for (int i = 0; i < 100; i++) {
        vec3 p = ro + rd * t;
        float d = map(p);
        if (d < 0.001) { hit = 1; break; }
        t += d;
        if (t > 20.0) break;
    }

    vec3 skyTop = vec3(0.2, 0.2, 0.3);
    vec3 skyBottom = vec3(0.8, 0.4, 0.2); // Synthwave sunset sky
    vec3 col = mix(skyBottom, skyTop, clamp(uv.y * 0.5 + 0.5, 0.0, 1.0));

    if (hit == 1) {
        vec3 p = ro + rd * t;
        vec3 n = getNormal(p);
        vec3 lightDir = normalize(vec3(0.8, 1.0, 0.5));
        float diff = max(dot(n, lightDir), 0.0);

        float bands = 3.0;
        float toon = floor(diff * bands) / bands;
        toon = toon * 0.8 + 0.2;

        vec3 base = mix(vec3(0.9, 0.9, 0.9), vec3(1.0, 0.6, 0.1), step(0.9, p.y));
        
        vec3 hq = p;
        hq.y -= sin(iTime * 2.5) * 0.15;
        hq.y -= 1.1;
        hq.xz *= rot(sin(iTime)*0.3);
        vec3 vq = hq - vec3(0.0, 0.1, 0.4);
        float isVisor = step(length(vq - vec3(clamp(vq.x, -0.2, 0.2), 0.0, 0.0)), 0.15);
        
        vec3 shaded = base * toon;
        if (isVisor > 0.5) {
            shaded = vec3(0.0, 1.0, 1.0) * 1.5;
        }

        float rim = 1.0 - max(dot(n, -rd), 0.0);
        float outline = smoothstep(0.55, 0.75, rim);
        shaded = mix(shaded, vec3(0.05), outline);

        col = shaded;
    }

    vec2 m = fragCoord / iResolution.xy;
    float border = 1.0 - smoothstep(0.0, 0.02, min(min(m.x, 1.0 - m.x), min(m.y, 1.0 - m.y)));
    col = mix(col, vec3(0.05), border);

    fragColor = vec4(col, 1.0);
}
