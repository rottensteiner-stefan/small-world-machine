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

struct FroxelUniforms {
    invView: mat4x4f,        // camera rotation inverse (world from view), for cell direction
    params: vec4f,           // [density, height, heightFalloff, maxWorldDistance]
    phase: vec4f,            // [asymmetry g, intensity, jitter, pad]
    nearFar: vec4f,          // [near, far, sliceCount, pad]
}

@group(4) @binding(0) var<uniform> froxel: FroxelUniforms;
@group(4) @binding(1) var volume: texture_storage_3d<rgba16float, write>;

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
// centre depth. Uses the camera rotation only -- the projection cancels through projScale.
fn cellWorldPos(cell: vec3f, dims: vec3f, camPos: vec3f) -> vec3f {
    let ndcX = (cell.x + 0.5) / dims.x * 2.0 - 1.0;
    // Flip Y: cluster grid Y grows downward (screen space), world Y grows upward.
    let ndcY = 1.0 - ((cell.y + 0.5) / dims.y * 2.0);
    let viewZ = sliceCenterDepth(cell.z, froxel.nearFar.x, froxel.nearFar.y, froxel.nearFar.z);
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
