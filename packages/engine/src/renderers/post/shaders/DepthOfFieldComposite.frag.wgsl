struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

struct DofUniforms {
    near: f32,
    far: f32,
    focusDistance: f32,
    cocScale: f32,
    maxCoc: f32,
    pad0: f32,
    pad1: f32,
    pad2: f32,
}

@group(0) @binding(0) var sceneColor: texture_2d<f32>;
@group(0) @binding(1) var depthMap: texture_depth_2d;
@group(0) @binding(2) var cocMap: texture_2d<f32>;
@group(0) @binding(3) var gatherMap: texture_2d<f32>;
@group(0) @binding(4) var<uniform> u: DofUniforms;

const HALF_RES_DIAMETER_SCALE: f32 = 4.0;
// CoC diameters (full-res px) between which the pixel fades from sharp to the half-res bokeh.
const SHARP_COC_PX: f32 = 1.0;
const FULL_BLUR_COC_PX: f32 = 4.0;

fn linearizeDepth(d: f32) -> f32 {
    return (u.near * u.far) / max(u.far - d * (u.far - u.near), 0.00001);
}

fn signedCocDiameter(d: f32) -> f32 {
    let z = linearizeDepth(d);
    return clamp(u.cocScale * (1.0 - u.focusDistance / z), -u.maxCoc, u.maxCoc);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    let coord = vec2i(in.position.xy);
    let sharp = textureLoad(sceneColor, coord, 0);
    let coc = signedCocDiameter(textureLoad(depthMap, coord, 0));

    // CoC-aware bilinear upsample: half-res texels whose CoC differs from this pixel's are
    // down-weighted, so a blurred background never smears the colour of an in-focus edge.
    let halfDims = vec2i(textureDimensions(gatherMap));
    let p = in.uv * vec2f(halfDims) - 0.5;
    let base = vec2i(floor(p));
    let f = p - floor(p);
    var sum = vec4f(0.0);
    var weightSum = 0.0;
    for (var i = 0u; i < 4u; i++) {
        let o = vec2i(i32(i & 1u), i32(i >> 1u));
        let c = clamp(base + o, vec2i(0), halfDims - vec2i(1));
        let bilinear = mix(vec2f(1.0) - f, f, vec2f(o));
        let tapCoc = textureLoad(cocMap, c, 0).a * HALF_RES_DIAMETER_SCALE;
        let w = bilinear.x * bilinear.y / (1.0 + abs(tapCoc - coc)) + 0.00001;
        sum += textureLoad(gatherMap, c, 0) * w;
        weightSum += w;
    }
    let blurred = sum / weightSum;

    let blend = max(smoothstep(SHARP_COC_PX, FULL_BLUR_COC_PX, abs(coc)), blurred.a);
    return vec4f(mix(sharp.rgb, blurred.rgb, blend), sharp.a);
}
