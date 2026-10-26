// Sci-fi hologram: hex-tiled grid (BigWings-style F1/F2 hex coords), glowing cells that
// randomly flicker awake, plus a vertical hologram scan bar.
fn vmod2(x: vec2f, y: vec2f) -> vec2f {
    return x - y * floor(x / y);
}

fn hexDist(pIn: vec2f) -> f32 {
    let p = abs(pIn);
    let c = dot(p, normalize(vec2f(1.0, 1.7320508)));
    return max(c, p.x);
}

// Returns vec4(angle, distFromEdge, cellIdX, cellIdY)
fn hexCoords(uv: vec2f) -> vec4f {
    let r = vec2f(1.0, 1.7320508);
    let h = r * 0.5;

    let a = vmod2(uv, r) - h;
    let b = vmod2(uv - h, r) - h;

    var gv: vec2f;
    if (dot(a, a) < dot(b, b)) {
        gv = a;
    } else {
        gv = b;
    }

    let ang = atan2(gv.x, gv.y);
    let distFromEdge = 0.5 - hexDist(gv);
    let cellIdxy = uv - gv;
    return vec4f(ang, distFromEdge, cellIdxy.x, cellIdxy.y);
}

fn rand(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(41.3, 289.1))) * 43758.5453123);
}

@compute @workgroup_size(16, 16)
fn main_image(@builtin(global_invocation_id) id: vec3<u32>) {
    var uv = (vec2f(f32(id.x), f32(id.y)) * 2.0 - custom.resolution) / custom.resolution.y;
    uv *= 6.0;

    let hc = hexCoords(uv);
    let edgeDist = hc.y;
    let cellId = vec2f(hc.z, hc.w);

    let flicker = rand(cellId);
    let scanY = f32(id.y) / custom.resolution.y;
    let sweep = smoothstep(0.0, 0.15, 1.0 - abs(fract(scanY - custom.time * 0.25) - 0.5) * 2.0);
    let cellActive = step(0.35, flicker + sweep * 0.6);

    let fillMask = smoothstep(0.05, 0.25, edgeDist) * cellActive;
    let edgeGlow = 1.0 - smoothstep(0.0, 0.08, abs(edgeDist - 0.42));

    let cyan = vec3f(0.15, 0.85, 1.0);
    let magenta = vec3f(0.85, 0.2, 1.0);
    let cellColor = mix(cyan, magenta, flicker);

    var col = vec3f(0.02, 0.03, 0.06);
    col += cellColor * fillMask * 0.5;
    col += cellColor * edgeGlow * 0.8;

    // Bright traveling hologram scan bar (sharpened cosine peak)
    let bar = pow(0.5 + 0.5 * cos(6.2831 * (scanY - custom.time * 0.15)), 40.0);
    col += vec3f(0.6, 0.9, 1.0) * bar * 0.5;

    let lines = 0.9 + 0.1 * sin(f32(id.y) * 3.14159);
    col *= lines;

    // compute.toys convention: the screen is linear colour.
    col = pow(max(col, vec3f(0.0)), vec3f(2.2));
    textureStore(screen, id.xy, vec4f(col, 1.0));
}
