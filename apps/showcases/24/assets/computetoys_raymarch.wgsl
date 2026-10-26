fn rot(a: f32) -> mat2x2f {
    let s = sin(a);
    let c = cos(a);
    return mat2x2f(c, -s, s, c);
}

fn map(p: vec3f, time: f32) -> f32 {
    var q = p;
    
    // Rotating the world
    let r1 = rot(time * 0.5);
    q = vec3f(r1[0][0]*q.x + r1[1][0]*q.z, q.y, r1[0][1]*q.x + r1[1][1]*q.z);
    
    let r2 = rot(time * 0.3);
    q = vec3f(q.x, r2[0][0]*q.y + r2[1][0]*q.z, r2[0][1]*q.y + r2[1][1]*q.z);
    
    // Box SDF
    let b = vec3f(0.6, 0.6, 0.6);
    let d = abs(q) - b;
    let box = length(max(d, vec3f(0.0))) + min(max(d.x, max(d.y, d.z)), 0.0) - 0.1;
    
    // Sphere SDF
    let sphere = length(p) - 0.8;
    
    // Morph between box and sphere
    let morph = sin(time) * 0.5 + 0.5;
    return mix(box, sphere, morph);
}

fn getNormal(p: vec3f, time: f32) -> vec3f {
    let e = vec2f(0.001, 0.0);
    let d = map(p, time);
    let n = d - vec3f(
        map(p - e.xyy, time),
        map(p - e.yxy, time),
        map(p - e.yyx, time)
    );
    return normalize(n);
}

@compute @workgroup_size(16, 16)
fn main_image(@builtin(global_invocation_id) id: vec3<u32>) {
    var uv = (vec2f(f32(id.x), f32(id.y)) * 2.0 - custom.resolution) / custom.resolution.y;
    
    var ro = vec3f(0.0, 0.0, -3.0);
    var rd = normalize(vec3f(uv, 1.0));
    
    var t = 0.0;
    var d = 0.0;
    
    // Raymarching
    for(var i = 0u; i < 80u; i++) {
        let p = ro + rd * t;
        d = map(p, custom.time);
        if(d < 0.001 || t > 10.0) { break; }
        t += d;
    }
    
    var col = vec3f(0.05, 0.05, 0.1); // Dark background
    
    if(d < 0.001) {
        let p = ro + rd * t;
        let n = getNormal(p, custom.time);
        let light = normalize(vec3f(1.0, 1.0, -1.0));
        let diff = max(dot(n, light), 0.1);
        col = vec3f(0.2, 0.5, 0.8) * diff; // Blueish object
        
        // Specular
        let refl = reflect(-light, n);
        let spec = pow(max(dot(refl, -rd), 0.0), 32.0);
        col += vec3f(1.0) * spec;
    }
    
    // Add some fog
    col = mix(col, vec3f(0.05, 0.05, 0.1), 1.0 - exp(-0.1 * t));
    
    // compute.toys convention: the screen is linear colour.
    col = pow(max(col, vec3f(0.0)), vec3f(2.2));
    textureStore(screen, id.xy, vec4f(col, 1.0));
}
