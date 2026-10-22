// Volumetric Fog -- Froxel light injection (WebGPU compute, V1).
// Option R: reuses the clustered light lists (ADR 0007). Every cluster cell already holds a
// light list (pointClusterGrid/pointClusterIndices/spotClusterGrid/spotClusterIndices), so this
// pass walks EXACTLY those lists instead of re-culling -- the grid and the volume can never
// disagree about which lights reach a cell.
//
// Output: one 3D froxel cell, written as rgba16float. The froxel grid (the size of `volume`) matches
// the cluster grid while that is fine enough, but is independent of it: each froxel cell looks up
// the light list of the cluster cell it falls into (see `clusterCellIndex`).
//   rgb = in-scattered radiance per unit length (local lights + FogVolume albedo/emission)
//   a   = extinction sigma_t (1/m, unclamped) for the integration pass
// The integration compute pass adds directional CSM sunlight and integrates along depth;
// `intensity` is applied once, in the composite pass.
//
// Bindings:
//   @group(0): reuses the engine's global bind group (structs.wgsl) -- global uniforms, light
//              lists and the clustered light grid/index buffers (COMPUTE-visibility).
//   @group(1): volumetric-fog-owned bindings (invView rotation, parameters, 3D storage texture).
//              Group 1 is free here because the inject compute pipeline is laid out as
//              [globalBGL, injectBGL] -- structs.wgsl also declares material/object/view bindings
//              at @group(1..3), but those are never referenced by this compute entry point, and
//              WebGPU validates only the resources a pipeline actually uses, so no conflict.

struct FogVolumeData {
    invTransform: mat4x4f,
    params: vec4f,        // [shape, density, edgeFade, emissionIntensity]
    albedo: vec4f,        // [r, g, b, noiseScale]
    emission: vec4f,      // [r, g, b, noiseAmount]
    size: vec4f,          // [size.x, size.y, size.z, noiseSpeed]
}

struct FroxelUniforms {
    invView: mat4x4f,        // camera rotation inverse (world from view), for cell direction
    params: vec4f,           // [density, height, heightFalloff, maxWorldDistance]
    phase: vec4f,            // [asymmetry g, ambientInject, time (s), numVolumes]
    nearFar: vec4f,          // [near, far, sliceCount, pad]
    jitter: vec4f,           // [jitterX, jitterY, jitterZ, pad]
    volumes: array<FogVolumeData, 16>,
    scatterTint: vec4f,                // [rgb = fog tint * scattering albedo (sigma_s / sigma_t), localLightShadows (0/1)]
    pointFogScale: array<vec4f, 16>,   // per point light (index = light index) volumetric intensity, 4 per vec4
    spotFogScale: array<vec4f, 16>,    // same for spot lights
    elementMaskPosition: vec4f,        // world-box centre of the element-global density mask [xyz, pad]
    elementMaskSize: vec4f,            // half-extents of the mask box [xyz, pad]
}

@group(1) @binding(0) var<uniform> froxel: FroxelUniforms;
@group(1) @binding(1) var volume: texture_storage_3d<rgba16float, write>;
// Element-global and per-volume 3D density masks (see VolumetricTexture). Absent slots are bound
// to a shared 1x1x1 identity texture (R=G=1), so an unbound mask is a no-op: the shader ALWAYS
// samples instead of branching on availability.
@group(1) @binding(2) var globalDensityMask: texture_3d<f32>;
@group(1) @binding(3) var volumeMaskSampler: sampler;
@group(1) @binding(4) var volumeMask0: texture_3d<f32>;
@group(1) @binding(5) var volumeMask1: texture_3d<f32>;
@group(1) @binding(6) var volumeMask2: texture_3d<f32>;
@group(1) @binding(7) var volumeMask3: texture_3d<f32>;
@group(1) @binding(8) var volumeMask4: texture_3d<f32>;
@group(1) @binding(9) var volumeMask5: texture_3d<f32>;
@group(1) @binding(10) var volumeMask6: texture_3d<f32>;
@group(1) @binding(11) var volumeMask7: texture_3d<f32>;

fn sampleVolumeMask(slot: u32, uvw: vec3f) -> vec4f {
    switch (slot) {
        case 0u: { return textureSampleLevel(volumeMask0, volumeMaskSampler, uvw, 0.0); }
        case 1u: { return textureSampleLevel(volumeMask1, volumeMaskSampler, uvw, 0.0); }
        case 2u: { return textureSampleLevel(volumeMask2, volumeMaskSampler, uvw, 0.0); }
        case 3u: { return textureSampleLevel(volumeMask3, volumeMaskSampler, uvw, 0.0); }
        case 4u: { return textureSampleLevel(volumeMask4, volumeMaskSampler, uvw, 0.0); }
        case 5u: { return textureSampleLevel(volumeMask5, volumeMaskSampler, uvw, 0.0); }
        case 6u: { return textureSampleLevel(volumeMask6, volumeMaskSampler, uvw, 0.0); }
        case 7u: { return textureSampleLevel(volumeMask7, volumeMaskSampler, uvw, 0.0); }
        default: { return vec4f(1.0); }
    }
}

fn boxSDF(p: vec3f, b: vec3f) -> f32 {
    let q = abs(p) - b;
    return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn sphereSDF(p: vec3f, r: f32) -> f32 {
    return length(p) - r;
}

fn cylinderSDF(p: vec3f, r: f32, h: f32) -> f32 {
    let d = vec2f(length(p.xz), abs(p.y)) - vec2f(r, h);
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}

// Analytical procedural 3D noise for animated rolling mist and billowy cloud pockets.
fn hash13(p: vec3f) -> f32 {
    let q = fract(p * 0.1031);
    let d = dot(q, q.zyx + vec3f(31.32));
    return fract((q.x + q.y) * q.z * d);
}

fn valueNoise3D(p: vec3f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);

    let n000 = hash13(i + vec3f(0.0, 0.0, 0.0));
    let n100 = hash13(i + vec3f(1.0, 0.0, 0.0));
    let n010 = hash13(i + vec3f(0.0, 1.0, 0.0));
    let n110 = hash13(i + vec3f(1.0, 1.0, 0.0));
    let n001 = hash13(i + vec3f(0.0, 0.0, 1.0));
    let n101 = hash13(i + vec3f(1.0, 0.0, 1.0));
    let n011 = hash13(i + vec3f(0.0, 1.0, 1.0));
    let n111 = hash13(i + vec3f(1.0, 1.0, 1.0));

    let nx0 = mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y);
    let nx1 = mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y);
    return mix(nx0, nx1, u.z);
}

fn fbm3D(p: vec3f) -> f32 {
    return 0.65 * valueNoise3D(p) + 0.35 * valueNoise3D(p * 2.05 + vec3f(1.7, 3.2, 5.1));
}

// Shadow term of spot light `slot` (< 4, the engine only has 4 spot shadow maps) at a point in the air:
// 4-tap PCF on the light's shadow map, the same projection/flip/depth convention as getShadowPCSS in
// pbr_math.wgsl. Points outside the map count as lit; no normal offset (the sample is not on a surface).
fn spotFogShadow(slot: u32, worldPos: vec3f) -> f32 {
    let info = global.spotShadowInfo[slot];
    if (info.z < 0.5) {
        return 1.0;
    }
    let clip = global.spotShadowMatrices[slot] * vec4f(worldPos, 1.0);
    let ndc = clip.xyz / max(clip.w, 1e-6);
    let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
    if (clip.w <= 0.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || ndc.z > 1.0 || ndc.z < 0.0) {
        return 1.0;
    }
    let dims = vec2f(textureDimensions(u_spotShadowMap));
    let o = 0.5 / dims;
    let depthRef = ndc.z - info.x;
    let layer = i32(slot);
    var lit = 0.0;
    lit += textureSampleCompareLevel(u_spotShadowMap, shadowSampler, uv + vec2f(-o.x, -o.y), layer, depthRef);
    lit += textureSampleCompareLevel(u_spotShadowMap, shadowSampler, uv + vec2f(o.x, -o.y), layer, depthRef);
    lit += textureSampleCompareLevel(u_spotShadowMap, shadowSampler, uv + vec2f(-o.x, o.y), layer, depthRef);
    lit += textureSampleCompareLevel(u_spotShadowMap, shadowSampler, uv + vec2f(o.x, o.y), layer, depthRef);
    return lit * 0.25;
}

// Henyey-Greenstein phase function (Wronski/Frostbite family). g: -1..1.
fn hgPhase(cosTheta: f32, g: f32) -> f32 {
    let g2 = g * g;
    let denom = 4.0 * 3.14159265 * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
    return (1.0 - g2) / max(denom, 1e-5);
}

// Slice centre view depth -- inverse of the cluster grid's log-staggered slicing. Matches
// `sliceCenterViewDepth` in packages/engine/src/math/froxel.ts (single source of truth).
fn sliceCenterDepth(slice: f32, near: f32, far: f32, slices: f32) -> f32 {
    let n = max(near, 1e-6);
    let f = max(far, n + 1e-6);
    let low = pow(f / n, slice / slices) * n;
    let high = pow(f / n, (slice + 1.0) / slices) * n;
    return max(n * 1.001, sqrt(low * high));
}

// World position of a froxel cell centre: camera position + the flashed NDC ray times the slice
// centre depth. Incorporates sub-voxel temporal jitter to eliminate slice banding and IGN noise.
fn cellWorldPos(cell: vec3f, dims: vec3f, camPos: vec3f, jitterScale: f32) -> vec3f {
    let ndcX = (cell.x + 0.5 + froxel.jitter.x * 0.12 * jitterScale) / dims.x * 2.0 - 1.0;
    // Flip Y: cluster grid Y grows downward (screen space), world Y grows upward.
    let ndcY = 1.0 - ((cell.y + 0.5 + froxel.jitter.y * 0.12 * jitterScale) / dims.y * 2.0);
    let viewZ = sliceCenterDepth(cell.z + froxel.jitter.z * 0.15 * jitterScale, froxel.nearFar.x, froxel.nearFar.y, froxel.nearFar.z);
    // Unnormalised (z = -1): scaling by the slice's view-space depth puts the cell centre ON that
    // depth slice (the cluster grid and the integration pass both slice by view depth).
    let viewPos = vec3f(
        ndcX / global.projScale.x,
        ndcY / global.projScale.y,
        -1.0,
    ) * viewZ;
    let worldDir = (froxel.invView * vec4f(viewPos, 0.0)).xyz;
    return camPos + worldDir;
}

// Cluster cell (flat index, same layout as cluster_cull.wgsl / lighting.wgsl) that holds the light
// list for froxel cell `gid` of a `dims`-sized froxel grid. Identical grids map 1:1; a coarser or
// degenerate (1x1x1) cluster grid maps many froxel cells onto one cluster cell.
fn clusterCellIndex(gid: vec3u, dims: vec3f) -> u32 {
    let cdx = u32(global.clusterDims.x);
    let cdy = u32(global.clusterDims.y);
    let cdz = u32(global.clusterDims.z);
    let cx = min(u32((f32(gid.x) + 0.5) / dims.x * f32(cdx)), cdx - 1u);
    let cy = min(u32((f32(gid.y) + 0.5) / dims.y * f32(cdy)), cdy - 1u);
    let near = max(froxel.nearFar.x, 1e-6);
    let far = max(froxel.nearFar.y, near + 1e-6);
    let zc = sliceCenterDepth(f32(gid.z), near, far, froxel.nearFar.z);
    let zf = floor(log(zc / near) * f32(cdz) / max(log(far / near), 1e-6));
    let cz = u32(clamp(zf, 0.0, f32(cdz - 1u)));
    return cx + cdx * (cy + cdy * cz);
}

// Sphere-mean of the (low-frequency) IBL irradiance cube: constant per frame, so one thread per
// workgroup samples the six axes and shares the result instead of every cell repeating it.
var<workgroup> ambientSky: vec3f;

@compute @workgroup_size(8, 8, 1)
fn injectFog(
    @builtin(global_invocation_id) gid: vec3u,
    @builtin(local_invocation_index) lid: u32,
) {
    // phase.y is a uniform: this branch and the barrier are in uniform control flow (and precede
    // the per-thread bounds return below).
    if (froxel.phase.y > 0.0) {
        if (lid == 0u) {
            // Isotropic scattering sees the whole sphere: mean over the six axis directions
            // approximates the irradiance L0 term; sampling straight up would only see the zenith.
            ambientSky = (
                textureSampleLevel(u_irradianceMap, globalSampler, vec3f(1.0, 0.0, 0.0), 0.0).rgb +
                textureSampleLevel(u_irradianceMap, globalSampler, vec3f(-1.0, 0.0, 0.0), 0.0).rgb +
                textureSampleLevel(u_irradianceMap, globalSampler, vec3f(0.0, 1.0, 0.0), 0.0).rgb +
                textureSampleLevel(u_irradianceMap, globalSampler, vec3f(0.0, -1.0, 0.0), 0.0).rgb +
                textureSampleLevel(u_irradianceMap, globalSampler, vec3f(0.0, 0.0, 1.0), 0.0).rgb +
                textureSampleLevel(u_irradianceMap, globalSampler, vec3f(0.0, 0.0, -1.0), 0.0).rgb
            ) * (1.0 / 6.0);
        }
        workgroupBarrier();
    }

    let volDims = textureDimensions(volume);
    let dims = vec3f(f32(volDims.x), f32(volDims.y), f32(volDims.z));
    if (f32(gid.x) >= dims.x || f32(gid.y) >= dims.y || f32(gid.z) >= dims.z) {
        return;
    }

    let cell = vec3f(gid);
    let camPos = global.viewPos.xyz;
    let worldPos = cellWorldPos(cell, dims, camPos, 1.0);
    let volumeWorldPos = cellWorldPos(cell, dims, camPos, 0.0);

    // Element-global density mask: R = per-cell density factor of the global height fog, G =
    // per-cell single-scattering albedo replacing the global `scatteringAlbedo` (the CPU uploads
    // the unbaked tint only when a mask is present). The identity placeholder keeps unmodulated
    // media bit-identical to a missing mask (factors of exactly 1.0).
    let maskUVW = clamp((worldPos - froxel.elementMaskPosition.xyz) / (2.0 * froxel.elementMaskSize.xyz) + 0.5, vec3f(0.0), vec3f(1.0));
    let maskCell = textureSampleLevel(globalDensityMask, volumeMaskSampler, maskUVW, 0.0);

    // Analytic phase -- height falloff above the fog baseline (like an exponential height fog layer).
    let heightDelta = worldPos.y - froxel.params.y;
    let heightFactor = exp(-froxel.params.z * max(heightDelta, 0.0));
    let dist = length(worldPos - camPos);
    var extinction = froxel.params.x * heightFactor * maskCell.r;
    // Smooth range fade over the last third of maxDistance (no pop edge); zero beyond it.
    let rangeFade = 1.0 - smoothstep(froxel.params.w * 0.66, froxel.params.w, dist);

    // Evaluate localized FogVolume instances at the canonical (unjittered) froxel centre so
    // analytical SDF boundaries never strobe across coarse Z-slices. Positive and negative
    // densities are accumulated separately and combined afterwards, so carving does not depend on
    // the array order.
    let baseExtinction = extinction;
    var posDensity = 0.0;
    var negDensity = 0.0;
    var volumeScatter = vec3f(0.0);  // ambient albedo + emission, already per-unit-length radiance

    let numVolumes = min(u32(froxel.phase.w), 16u);
    for (var v = 0u; v < numVolumes; v++) {
        let vol = froxel.volumes[v];
        let pLocal = (vol.invTransform * vec4f(volumeWorldPos, 1.0)).xyz;
        let shape = u32(vol.params.x);
        var sdf = 1.0;
        if (shape == 0u) {
            sdf = boxSDF(pLocal, vol.size.xyz);
        } else if (shape == 1u) {
            sdf = sphereSDF(pLocal, vol.size.x);
        } else if (shape == 2u) {
            sdf = cylinderSDF(pLocal, vol.size.x, vol.size.y);
        }

        if (sdf <= 0.0) {
            let minDim = min(vol.size.x, min(vol.size.y, vol.size.z));
            let fadeDist = max(minDim * vol.params.z, 1e-4);
            var falloff = clamp(-sdf / fadeDist, 0.0, 1.0);
            falloff = falloff * falloff * (3.0 - 2.0 * falloff);

            var volDensity = vol.params.y * falloff;

            // 3D Procedural Noise Modulation (Rolling Mist). The noise parameters ride in the
            // spare .w lanes of albedo/emission/size (see FogVolumeData).
            let noiseAmount = vol.emission.w;
            let noiseScale = vol.albedo.w;
            if (noiseAmount > 0.0 && noiseScale > 0.0 && volDensity > 0.0) {
                let time = froxel.phase.z;
                let drift = vec3f(1.0, 0.15, 0.4) * (vol.size.w * time);
                let pNoise = pLocal * noiseScale - drift;
                let turb = fbm3D(pNoise);
                volDensity = volDensity * mix(1.0, clamp(turb * 1.8, 0.0, 3.0), noiseAmount);
            }

            // Per-volume density mask sampled inside the volume's own box. The identity
            // placeholder is a no-op (R=G=1): R scales the density (can even carve voids),
            // G replaces the per-cell scattering albedo. Emission is not masked.
            let volMaskUVW = clamp((pLocal / vol.size.xyz) * 0.5 + 0.5, vec3f(0.0), vec3f(1.0));
            let volMask = sampleVolumeMask(v, volMaskUVW);
            volDensity = volDensity * volMask.r;

            if (volDensity > 0.0) {
                posDensity += volDensity;
                volumeScatter += vol.albedo.rgb * volMask.g * volDensity + vol.emission.rgb * vol.params.w * falloff;
            } else {
                negDensity += volDensity;
            }
        }
    }

    let uncarved = baseExtinction + posDensity;
    extinction = max(0.0, uncarved + negDensity);
    // Carving also removes the ambient/emissive contribution of the volumes it cuts through.
    volumeScatter *= select(0.0, extinction / uncarved, uncarved > 1e-5);
    extinction *= rangeFade;
    volumeScatter *= rangeFade;

    var inScatter = volumeScatter;

    if (extinction > 0.0) {
        let cellIndex = clusterCellIndex(gid, dims);
        let viewDir = normalize(worldPos - camPos);
        var lightScatter = vec3f(0.0);

        // Point lights in this cell's light list (same range window as lighting.wgsl).
        let pt = pointClusterGrid[cellIndex];
        for (var i = 0u; i < pt.y; i++) {
            let lightIdx = pointClusterIndices[pt.x + i];
            let light = pLights[lightIdx];
            let toLight = light.pos.xyz - worldPos;
            let lightDist = max(length(toLight), 1e-4);
            let ldir = toLight / lightDist;
            let phase = hgPhase(dot(ldir, viewDir), froxel.phase.x);
            let ratio = lightDist / max(light.pos.w, 0.001);
            let window = clamp(1.0 - ratio * ratio * ratio * ratio, 0.0, 1.0);
            // Same two attenuation modes as the surface shader (lighting_pbr.wgsl): col.w (decay) > 0 is
            // the windowed inverse square -- regularised with 1 + d^2 because a point INSIDE the
            // medium can sit arbitrarily close to the light (surfaces clamp at d^2 >= 0.01) -- and
            // decay == 0 is the linear 1 - d/range ramp, so fog and lit surfaces agree per light.
            var atten = window * window / (1.0 + lightDist * lightDist);
            if (light.col.w <= 0.0) {
                atten = clamp(1.0 - ratio, 0.0, 1.0);
            }
            let fogScale = froxel.pointFogScale[lightIdx / 4u][lightIdx % 4u];
            lightScatter += light.col.rgb * atten * phase * fogScale;
        }

        // Spot lights: cone from params.x (cos outer) / params.y (cos inner), range params.z.
        let st = spotClusterGrid[cellIndex];
        for (var j = 0u; j < st.y; j++) {
            let lightIdx = spotClusterIndices[st.x + j];
            let light = sLights[lightIdx];
            let toLight = light.pos.xyz - worldPos;
            let lightDist = max(length(toLight), 1e-4);
            let ldir = toLight / lightDist;
            let maxDist = light.params.z;
            if (maxDist > 0.0 && lightDist >= maxDist) { continue; }
            let theta = dot(-ldir, normalize(light.dir.xyz));
            if (theta <= light.params.x) { continue; }
            // Linear cone ramp like the surface shader (not smoothstep), so the beam edge matches the lit cone.
            let cone = clamp((theta - light.params.x) / max(light.params.y - light.params.x, 0.0001), 0.0, 1.0);
            let phase = hgPhase(dot(ldir, viewDir), froxel.phase.x);
            // DECISION: spots keep a regularised inverse-square (1 / (1 + d^2)) that the surface shader
            // (pow(1 - d/maxDist, decay) only) does not have: light travelling through a medium is
            // physically attenuated with distance, and without it a spot beam would not fade along its length.
            var atten = 1.0 / (1.0 + lightDist * lightDist);
            if (maxDist > 0.0) {
                atten *= pow(clamp(1.0 - lightDist / maxDist, 0.0, 1.0), max(light.params.w, 1.0));
            }
            let fogScale = froxel.spotFogScale[lightIdx / 4u][lightIdx % 4u];
            var shadow = 1.0;
            if (froxel.scatterTint.w > 0.5 && lightIdx < 4u) {
                shadow = spotFogShadow(lightIdx, worldPos);
            }
            lightScatter += light.col.rgb * atten * cone * phase * fogScale * shadow;
        }

        // Scattering coefficient sigma_s == extinction (albedo 1). Intensity is applied once, in
        // the composite pass. maskCell.g replaces the global albedo baked into scatterTint per cell.
        inScatter += lightScatter * froxel.scatterTint.rgb * maskCell.g * extinction;

        // Ambient inject: scene ambient colour plus the IBL irradiance from above, scaled by density.
        if (froxel.phase.y > 0.0) {
            let ambient = global.ambientColor.rgb + ambientSky * global.envIntensity;
            inScatter += ambient * froxel.scatterTint.rgb * maskCell.g * (froxel.phase.y * extinction);
        }
    }

    // rgb = in-scattered radiance per unit length, a = extinction sigma_t (unclamped, 1/m).
    textureStore(
        volume,
        vec3u(gid),
        vec4f(inScatter, extinction),
    );
}
