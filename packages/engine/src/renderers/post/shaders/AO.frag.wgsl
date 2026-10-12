@group(0) @binding(0) var depthMap: texture_depth_2d;

struct AOUniforms {
    near: f32,
    far: f32,
    projScaleX: f32,
    projScaleY: f32,
    radius: f32,
    intensity: f32,
    pad0: f32,
    pad1: f32,
}
@group(0) @binding(1) var<uniform> u: AOUniforms;
// See AO.frag.glsl for the full algorithm rationale -- same simplified HBAO approach, adapted
// to WGSL's texel-fetch-only depth read (no sampler needed for a plain `texture_depth_2d`).
fn linearizeDepth(d: f32) -> f32 {
    let z = d * 2.0 - 1.0;
    return (2.0 * u.near * u.far) / (u.far + u.near - z * (u.far - u.near));
}

fn reconstructViewPos(uv: vec2f, linearZ: f32) -> vec3f {
    let ndc = uv * 2.0 - 1.0;
    return vec3f(ndc.x * linearZ / u.projScaleX, ndc.y * linearZ / u.projScaleY, -linearZ);
}

@group(0) @binding(2) var outAO: texture_storage_2d<rgba8unorm, write>;

// View-space position and linear depth of one neighbouring pixel; sky counts as infinitely far.
fn neighbourViewPos(coord: vec2i, dims: vec2i) -> vec4f {
    let c = clamp(coord, vec2i(0, 0), dims - vec2i(1, 1));
    let d = textureLoad(depthMap, c, 0);
    if (d >= 1.0) {
        return vec4f(0.0, 0.0, 0.0, 1.0e9);
    }
    let z = linearizeDepth(d);
    return vec4f(reconstructViewPos((vec2f(c) + vec2f(0.5)) / vec2f(dims), z), z);
}

fn computeHBAO(pixelCoord: vec2i, dims: vec2i) -> f32 {
    let maxCoord = dims - vec2i(1, 1);
    let centerCoord = clamp(pixelCoord, vec2i(0, 0), maxCoord);
    let uv = (vec2f(centerCoord) + vec2f(0.5)) / vec2f(dims);

    let depth = textureLoad(depthMap, centerCoord, 0);
    if (depth >= 1.0) {
        return 1.0;
    }

    let linearZ = linearizeDepth(depth);
    let viewPos = reconstructViewPos(uv, linearZ);

    // Flat geometric normal from depth (Turanszki, "Improved normal reconstruction from depth"):
    // per axis the neighbour whose depth is closest to the centre forms the triangle, so the edge
    // never reaches across a silhouette. Deliberately not the normal buffer: that normal carries
    // the receiver's normal map, but the horizon test marches against flat depth, so a bumped
    // normal lets rays dip below the surface and over-darkens (the article's warning about SSAO).
    let right = neighbourViewPos(centerCoord + vec2i(1, 0), dims);
    let left = neighbourViewPos(centerCoord - vec2i(1, 0), dims);
    let down = neighbourViewPos(centerCoord + vec2i(0, 1), dims);
    let up = neighbourViewPos(centerCoord - vec2i(0, 1), dims);
    let useRight = abs(right.w - linearZ) <= abs(left.w - linearZ);
    let useDown = abs(down.w - linearZ) <= abs(up.w - linearZ);
    var dPosDx = select(viewPos - left.xyz, right.xyz - viewPos, useRight);
    var dPosDy = select(viewPos - up.xyz, down.xyz - viewPos, useDown);
    if (select(left.w, right.w, useRight) >= 1.0e8) {
        dPosDx = vec3f(0.0);
    }
    if (select(up.w, down.w, useDown) >= 1.0e8) {
        dPosDy = vec3f(0.0);
    }
    let crossN = cross(dPosDx, dPosDy);
    let lenSq = dot(crossN, crossN);
    // Judged relative to the edge lengths (sin^2 of the angle between them): an absolute
    // threshold rejected every cross product on high-resolution canvases, where neighbouring
    // pixels are tiny steps apart, and left the camera-axis fallback as the normal everywhere.
    let edgeScaleSq = dot(dPosDx, dPosDx) * dot(dPosDy, dPosDy);
    let validNormal = edgeScaleSq > 0.0 && lenSq > 0.0001 * edgeScaleSq;
    var normal = select(vec3f(0.0, 0.0, 1.0), normalize(crossN), validNormal);
    // Face the camera (+z in view space): the horizon test measures occluders above the surface.
    if (normal.z < 0.0) {
        normal = -normal;
    }

    let dirs = array<vec2f, 6>(
        vec2f(1.0, 0.0), vec2f(0.5, 0.866025), vec2f(-0.5, 0.866025),
        vec2f(-1.0, 0.0), vec2f(-0.5, -0.866025), vec2f(0.5, -0.866025),
    );

    // March distance follows the world-space radius: radius * projScaleY * (height / 2) / linearZ
    // is the radius projected to pixels. Min 4 px keeps contact AO alive at distance (steps would
    // collapse onto the centre texel); max 128 px bounds the cache-miss cost of close-ups.
    let pixelRadius = clamp(u.radius * u.projScaleY * f32(dims.y) * 0.5 / linearZ, 4.0, 128.0);
    let stepPixels = pixelRadius / 4.0;

    var occlusion = 0.0;
    for (var d = 0; d < 6; d++) {
        var maxHorizonSin = 0.0;
        for (var s = 1; s <= 4; s++) {
            let sampleCoord = centerCoord + vec2i(dirs[d] * f32(s) * stepPixels);
            if (sampleCoord.x < 0 || sampleCoord.x > maxCoord.x || sampleCoord.y < 0 || sampleCoord.y > maxCoord.y) {
                continue;
            }

            let sDepth = textureLoad(depthMap, sampleCoord, 0);
            if (sDepth >= 1.0) {
                continue;
            }

            let sUv = (vec2f(sampleCoord) + vec2f(0.5)) / vec2f(dims);
            let sLinearZ = linearizeDepth(sDepth);
            let sViewPos = reconstructViewPos(sUv, sLinearZ);

            let toSample = sViewPos - viewPos;
            let dist = length(toSample);
            if (dist > u.radius || dist < 0.0001) {
                continue;
            }

            let horizonSin = dot(toSample / dist, normal);
            // `x != x` is the portable NaN check in WGSL (no isNan()/isInf() builtins --
            // removed from the spec, see AO.frag.glsl's isnan()/isinf() for why this guard
            // exists at all). max()/clamp() have unspecified results for a NaN operand, so a
            // NaN horizonSin (e.g. from an upstream-NaN depth sample slipping past the `dist`
            // bounds check above, since NaN comparisons are always false) must be filtered out
            // BEFORE it reaches max() -- Inf doesn't need the same treatment, IEEE754 ordering
            // for Inf is well-defined so the clamp() below already handles it correctly.
            if (horizonSin == horizonSin) {
                maxHorizonSin = max(maxHorizonSin, horizonSin);
            }
        }
        occlusion += clamp(maxHorizonSin, 0.0, 1.0);
    }
    occlusion /= 6.0;

    var ao = clamp(1.0 - occlusion * u.intensity, 0.0, 1.0);
    if (ao != ao) {
        ao = 1.0;
    }
    return ao;
}

@compute @workgroup_size(8, 8, 1)
fn cs_main(@builtin(global_invocation_id) global_id: vec3u) {
    let dims = vec2i(textureDimensions(depthMap));
    let pixelCoord = vec2i(global_id.xy);
    if (pixelCoord.x >= dims.x || pixelCoord.y >= dims.y) {
        return;
    }

    let ao = computeHBAO(pixelCoord, dims);
    textureStore(outAO, pixelCoord, vec4f(ao, 0.0, 0.0, 1.0));
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
    let dims = vec2i(textureDimensions(depthMap));
    let centerCoord = vec2i(uv * vec2f(dims));
    let ao = computeHBAO(centerCoord, dims);
    return vec4f(ao, 0.0, 0.0, 1.0);
}
