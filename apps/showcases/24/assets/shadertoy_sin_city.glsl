// Neon Voxel City (Raymarched)
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

float map(vec3 p) {
    float d = p.y;
    
    vec3 q = p;
    vec2 id = floor(q.xz / 4.0);
    q.xz = fract(q.xz / 4.0) * 4.0 - 2.0;
    
    float h = 3.0 + hash(id) * 12.0;
    float bldg = length(max(abs(q) - vec3(1.5, h, 1.5), 0.0));
    
    // Carve out the center road
    bldg = max(bldg, 5.0 - abs(p.x));
    
    return min(d, bldg);
}

vec3 getNormal(vec3 p) {
    vec2 e = vec2(0.01, 0.0);
    return normalize(vec3(map(p+e.xyy)-map(p-e.xyy), map(p+e.yxy)-map(p-e.yxy), map(p+e.yyx)-map(p-e.yyx)));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    
    vec3 ro = vec3(0.0, 1.5, iTime * 15.0);
    vec3 rd = normalize(vec3(uv.x, uv.y, 1.0));
    
    float rx = 0.15;
    rd.yz = mat2(cos(rx), -sin(rx), sin(rx), cos(rx)) * rd.yz;
    
    float t = 0.0;
    vec3 p = vec3(0.0);
    for(int i = 0; i < 80; i++) {
        p = ro + rd * t;
        float d = map(p);
        if(d < 0.01 || t > 150.0) break;
        t += d;
    }
    
    vec3 col = vec3(0.02, 0.0, 0.05);
    
    if(t < 150.0) {
        vec3 n = getNormal(p);
        col = vec3(0.05);
        
        if (p.y > 0.01) {
            vec2 id = floor(vec2(p.x, p.z) / 4.0);
            
            vec2 winUV = fract(vec2(p.x * 2.0 + p.z * 2.0, p.y * 2.0));
            float winHash = hash(floor(vec2(p.x * 2.0 + p.z * 2.0, p.y * 2.0)) + id);
            
            if (winHash > 0.7 && winUV.x > 0.2 && winUV.y > 0.2 && n.y < 0.5) {
                vec3 neon = mix(vec3(0.0, 1.0, 1.0), vec3(1.0, 0.0, 1.0), hash(id + 1.0));
                col = neon * 2.0;
            }
            
            float edge = step(0.95, fract(p.x)) + step(0.95, fract(p.y)) + step(0.95, fract(p.z));
            if (edge > 0.0 && n.y < 0.5) {
                col += vec3(0.2, 0.0, 0.4);
            }
        } else {
            float grid = step(0.98, fract(p.x)) + step(0.98, fract(p.z));
            col = vec3(0.5, 0.0, 1.0) * grid * 0.5;
            
            if (abs(p.x) < 0.2) {
                float marker = step(0.5, fract(p.z * 0.2));
                col += vec3(1.0, 0.9, 0.0) * marker;
            }
        }
        
        col = mix(col, vec3(0.02, 0.0, 0.05), smoothstep(20.0, 100.0, t));
    }
    
    fragColor = vec4(col, 1.0);
}
