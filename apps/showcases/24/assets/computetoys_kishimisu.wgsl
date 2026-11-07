fn palette(t: f32) -> vec3f {
    let a = vec3f(0.5, 0.5, 0.5);
    let b = vec3f(0.5, 0.5, 0.5);
    let c = vec3f(1.0, 1.0, 1.0);
    let d = vec3f(0.263, 0.416, 0.557);
    return a + b * cos(6.28318 * (c * t + d));
}

@compute @workgroup_size(16, 16)
fn main_image(@builtin(global_invocation_id) id: vec3<u32>) {
    var uv = (vec2f(f32(id.x), f32(id.y)) * 2.0 - custom.resolution) / custom.resolution.y;
    let uv0 = uv;
    var finalColor = vec3f(0.0);
    
    for(var i: f32 = 0.0; i < 4.0; i += 1.0) {
        uv = fract(uv * 1.5) - 0.5;
        var d = length(uv) * exp(-length(uv0));
        let col = palette(length(uv0) + i * 0.4 + custom.time * 0.4);
        
        d = sin(d * 8.0 + custom.time) / 8.0;
        d = abs(d);
        d = pow(0.01 / d, 1.2);
        
        finalColor += col * d;
    }
    
    // compute.toys convention: the screen is linear colour.
    finalColor = pow(max(finalColor, vec3f(0.0)), vec3f(2.2));
    textureStore(screen, id.xy, vec4f(finalColor, 1.0));
}
