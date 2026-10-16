// Volumetric Fog -- Froxel light injection (WebGPU compute, V1).
// Option R: reuses the clustered light grid (ADR 0007). Every cluster cell already holds a
// light list (pointClusterGrid/pointClusterIndices/spotClusterGrid/spotClusterIndices), so this
// pass walks EXACTLY those lists instead of re-culling -- the grid and the volume can never
// disagree about which lights reach a cell.
//
// Output: one 3D froxel cell per cluster grid cell, written as rgba16float:
//   rgb = accumulated forward-scattered in-scattering (against local lights)
//   a   = extinction * density-factor for the ray-march integration pass
// The integration (fragment) pass applies directional CSM self-shadowing per march step.
//
// Bindings:
//   @group(0): reuses the engine's global bind group (structs.wgsl) -- global uniforms, light
//              lists and the clustered light grid/index buffers (COMPUTE-visibility).
//   @group(4): volumetric-fog-owned bindings (invView rotation, parameters, 3D storage texture).
//              Group 4 (not 1) because the assembled shader prepends structs.wgsl, which already
//              claims @group(1..3) for material/object/view bindings -- WebGPU pipeline layouts
//              tolerate sparse entries, so the own bind group sits at the free index 4.

struct FogVolumeData {
    invTransform: mat4x4f,
    params: vec4f,        // [shape, density, edgeFade, emissionIntensity]
    albedo: vec4f,        // [r, g, b, pad]
    emission: vec4f,      // [r, g, b, pad]
    size: vec4f,          // [size.x, size.y, size.z, pad]
}

struct FroxelUniforms {
    invView: mat4x4f,        // camera rotation inverse (world from view), for cell direction
    params: vec4f,           // [density, height, heightFalloff, maxWorldDistance]
    phase: vec4f,            // [asymmetry g, intensity, unused, numVolumes]
    nearFar: vec4f,          // [near, far, sliceCount, pad]
    jitter: vec4f,           // [jitterX, jitterY, jitterZ, pad]
    volumes: array<FogVolumeData, 16>,
}

@group(1) @binding(0) var<uniform> froxel: FroxelUniforms;
@group(1) @binding(1) var volume: texture_storage_3d<rgba16float, write>;

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
fn cellWorldPos(cell: vec3f, dims: vec3f, camPos: vec3f) -> vec3f {
    let ndcX = (cell.x + 0.5 + froxel.jitter.x) / dims.x * 2.0 - 1.0;
    // Flip Y: cluster grid Y grows downward (screen space), world Y grows upward.
    let ndcY = 1.0 - ((cell.y + 0.5 + froxel.jitter.y) / dims.y * 2.0);
    let viewZ = sliceCenterDepth(cell.z + froxel.jitter.z, froxel.nearFar.x, froxel.nearFar.y, froxel.nearFar.z);
    var viewDir = vec3f(
        ndcX / global.projScale.x,
        ndcY / global.projScale.y,
        -1.0,
    );
    viewDir = normalize(viewDir);
    let worldDir = (froxel.invView * vec4f(viewDir, 0.0)).xyz;
    return camPos + worldDir * viewZ;
}

@compute @workgroup_size(4, 4, 1)
fn injectFog(@builtin(global_invocation_id) gid: vec3u) {
    let dims = vec3f(f32(global.clusterDims.x), f32(global.clusterDims.y), f32(global.clusterDims.z));
    if (f32(gid.x) >= dims.x || f32(gid.y) >= dims.y || f32(gid.z) >= dims.z) {
        return;
    }

    let cell = vec3f(gid);
    let camPos = global.viewPos.xyz;
    let worldPos = cellWorldPos(cell, dims, camPos);

    // Analytic phase -- height falloff above the fog baseline (like an exponential height fog layer).
    let heightDelta = worldPos.y - froxel.params.y;
    let heightFactor = exp(-froxel.params.z * max(heightDelta, 0.0));
    let dist = length(worldPos - camPos);
    var extinction = froxel.params.x * heightFactor;
    if (dist > froxel.params.w) {
        extinction = 0.0;
    }

    var inScatter = vec3f(0.0);

    // Evaluate localized FogVolume instances (positive density & interior carving)
    let numVolumes = min(u32(froxel.phase.w), 16u);
    for (var v = 0u; v < numVolumes; v++) {
        let vol = froxel.volumes[v];
        let pLocal = (vol.invTransform * vec4f(worldPos, 1.0)).xyz;
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

            // 3D Procedural Noise Modulation (Rolling Mist)
            let noiseAmount = vol.emission.w;
            let noiseScale = vol.albedo.w;
            if (noiseAmount > 0.0 && noiseScale > 0.0 && volDensity > 0.0) {
                let time = froxel.phase.z;
                let drift = vec3f(1.0, 0.15, 0.4) * (vol.size.w * time);
                let pNoise = pLocal * noiseScale - drift;
                let turb = fbm3D(pNoise);
                volDensity = volDensity * mix(1.0, clamp(turb * 1.8, 0.0, 3.0), noiseAmount);
            }

            extinction = max(0.0, extinction + volDensity);

            if (volDensity > 0.0) {
                let emission = vol.emission.rgb * vol.params.w;
                inScatter += (vol.albedo.rgb * volDensity + emission * falloff) * froxel.phase.y;
            }
        }
    }

    if (extinction > 0.0) {
        let cellIndex = u32(gid.x) + u32(global.clusterDims.x) * (u32(gid.y) + u32(global.clusterDims.y) * u32(gid.z));
        let maxPerCluster = u32(global.clusterDims.w);

        // Point lights in this cell's light list.
        let pt = pointClusterGrid[cellIndex];
        for (var i = 0u; i < pt.y; i++) {
            let lightIdx = pointClusterIndices[pt.x + i];
            let light = pLights[lightIdx];
            let toLight = light.pos.xyz - worldPos;
            let lightDist = max(length(toLight), 1e-4);
            let ldir = toLight / lightDist;
            let viewDir = normalize(worldPos - camPos);
            let cosTheta = max(dot(ldir, viewDir), -1.0);
            let phase = hgPhase(cosTheta, froxel.phase.x);
            let atten = 1.0 / (1.0 + lightDist * lightDist);
            inScatter += light.col.rgb * atten * phase;
        }

        // Spot lights -- same list, same phase; cone falloff via params.z = max distance.
        let st = spotClusterGrid[cellIndex];
        for (var j = 0u; j < st.y; j++) {
            let lightIdx = spotClusterIndices[st.x + j];
            let light = sLights[lightIdx];
            let toLight = light.pos.xyz - worldPos;
            let lightDist = max(length(toLight), 1e-4);
            let ldir = toLight / lightDist;
            let viewDir = normalize(worldPos - camPos);
            let cosTheta = max(dot(ldir, viewDir), -1.0);
            let phase = hgPhase(cosTheta, froxel.phase.x);
            let coneDir = normalize(light.dir.xyz);
            let cosAngle = dot(ldir, coneDir);
            let spotIntensity = smoothstep(1.0, 0.0, (1.0 - cosAngle) / max(light.params.z, 1e-4));
            let atten = 1.0 / (1.0 + lightDist * lightDist);
            inScatter += light.col.rgb * atten * spotIntensity * phase;
        }

        inScatter *= extinction * froxel.phase.y;
    }

    textureStore(
        volume,
        vec3u(gid),
        vec4f(inScatter, clamp(extinction, 0.0, 1.0)),
    );
}
