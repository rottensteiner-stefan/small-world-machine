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

    let texelSize = vec2f(1.0) / vec2f(dims);
    let depthR = textureLoad(depthMap, clamp(centerCoord + vec2i(1, 0), vec2i(0, 0), maxCoord), 0);
    let depthU = textureLoad(depthMap, clamp(centerCoord + vec2i(0, 1), vec2i(0, 0), maxCoord), 0);
    let linearZR = select(linearizeDepth(depthR), linearZ, depthR >= 1.0);
    let linearZU = select(linearizeDepth(depthU), linearZ, depthU >= 1.0);
    let dPosDx = reconstructViewPos(uv + vec2f(texelSize.x, 0.0), linearZR) - viewPos;
    let dPosDy = reconstructViewPos(uv + vec2f(0.0, texelSize.y), linearZU) - viewPos;
    let crossN = cross(dPosDx, dPosDy);
    let lenSq = dot(crossN, crossN);
    var normal = select(vec3f(0.0, 0.0, -1.0), normalize(crossN), lenSq > 0.000001);
    if (normal.z > 0.0) {
        normal = -normal;
    }

    let dirs = array<vec2f, 6>(
        vec2f(1.0, 0.0), vec2f(0.5, 0.866025), vec2f(-0.5, 0.866025),
        vec2f(-1.0, 0.0), vec2f(-0.5, -0.866025), vec2f(0.5, -0.866025),
    );

    var occlusion = 0.0;
    for (var d = 0; d < 6; d++) {
        var maxHorizonSin = 0.0;
        for (var s = 1; s <= 4; s++) {
            let sampleCoord = centerCoord + vec2i(dirs[d] * f32(s) * 4.0);
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
