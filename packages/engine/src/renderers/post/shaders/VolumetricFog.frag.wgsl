// Volumetric Fog -- integration (ray-march) pass, fragment stage.
// Walks the camera rays from near to the opaque surface depth (or maxWorldDistance), reads the
// pre-injected froxel volume and integrates forward-scattered in-scattering with transmittance.
// Directional light contribution and its cascaded-shadow-map self-shadowing are evaluated per
// march step (CSM shadowing IN V1, per the approved plan).
//
// Option R coupling: on the CPU side the volume grid IS the clustered light grid, and this pass
// reconstructs the same (tileX, tileY, depthSlice) cell mapping from the screen position and the
// march distance -- exactly the two shared functions a single source of truth keeps in sync
// (`computeClusterCounts` / `froxelSliceFromViewDepth`). Read-only trivially.
//
// Output: rgba16float target with integrated in-scattering (rgb), composited additively into the
// HDR buffer before tonemapping (see PostProcess.frag.wgsl). No depth write.

@group(0) @binding(0) var opaqueDepth: texture_depth_2d;
@group(0) @binding(1) var volumeSampler: sampler;
@group(0) @binding(2) var volume: texture_3d<f32>;
@group(0) @binding(3) var shadowMap: texture_depth_2d_array;
@group(0) @binding(4) var shadowSampler: sampler_comparison;
@group(0) @binding(5) var<uniform> uni: FroxelSettings;

struct FroxelSettings {
    invViewProj: mat4x4f,
    camPos: vec4f,
    nearFar: vec4f,          // [near, far, screenW, screenH]
    params: vec4f,           // [density, maxWorldDistance, asymmetry(g), intensity]
    sunDir: vec4f,           // [x, y, z, pad]
    sunColorIntensity: vec4f,// [r, g, b, intensity]
    cascadeSplits: vec4f,
    shadowInfo: vec4f,       // [bias, normalBias, castShadow, numCascades]
    cascadeMatrices0: mat4x4f,
    cascadeMatrices1: mat4x4f,
    cascadeMatrices2: mat4x4f,
    cascadeMatrices3: mat4x4f,
}

// Interleaved Gradient Noise (IGN, J. Jimenez 2014) -- jitters the march start to turn banding
// into high-frequency noise (same technique as ADR 0030's light shafts).
fn ign(pix: vec2f, frameSeed: f32) -> f32 {
    let magic = vec3f(52.9829189, 0.06711056, 0.00583715);
    return fract(magic.z * frameSeed + dot(pix, magic.xy));
}

// Henyey-Greenstein phase function for the directional contribution (Frostbite family).
fn hgPhase(cosTheta: f32, g: f32) -> f32 {
    let g2 = g * g;
    let denom = 4.0 * 3.14159265 * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
    return (1.0 - g2) / max(denom, 1e-5);
}

// Inverse log depth mapping: NDC depth -> view-space (positive) linear depth.
fn projInvDepth(ndcZ: f32, near: f32, far: f32) -> f32 {
    let z = ndcZ * 2.0 - 1.0;
    return (2.0 * near * far) / (far + near - z * (far - near));
}

// Reuses the cluster grid's log-staggered slicing (single source of truth mirrors the CPU side:
// froxel.ts / ClusterGrid.zSliceFromViewDepth). Feeds the volume cell choice along the ray.
fn sliceFromViewDepth(viewZ: f32, near: f32, far: f32, slices: f32) -> f32 {
    let clampedZ = clamp(viewZ, near, far);
    let slice = floor(log(clampedZ / near) * slices / log(far / near));
    return clamp(slice, 0.0, slices - 1.0);
}

// Samples the cascade shadow map for a world position on cascade `c`, returning lit (1.0)..
// shadowed (0.0). Early-outs outside the cascade's NDC rectangle.
fn sampleCascadeShadow(wp: vec3f, c: u32) -> f32 {
    let cm = select(uni.cascadeMatrices0, select(uni.cascadeMatrices1, select(uni.cascadeMatrices2, uni.cascadeMatrices3, c == 3u), c == 2u), c == 1u);
    let sc = cm * vec4f(wp, 1.0);
    if (sc.w <= 0.0) {
        return 1.0;
    }
    let uv = sc.xy / sc.w * 0.5 + vec2f(0.5);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        return 1.0;
    }
    let depth = sc.z / sc.w;
    let bias = uni.shadowInfo.x;
    // WebGPU sampler_comparison: 0.0 = occluded, 1.0 = lit.
    return textureSampleCompareLevel(shadowSampler, shadowMap, uv, u32(min(c, 3u)), depth - bias);
}

// Directional contribution with CSM self-shadowing across the near cascades (0..1), matching
// ADR 0030's cascade-clamping decision (distant volume is analytic-fog territory).
fn sampleSunShadows(wp: vec3f) -> f32 {
    var lit = sampleCascadeShadow(wp, 0u);
    lit = min(lit, sampleCascadeShadow(wp, 1u));
    return lit;
}

@fragment
fn fs_main(@builtin(position) fragPos: vec4f) -> @location(0) vec4f {
    let uv = fragPos.xy / uni.nearFar.zw; // [0..1]^2, screen space (Y down). Volume Y is screen-ordered too.

    // World-space ray direction from the camera through the near/far planes.
    let clipXY = uv * 2.0 - 1.0;
    var pNdc = vec4f(clipXY.x, -clipXY.y, 1.0, 1.0);
    let pFar = uni.invViewProj * pNdc;
    let pFarW = pFar.xyz / pFar.w;
    var dir = pFarW - uni.camPos.xyz;
    if (length(dir) < 1e-6 || !all(dir == dir)) {
        dir = vec3f(0.0, 0.0, -1.0);
    }
    dir = normalize(dir);

    // March range: near..min(maxWorldDistance, opaque surface depth).
    var tEnd = uni.params.y;
    let depthVal = textureSampleLevel(opaqueDepth, volumeSampler, uv, 0.0);
    let perspective = projInvDepth(depthVal, uni.nearFar.x, uni.nearFar.y);
    tEnd = min(tEnd, perspective);
    if (tEnd <= uni.nearFar.x) {
        return vec4f(0.0, 0.0, 0.0, 1.0);
    }

    let steps = 32u;
    let stepLen = (tEnd - uni.nearFar.x) / f32(steps);
    var t = uni.nearFar.x + stepLen * ign(uv * uni.nearFar.zw, uni.params.y);

    var scattering = vec3f(0.0);
    var transmittance = 1.0;

    let volDims = vec3f(textureDimensions(volume, 0));
    let volMax = max(volDims.x, max(volDims.y, volDims.z));
    let sunActive = uni.sunColorIntensity.w > 0.0;
    let g = uni.params.z;
    let sunDir = normalize(uni.sunDir.xyz);

    for (var i = 0u; i < steps; i++) {
        if (t > tEnd) { break; }

        let wp = uni.camPos.xyz + dir * t;

        // Option R cell mapping: tile = screen tile of this pixel, slice = log-depth slice of t.
        let cellX = clamp(floor(uv.x * volDims.x), 0.0, volDims.x - 1.0);
        let cellY = clamp(floor(uv.y * volDims.y), 0.0, volDims.y - 1.0);
        let sliceF = sliceFromViewDepth(t, uni.nearFar.x, uni.nearFar.y, volDims.z);
        let cell = vec3f(cellX, cellY, min(sliceF, volDims.z - 1.0));
        let vol = textureSampleLevel(volume, volumeSampler, (cell + vec3f(0.5)) / volMax * 0.9999, 0.0);

        let density = max(vol.a, 0.0);
        let extinctionStep = density * stepLen;
        let stepTransmittance = exp(-extinctionStep);

        var inscatter = vec3f(0.0);
        if (density > 0.0) {
            // Resistance-integration-free forward marching: emissive + scattered radiance per step.
            inscatter = vol.rgb * stepLen;
            if (sunActive && uni.shadowInfo.z > 0.5) {
                let cosTheta = max(dot(-sunDir, dir), -1.0);
                let phase = hgPhase(cosTheta, g);
                let lit = sampleSunShadows(wp);
                inscatter += uni.sunColorIntensity.rgb * uni.sunColorIntensity.w * phase * lit * stepLen;
            }
        }

        scattering += transmittance * inscatter;
        transmittance *= stepTransmittance;

        t += stepLen;
        if (transmittance < 0.01) { break; }
    }

    return vec4f(scattering, transmittance);
}
