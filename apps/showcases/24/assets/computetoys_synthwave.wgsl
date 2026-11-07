@compute @workgroup_size(16, 16)
fn main_image(@builtin(global_invocation_id) id: vec3<u32>) {
    var uv = (vec2f(f32(id.x), f32(id.y)) * 2.0 - custom.resolution) / custom.resolution.y;
    
    var col = vec3f(0.0);
    
    // Ground plane
    if (uv.y < -0.1) {
        // Perspective projection
        let z = 1.0 / abs(uv.y + 0.1);
        let x = uv.x * z;
        
        // Moving grid
        let gridX = fract(x * 5.0);
        let gridZ = fract(z * 5.0 - custom.time * 2.0);
        
        let lineX = smoothstep(0.9, 1.0, gridX) + smoothstep(0.1, 0.0, gridX);
        let lineZ = smoothstep(0.9, 1.0, gridZ) + smoothstep(0.1, 0.0, gridZ);
        
        let grid = max(lineX, lineZ);
        
        // Distance fade
        let fade = exp(-z * 0.2);
        
        col = vec3f(1.0, 0.0, 1.0) * grid * fade; // Neon pink grid
    } else {
        // Sky / Sun
        let sunDist = length(uv - vec2f(0.0, 0.3));
        if (sunDist < 0.4) {
            // Sun stripes
            let stripe = fract(uv.y * 20.0 - custom.time);
            if (stripe > 0.3 || uv.y > 0.3) {
                // Gradient sun
                col = mix(vec3f(1.0, 0.0, 0.5), vec3f(1.0, 0.8, 0.0), (uv.y + 0.1) / 0.4);
            }
        } else {
            // Sky glow
            let glow = 0.1 / (sunDist + 0.1);
            col = vec3f(0.2, 0.0, 0.4) * glow;
        }
    }
    
    // compute.toys convention: the screen is linear colour.
    col = pow(max(col, vec3f(0.0)), vec3f(2.2));
    textureStore(screen, id.xy, vec4f(col, 1.0));
}
