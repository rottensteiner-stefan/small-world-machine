// Classic falling "digital rain": procedural columns of glyph-like blocks with a bright
// white head and a fading green tail, no font texture required.
fn rand(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453123);
}

fn rand1(p: f32) -> f32 {
    return fract(sin(p * 91.345) * 47453.5453123);
}

@compute @workgroup_size(16, 16)
fn main_image(@builtin(global_invocation_id) id: vec3<u32>) {
    let res = custom.resolution;
    let fragCoord = vec2f(f32(id.x), f32(id.y));

    let cellSize = 14.0;
    let colId = floor(fragCoord.x / cellSize);

    let speed = 2.0 + rand1(colId) * 4.0;
    let colOffset = rand1(colId + 91.7) * 40.0;

    let scrollY = (fragCoord.y / cellSize) + custom.time * speed + colOffset;
    let rowId = floor(scrollY);

    let trailLen = 8.0 + rand1(colId + 3.3) * 14.0;
    let headRow = floor(custom.time * speed + colOffset + res.y / cellSize);
    let distFromHead = headRow - rowId;

    var brightness = 0.0;
    if (distFromHead >= 0.0 && distFromHead < trailLen) {
        brightness = pow(1.0 - (distFromHead / trailLen), 1.5);
    }

    let glyphSeed = rand(vec2f(colId, rowId));
    let flicker = 0.6 + 0.4 * fract(glyphSeed * 13.0 + custom.time * 3.0);

    // Fake blocky "glyph" mask inside each cell — not a real font, just a density lattice
    let cellUV = fract(vec2f(fragCoord.x / cellSize, scrollY));
    let glyphMask = step(0.15, glyphSeed) * step(abs(cellUV.x - 0.5), 0.35) * step(abs(cellUV.y - 0.5), 0.4);

    let isHead = step(0.0, distFromHead) * step(distFromHead, 1.0);
    let green = vec3f(0.1, 1.0, 0.35);
    let white = vec3f(0.85, 1.0, 0.9);
    let glyphColor = mix(green, white, isHead);

    var col = vec3f(0.0, 0.05, 0.02);
    col += glyphColor * brightness * flicker * glyphMask;

    // compute.toys convention: the screen is linear colour.
    col = pow(max(col, vec3f(0.0)), vec3f(2.2));
    textureStore(screen, id.xy, vec4f(col, 1.0));
}
