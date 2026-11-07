fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }

@compute @workgroup_size(16, 16)
fn main_image(@builtin(global_invocation_id) id: vec3<u32>) {
    let uv = (vec2f(f32(id.x), f32(id.y)) - 0.5 * custom.resolution) / custom.resolution.y;
    
    let a = atan2(uv.y, uv.x) + custom.time * 0.2;
    let r = length(uv);
    
    let polar = vec2f(a * 4.0, 0.5 / r + custom.time * 0.5);
    
    let polar8 = polar * 8.0;
    let cellId = floor(polar8);
    let f = fract(polar8);
    
    let speed = hash(vec2f(cellId.x, 0.0)) * 0.5 + 0.5;
    let y = polar.y * 8.0 * speed + custom.time * 4.0;
    
    let rowId = floor(y);
    let glyph = step(0.3, hash(cellId + vec2f(rowId, rowId)));
    
    var brightness = fract(y);
    brightness = pow(brightness, 1.5);
    
    let head = step(0.9, brightness);
    
    let green = vec3f(0.0, 1.0, 0.2);
    let white = vec3f(1.0, 1.0, 1.0);
    
    var col = mix(green, white, head) * glyph * brightness;
    
    col *= step(0.1, f.x) * step(0.1, f.y);
    col *= smoothstep(0.0, 0.3, r) * (1.0 - smoothstep(0.4, 1.5, r));
    
    // compute.toys convention: the screen is linear colour.
    col = pow(max(col, vec3f(0.0)), vec3f(2.2));
    textureStore(screen, id.xy, vec4f(col, 1.0));
}
