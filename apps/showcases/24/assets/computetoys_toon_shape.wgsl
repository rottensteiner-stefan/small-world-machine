fn rot(a: f32) -> mat2x2f { return mat2x2f(cos(a), -sin(a), sin(a), cos(a)); }

fn smin(a: f32, b: f32, k: f32) -> f32 {
    let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

fn map(pIn: vec3f) -> f32 {
    var p = pIn;
    p.y += sin(custom.time * 2.5) * 0.15;
    
    var hq = p - vec3f(0.0, 1.1, 0.0);
    let a = sin(custom.time)*0.3;
    let r = rot(a);
    let xz = r * vec2f(hq.x, hq.z);
    hq.x = xz.x;
    hq.z = xz.y;
    
    let headDome = length(hq - vec3f(0.0, clamp(hq.y, 0.0, 0.1), 0.0)) - 0.45;
    
    let vq = hq - vec3f(0.0, 0.1, 0.4);
    let visor = length(vq - vec3f(clamp(vq.x, -0.2, 0.2), 0.0, 0.0)) - 0.12;
    var head = max(headDome, -visor);
    
    let aq = hq - vec3f(0.2, 0.5, -0.1);
    let antenna = length(aq - vec3f(0.0, clamp(aq.y, 0.0, 0.4), 0.0)) - 0.02;
    head = min(head, antenna);
    
    let bq = p - vec3f(0.0, 0.3, 0.0);
    let body = length(bq - vec3f(0.0, clamp(bq.y, 0.0, 0.4), 0.0)) - 0.55;
    
    let sq1 = p - vec3f(0.65, 0.6, 0.0);
    let sq2 = p - vec3f(-0.65, 0.6, 0.0);
    let shoulders = min(length(sq1) - 0.25, length(sq2) - 0.25);
    
    let hq1 = p - vec3f(0.8, 0.2 + sin(custom.time*3.0)*0.1, 0.3);
    let hq2 = p - vec3f(-0.8, 0.2 + cos(custom.time*3.0)*0.1, 0.3);
    let hands = min(length(max(abs(hq1) - vec3f(0.1, 0.2, 0.15), vec3f(0.0))) - 0.05,
                    length(max(abs(hq2) - vec3f(0.1, 0.2, 0.15), vec3f(0.0))) - 0.05);
    
    var d = smin(head, body, 0.1);
    d = min(d, shoulders);
    d = min(d, hands);
    
    return d;
}

fn getNormal(p: vec3f) -> vec3f {
    let e = vec2f(0.001, 0.0);
    return normalize(vec3f(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
    ));
}

@compute @workgroup_size(16, 16)
fn main_image(@builtin(global_invocation_id) id: vec3<u32>) {
    let uv = (vec2f(f32(id.x), f32(id.y)) * 2.0 - custom.resolution) / custom.resolution.y;

    let camAngle = custom.time * 0.4;
    let ro = vec3f(sin(camAngle) * 4.0, 1.2, cos(camAngle) * 4.0);
    let lookTarget = vec3f(0.0, 0.6, 0.0);
    let fwd = normalize(lookTarget - ro);
    let right = normalize(cross(vec3f(0.0, 1.0, 0.0), fwd));
    let up = cross(fwd, right);
    let rd = normalize(fwd + uv.x * right + uv.y * up);

    var t = 0.0;
    var hit = false;
    for (var i = 0u; i < 100u; i++) {
        let p = ro + rd * t;
        let d = map(p);
        if (d < 0.001) { hit = true; break; }
        t += d;
        if (t > 20.0) { break; }
    }

    let skyTop = vec3f(0.2, 0.2, 0.3);
    let skyBottom = vec3f(0.8, 0.4, 0.2);
    var col = mix(skyBottom, skyTop, clamp(uv.y * 0.5 + 0.5, 0.0, 1.0));

    if (hit) {
        let p = ro + rd * t;
        let n = getNormal(p);
        let lightDir = normalize(vec3f(0.8, 1.0, 0.5));
        let diff = max(dot(n, lightDir), 0.0);

        let bands = 3.0;
        let toon = floor(diff * bands) / bands * 0.8 + 0.2;

        let base = mix(vec3f(0.9, 0.9, 0.9), vec3f(1.0, 0.6, 0.1), step(0.9, p.y));
        
        var hq = p;
        hq.y -= sin(custom.time * 2.5) * 0.15;
        hq.y -= 1.1;
        
        let a = sin(custom.time)*0.3;
        let r = rot(a);
        let xz = r * vec2f(hq.x, hq.z);
        hq.x = xz.x;
        hq.z = xz.y;
        
        let vq = hq - vec3f(0.0, 0.1, 0.4);
        let isVisor = step(length(vq - vec3f(clamp(vq.x, -0.2, 0.2), 0.0, 0.0)), 0.15);
        
        var shaded = base * toon;
        if (isVisor > 0.5) {
            shaded = vec3f(0.0, 1.5, 1.5);
        }

        let rim = 1.0 - max(dot(n, -rd), 0.0);
        let outline = smoothstep(0.55, 0.75, rim);
        shaded = mix(shaded, vec3f(0.05), outline);

        col = shaded;
    }

    let m = vec2f(f32(id.x), f32(id.y)) / custom.resolution;
    let border = 1.0 - smoothstep(0.0, 0.02, min(min(m.x, 1.0 - m.x), min(m.y, 1.0 - m.y)));
    col = mix(col, vec3f(0.05), border);

    // compute.toys convention: the screen is linear colour.
    col = pow(max(col, vec3f(0.0)), vec3f(2.2));
    textureStore(screen, id.xy, vec4f(col, 1.0));
}
