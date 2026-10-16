// Volumetric Fog -- 3D Ping-Pong Temporal Reprojection (WebGPU Compute, Option R).
// Reprojects froxel samples across camera movement, samples the previous frame's 3D history
// texture using trilinear filtering, and applies 3D AABB neighborhood clamping (7-tap) to prevent
// ghosting while eliminating IGN jitter noise and slice stepping.

struct FroxelReprojectSettings {
    invViewProj: mat4x4f,
    prevViewProj: mat4x4f,
    camPos: vec4f,
    nearFar: vec4f,          // [near, far, sliceCount, pad]
    reprojectParams: vec4f,  // [historyAlpha (0.85-0.95), jitterX, jitterY, jitterZ]
}

@group(0) @binding(0) var currentVolume: texture_3d<f32>;
@group(0) @binding(1) var historyVolume: texture_3d<f32>;
@group(0) @binding(2) var linearSampler: sampler;
@group(0) @binding(3) var outputVolume: texture_storage_3d<rgba16float, write>;
@group(0) @binding(4) var<uniform> uni: FroxelReprojectSettings;

// Depth calculation matching froxel.ts sliceCenterViewDepth single source of truth.
fn sliceDepth(slice: f32, near: f32, far: f32, slices: f32) -> f32 {
    let n = max(near, 1e-6);
    let f = max(far, n + 1e-6);
    let low = pow(f / n, slice / slices) * n;
    let high = pow(f / n, (slice + 1.0) / slices) * n;
    return max(n * 1.001, sqrt(low * high));
}

// Inverse mapping: view-space depth -> normalized [0, 1] slice coordinate.
fn depthToNormalizedSlice(viewZ: f32, near: f32, far: f32) -> f32 {
    let n = max(near, 1e-6);
    let f = max(far, n + 1e-6);
    let clampedZ = clamp(viewZ, n, f);
    return log(clampedZ / n) / max(log(f / n), 1e-6);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let dims = textureDimensions(outputVolume);
    let x = gid.x;
    let y = gid.y;
    let z = gid.z;
    if (x >= dims.x || y >= dims.y || z >= dims.z) {
        return;
    }

    let coord = vec3u(x, y, z);
    let currentSample = textureLoad(currentVolume, coord, 0);

    // 1. Calculate 3D AABB of the 7-tap neighborhood in the current frame to prevent ghosting.
    var boxMin = currentSample;
    var boxMax = currentSample;

    let maxCoord = dims - vec3u(1u);
    let neighbors = array<vec3i, 6>(
        vec3i(-1, 0, 0), vec3i(1, 0, 0),
        vec3i(0, -1, 0), vec3i(0, 1, 0),
        vec3i(0, 0, -1), vec3i(0, 0, 1)
    );

    for (var i = 0u; i < 6u; i++) {
        let nCoord = clamp(vec3i(coord) + neighbors[i], vec3i(0), vec3i(maxCoord));
        let val = textureLoad(currentVolume, vec3u(nCoord), 0);
        boxMin = min(boxMin, val);
        boxMax = max(boxMax, val);
    }

    // Expand box slightly to allow smooth temporal convergence.
    let boxPadding = 0.05 * (boxMax - boxMin) + vec4f(1e-4);
    boxMin = boxMin - boxPadding;
    boxMax = boxMax + boxPadding;

    // 2. Reconstruct current froxel world position incorporating sub-voxel jitter.
    let near = uni.nearFar.x;
    let far = uni.nearFar.y;
    let slices = f32(dims.z);

    let jitter = uni.reprojectParams.yzw;
    let ndcX = (f32(x) + 0.5 + jitter.x) / f32(dims.x) * 2.0 - 1.0;
    let ndcY = 1.0 - (f32(y) + 0.5 + jitter.y) / f32(dims.y) * 2.0;
    let zMid = sliceDepth(f32(z) + jitter.z, near, far, slices);

    let clipZ = (2.0 * near * far - zMid * (far + near)) / max(zMid * (near - far), 1e-6);
    let ndcZ = clipZ * 0.5 + 0.5;
    let clipPos = vec4f(ndcX, ndcY, ndcZ, 1.0);
    let worldH = uni.invViewProj * clipPos;
    let worldPos = worldH.xyz / max(worldH.w, 1e-6);

    // 3. Project world position into previous frame clip space.
    let prevClip = uni.prevViewProj * vec4f(worldPos, 1.0);
    var blendedResult = currentSample;

    if (prevClip.w > 0.001) {
        let prevUV = prevClip.xy / prevClip.w * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
        let prevViewZ = prevClip.w;
        let prevSliceW = depthToNormalizedSlice(prevViewZ, near, far);

        // Check if previous position lies within previous view frustum.
        if (prevUV.x >= 0.0 && prevUV.x <= 1.0 &&
            prevUV.y >= 0.0 && prevUV.y <= 1.0 &&
            prevSliceW >= 0.0 && prevSliceW <= 1.0) {

            // Hardware trilinear 3D sample from history.
            let historySample = textureSampleLevel(
                historyVolume,
                linearSampler,
                vec3f(prevUV, prevSliceW),
                0.0,
            );

            // 4. Clamp history sample to current AABB bounds (Variance Clipping).
            let clampedHistory = clamp(historySample, boxMin, boxMax);

            // 5. Exponential Moving Average (EMA) blend.
            let alpha = clamp(uni.reprojectParams.x, 0.0, 0.98);
            blendedResult = mix(currentSample, clampedHistory, alpha);
        }
    }

    textureStore(outputVolume, coord, blendedResult);
}
