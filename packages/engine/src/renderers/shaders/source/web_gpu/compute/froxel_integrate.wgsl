// Volumetric Fog -- In-Register Z-Slice Integration (WebGPU Compute, Option R).
// Walks along the view-space depth slices front-to-back in registers per (x, y) column.
// Evaluates directional sunlight and its cascaded-shadow-map self-shadowing per slice,
// combines it with local-light in-scattering, and integrates optical depth (Beer-Lambert law)
// with the Decima Powder Effect modifier into an integrated 3D volume (rgba16float).
//
// Output:
//   rgb = accumulated in-scattered radiance
//   a   = accumulated transmittance (1.0 = clear, 0.0 = fully extinguished)
//
// Workgroup size @workgroup_size(8, 8, 1) processes one (x, y) column per thread,
// eliminating shared memory and barrier synchronizations entirely.

struct FroxelIntegrationSettings {
    invViewProj: mat4x4f,
    camPos: vec4f,
    nearFar: vec4f,          // [near, far, sliceCount, pad]
    params: vec4f,           // [unused, maxWorldDistance, asymmetry(g), unused] (intensity: composite pass)
    sunDir: vec4f,           // [x, y, z, pad]
    sunColorIntensity: vec4f,// [r, g, b, activeFlag]
    cascadeSplits: vec4f,
    shadowInfo: vec4f,       // [bias, normalBias, castShadow, numCascades]
    cascadeMatrices0: mat4x4f,
    cascadeMatrices1: mat4x4f,
    cascadeMatrices2: mat4x4f,
    cascadeMatrices3: mat4x4f,
    elementMaskPosition: vec4f, // world-box centre of the element density mask [xyz, pad]
    elementMaskSize: vec4f,     // half-extents of the mask box [xyz, pad]
}

@group(0) @binding(0) var filteredVolume: texture_3d<f32>;
@group(0) @binding(1) var volumeSampler: sampler;
@group(0) @binding(2) var shadowMap: texture_depth_2d_array;
@group(0) @binding(3) var shadowSampler: sampler_comparison;
@group(0) @binding(4) var integratedVolume: texture_storage_3d<rgba16float, write>;
@group(0) @binding(5) var<uniform> uni: FroxelIntegrationSettings;
@group(0) @binding(6) var globalDensityMask: texture_3d<f32>;
@group(0) @binding(7) var globalMaskSampler: sampler;

// Henyey-Greenstein phase function for the directional contribution.
fn hgPhase(cosTheta: f32, g: f32) -> f32 {
    let g2 = g * g;
    let denom = 4.0 * 3.14159265 * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
    return (1.0 - g2) / max(denom, 1e-5);
}

// Slice depth calculation matching froxel.ts sliceCenterViewDepth single source of truth.
fn sliceDepth(slice: f32, near: f32, far: f32, slices: f32) -> f32 {
    let n = max(near, 1e-6);
    let f = max(far, n + 1e-6);
    let low = pow(f / n, slice / slices) * n;
    let high = pow(f / n, (slice + 1.0) / slices) * n;
    return max(n * 1.001, sqrt(low * high));
}

// Slice boundaries for calculating slice thickness Δz.
fn sliceBounds(slice: f32, near: f32, far: f32, slices: f32) -> vec2f {
    let n = max(near, 1e-6);
    let f = max(far, n + 1e-6);
    let zNear = pow(f / n, slice / slices) * n;
    let zFar = pow(f / n, (slice + 1.0) / slices) * n;
    return vec2f(zNear, zFar);
}

// Shadow of one cascade at a world position (1 = lit). Outside the cascade's map counts as lit.
fn sampleCascade(worldPos: vec3f, cascadeIndex: u32) -> f32 {
    var shadowMatrix = uni.cascadeMatrices0;
    if (cascadeIndex == 1u) { shadowMatrix = uni.cascadeMatrices1; }
    else if (cascadeIndex == 2u) { shadowMatrix = uni.cascadeMatrices2; }
    else if (cascadeIndex == 3u) { shadowMatrix = uni.cascadeMatrices3; }

    let shadowPos = shadowMatrix * vec4f(worldPos, 1.0);
    let shadowCoord = shadowPos.xyz / max(shadowPos.w, 1e-6);
    let shadowUV = shadowCoord.xy * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);

    if (shadowUV.x < 0.0 || shadowUV.x > 1.0 || shadowUV.y < 0.0 || shadowUV.y > 1.0 || shadowCoord.z > 1.0) {
        return 1.0;
    }

    return textureSampleCompareLevel(
        shadowMap,
        shadowSampler,
        shadowUV,
        i32(cascadeIndex),
        shadowCoord.z - uni.shadowInfo.x,
    );
}

// Cascaded Shadow Map evaluation per slice. Same convention as the surface shaders
// (lighting_pbr.wgsl): cascades are selected by the Euclidean distance from the camera (NOT view
// depth) and blended over the last 10% of a cascade's range.
fn sampleCascadeShadow(worldPos: vec3f, viewDist: f32) -> f32 {
    if (uni.shadowInfo.z < 0.5 || uni.shadowInfo.w < 0.5) {
        return 1.0;
    }

    let numCascades = u32(uni.shadowInfo.w);
    var cascadeIndex = numCascades - 1u;
    let splits = array<f32, 4>(uni.cascadeSplits.x, uni.cascadeSplits.y, uni.cascadeSplits.z, uni.cascadeSplits.w);
    for (var c = 0u; c < numCascades; c++) {
        if (viewDist < splits[c]) {
            cascadeIndex = c;
            break;
        }
    }

    var shadow = sampleCascade(worldPos, cascadeIndex);
    if (cascadeIndex + 1u < numCascades) {
        let splitFar = splits[cascadeIndex];
        let blendBand = max(splitFar * 0.1, 0.0001);
        let blendToNext = 1.0 - clamp((splitFar - viewDist) / blendBand, 0.0, 1.0);
        if (blendToNext > 0.0) {
            shadow = mix(shadow, sampleCascade(worldPos, cascadeIndex + 1u), blendToNext);
        }
    }
    return shadow;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let dims = textureDimensions(integratedVolume);
    let x = gid.x;
    let y = gid.y;
    if (x >= dims.x || y >= dims.y) {
        return;
    }

    let near = uni.nearFar.x;
    let far = uni.nearFar.y;
    let slices = f32(dims.z);
    let maxDist = uni.params.y;
    let sunDir = uni.sunDir.xyz;
    let sunActive = uni.sunColorIntensity.w > 0.5;
    let sunColor = uni.sunColorIntensity.rgb;
    let asymmetry = uni.params.z;

    // Ray reconstruction through the pixel column in NDC space.
    let ndcX = (f32(x) + 0.5) / f32(dims.x) * 2.0 - 1.0;
    let ndcY = 1.0 - (f32(y) + 0.5) / f32(dims.y) * 2.0;

    var accumulatedRadiance = vec3f(0.0);
    var accumulatedTransmittance = 1.0;

    // Sequential march along Z in registers.
    for (var z = 0u; z < dims.z; z++) {
        let coord = vec3u(x, y, z);
        let cellData = textureLoad(filteredVolume, coord, 0);
        let localInScatter = cellData.rgb;
        let extinction = max(cellData.a, 0.0);

        let bounds = sliceBounds(f32(z), near, far, slices);
        let zMid = sliceDepth(f32(z), near, far, slices);
        let slabThickness = max(bounds.y - bounds.x, 1e-5);

        if (zMid > maxDist) {
            // Beyond maximum distance: keep the accumulated values (froxel_inject.wgsl already faded the
            // extinction to zero over the last third, so this is a continuation, not a pop).
            textureStore(integratedVolume, coord, vec4f(accumulatedRadiance, accumulatedTransmittance));
            continue;
        }

        // Reconstruct world position for directional lighting and shadow sampling.
        let clipZ = ((far + near) * zMid - 2.0 * near * far) / max(zMid * (far - near), 1e-6);
        let clipPos = vec4f(ndcX, ndcY, clipZ, 1.0);
        let worldH = uni.invViewProj * clipPos;
        let worldPos = worldH.xyz / max(worldH.w, 1e-6);
        let viewDir = normalize(worldPos - uni.camPos.xyz);
        // Slices are slabs of view-space depth; the ray crosses a slab off-axis over
        // slabThickness / cos(theta) = slabThickness * rayDistance / viewDepth.
        let stepLen = slabThickness * max(length(worldPos - uni.camPos.xyz) / max(zMid, 1e-6), 1.0);

        // Directional sun in-scattering: sigma_s * L, with sigma_s == extinction (same convention
        // as the local lights in froxel_inject.wgsl), so the sun scales with density.
        var sunScatter = vec3f(0.0);
        if (sunActive && extinction > 0.0) {
            // Element density-mask albedo per slice: G re-binds the per-cell single-scattering
            // albedo, so the CPU uploads the sun tint unbaked only when a mask is present. The
            // identity placeholder keeps an absent mask at a factor of exactly 1.0.
            let maskUVW = clamp((worldPos - uni.elementMaskPosition.xyz) / (2.0 * uni.elementMaskSize.xyz) + 0.5, vec3f(0.0), vec3f(1.0));
            let maskAlbedo = textureSampleLevel(globalDensityMask, globalMaskSampler, maskUVW, 0.0).g;
            // sunDir points TO the sun, viewDir camera -> point: forward scattering is dot = +1
            // (same convention as the local lights in froxel_inject.wgsl).
            let cosTheta = dot(viewDir, sunDir);
            let phase = hgPhase(cosTheta, asymmetry);
            let shadow = sampleCascadeShadow(worldPos, length(worldPos - uni.camPos.xyz));
            sunScatter = sunColor * (shadow * phase * extinction) * maskAlbedo;
        }

        // Beer-Lambert transmittance. The Decima/Nubis powder term only brightens thin edges of
        // the in-scattered light; it must not alter the transmittance.
        let stepTau = extinction * stepLen;
        let stepTransmittance = exp(-stepTau);
        let halfTransmittance = exp(-0.5 * stepTau);
        let powder = mix(1.0, 1.0 - exp(-2.0 * stepTau), 0.35);

        // Analytic in-scatter integral S * (1 - T) / sigma_t over the full step and its first half.
        let totalScatter = (localInScatter + sunScatter) * powder;
        var stepRadiance = totalScatter * stepLen;
        var halfRadiance = totalScatter * (0.5 * stepLen);
        if (extinction > 1e-5) {
            stepRadiance = totalScatter * ((1.0 - stepTransmittance) / extinction);
            halfRadiance = totalScatter * ((1.0 - halfTransmittance) / extinction);
        }

        // The stored value is the integral up to the slice CENTRE (where the composite samples
        // it), not the far slice boundary.
        textureStore(
            integratedVolume,
            coord,
            vec4f(accumulatedRadiance + accumulatedTransmittance * halfRadiance, accumulatedTransmittance * halfTransmittance),
        );
        accumulatedRadiance += accumulatedTransmittance * stepRadiance;
        accumulatedTransmittance *= stepTransmittance;
    }
}
