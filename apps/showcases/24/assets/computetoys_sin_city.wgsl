fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }

fn map(pIn: vec3f) -> f32 {
    let d = pIn.y;
    
    var q = pIn;
    let id = floor(vec2f(q.x, q.z) / 4.0);
    let xz = fract(vec2f(q.x, q.z) / 4.0) * 4.0 - 2.0;
    q.x = xz.x;
    q.z = xz.y;
    
    let h = 3.0 + hash(id) * 12.0;
    var bldg = length(max(abs(q) - vec3f(1.5, h, 1.5), vec3f(0.0)));
    
    // Carve out the center road
    bldg = max(bldg, 5.0 - abs(pIn.x));
    
    return min(d, bldg);
}

fn getNormal(p: vec3f) -> vec3f {
    let e = vec2f(0.01, 0.0);
    return normalize(vec3f(
        map(p+e.xyy)-map(p-e.xyy), 
        map(p+e.yxy)-map(p-e.yxy), 
        map(p+e.yyx)-map(p-e.yyx)
    ));
}

@compute @workgroup_size(16, 16)
fn main_image(@builtin(global_invocation_id) id: vec3<u32>) {
    let uv = (vec2f(f32(id.x), f32(id.y)) - 0.5 * custom.resolution) / custom.resolution.y;
    
    let ro = vec3f(0.0, 1.5, custom.time * 15.0);
    var rd = normalize(vec3f(uv.x, uv.y, 1.0));
    
    let rx = 0.15;
    let c = cos(rx);
    let s = sin(rx);
    let yz = mat2x2f(c, -s, s, c) * vec2f(rd.y, rd.z);
    rd.y = yz.x;
    rd.z = yz.y;
    
    var t = 0.0;
    var p = vec3f(0.0);
    for (var i = 0u; i < 80u; i++) {
        p = ro + rd * t;
        let d = map(p);
        if(d < 0.01 || t > 150.0) { break; }
        t += d;
    }
    
    var col = vec3f(0.02, 0.0, 0.05);
    
    if(t < 150.0) {
        let n = getNormal(p);
        col = vec3f(0.05);
        
        if (p.y > 0.01) {
            let cellId = floor(vec2f(p.x, p.z) / 4.0);
            
            let winUV = fract(vec2f(p.x * 2.0 + p.z * 2.0, p.y * 2.0));
            let winHash = hash(floor(vec2f(p.x * 2.0 + p.z * 2.0, p.y * 2.0)) + cellId);
            
            if (winHash > 0.7 && winUV.x > 0.2 && winUV.y > 0.2 && n.y < 0.5) {
                let neon = mix(vec3f(0.0, 1.0, 1.0), vec3f(1.0, 0.0, 1.0), hash(cellId + vec2f(1.0, 1.0)));
                col = neon * 2.0;
            }
            
            let edge = step(0.95, fract(p.x)) + step(0.95, fract(p.y)) + step(0.95, fract(p.z));
            if (edge > 0.0 && n.y < 0.5) {
                col += vec3f(0.2, 0.0, 0.4);
            }
        } else {
            let grid = step(0.98, fract(p.x)) + step(0.98, fract(p.z));
            col = vec3f(0.5, 0.0, 1.0) * grid * 0.5;
            
            if (abs(p.x) < 0.2) {
                let marker = step(0.5, fract(p.z * 0.2));
                col += vec3f(1.0, 0.9, 0.0) * marker;
            }
        }
        
        col = mix(col, vec3f(0.02, 0.0, 0.05), smoothstep(20.0, 100.0, t));
    }
    
    // compute.toys convention: the screen is linear colour.
    col = pow(max(col, vec3f(0.0)), vec3f(2.2));
    textureStore(screen, id.xy, vec4f(col, 1.0));
}
