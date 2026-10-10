// Clustered/tiled forward+ light culling compute shader.
// See docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md for the design rationale
// (fixed-capacity-per-cluster, no atomics; point/spot lights culled as bounding spheres).
//
// Expects `structs.wgsl` (GlobalUniforms, PointLight, SpotLight, and the pLights/sLights/
// pointClusterGrid/pointClusterIndices/spotClusterGrid/spotClusterIndices bindings) and
// `screen_footprint.wgsl` (`worldRadiusToNdcRadius()`, shared with hzb_visibility_test.wgsl's
// near-identical problem) to already be present in the assembled shader module -- this file
// only adds the compute entry point.
//
// Per-light approach (not a view-space AABB): light positions in pLights/sLights are WORLD
// space, so each light's own screen-space (X/Y) and radial-distance (Z) coverage range is
// computed directly via the same `global.vp` projection and `length(viewPos - lightPos)` metric
// the fragment shader uses for its own cluster lookup -- no separate view matrix needed, and no
// world/view-space mismatch to get wrong. `projScale` over-estimates screen radius slightly
fn zSliceRange(viewDist: f32, radius: f32) -> vec2f {
    let near = global.cameraNearFar.x;
    let far = global.cameraNearFar.y;
    let numSlices = global.clusterDims.z;
    let logRatio = log(far / near);
    let dMin = clamp(viewDist - radius, near, far);
    let dMax = clamp(viewDist + radius, near, far);
    let sliceMin = floor(log(dMin / near) * numSlices / logRatio);
    let sliceMax = floor(log(dMax / near) * numSlices / logRatio);
    return clamp(vec2f(sliceMin, sliceMax), vec2f(0.0), vec2f(numSlices - 1.0));
}

// Returns (cellMinX, cellMaxX, cellMinY, cellMaxY, zMinSlice, zMaxSlice) for a light's bounding
// sphere, fully covering the grid on an axis if the light intersects or lies behind the camera plane
// (clip.w <= radius makes the perspective NDC projection singular/unbounded).
fn lightCoverage(worldPos: vec3f, radius: f32, dims: vec3u) -> array<vec2f, 3> {
    let viewDist = max(length(worldPos - global.viewPos.xyz), 0.0001);
    let clip = global.vp * vec4f(worldPos, 1.0);

    var rangeX = vec2f(0.0, f32(dims.x) - 1.0);
    var rangeY = vec2f(0.0, f32(dims.y) - 1.0);

    // If the sphere is strictly in front of the camera plane (vz > radius),
    // compute exact analytical screen-space tangent bounds:
    if (clip.w > 0.0001 && viewDist > radius && global.projScale.x > 0.0 && global.projScale.y > 0.0) {
        let tanX = (clip.x / clip.w) / global.projScale.x;
        let tanY = (clip.y / clip.w) / global.projScale.y;
        let vz = viewDist / sqrt(1.0 + tanX * tanX + tanY * tanY);

        if (vz > radius) {
            let vx = tanX * vz;
            let vy = tanY * vz;
            let denom = vz * vz - radius * radius;

            let radX = radius * sqrt(max(vx * vx + vz * vz - radius * radius, 0.0));
            let mXMin = (vx * vz - radX) / denom;
            let mXMax = (vx * vz + radX) / denom;
            let ndcXMin = mXMin * global.projScale.x;
            let ndcXMax = mXMax * global.projScale.x;

            let radY = radius * sqrt(max(vy * vy + vz * vz - radius * radius, 0.0));
            let mYMin = (vy * vz - radY) / denom;
            let mYMax = (vy * vz + radY) / denom;
            let ndcYMin = mYMin * global.projScale.y;
            let ndcYMax = mYMax * global.projScale.y;

            let pxX0 = (ndcXMin * 0.5 + 0.5) * global.resolution.x;
            let pxX1 = (ndcXMax * 0.5 + 0.5) * global.resolution.x;
            // In WebGPU framebuffer coordinates, origin (0,0) is top-left, Y increases downward.
            let pxY0 = (0.5 - ndcYMax * 0.5) * global.resolution.y;
            let pxY1 = (0.5 - ndcYMin * 0.5) * global.resolution.y;

            rangeX = clamp(vec2f(floor(pxX0 / global.tileSizePx.x), floor(pxX1 / global.tileSizePx.x)), vec2f(0.0), vec2f(f32(dims.x) - 1.0));
            rangeY = clamp(vec2f(floor(pxY0 / global.tileSizePx.y), floor(pxY1 / global.tileSizePx.y)), vec2f(0.0), vec2f(f32(dims.y) - 1.0));
        }
    }

    let rangeZ = zSliceRange(viewDist, radius);
    return array<vec2f, 3>(rangeX, rangeY, rangeZ);
}

@compute @workgroup_size(4, 4, 4)
fn cullLights(@builtin(global_invocation_id) gid: vec3u) {
    let dims = vec3u(u32(global.clusterDims.x), u32(global.clusterDims.y), u32(global.clusterDims.z));
    if (gid.x >= dims.x || gid.y >= dims.y || gid.z >= dims.z) {
        return;
    }

    let cellIndex = gid.x + dims.x * (gid.y + dims.y * gid.z);
    let maxPerCluster = u32(global.clusterDims.w);
    let pointOffset = cellIndex * maxPerCluster;
    let spotOffset = cellIndex * maxPerCluster;
    let cellF = vec3f(f32(gid.x), f32(gid.y), f32(gid.z));

    var pointCount = 0u;
    let numPointLights = u32(global.numPointLights);
    for (var i = 0u; i < numPointLights; i++) {
        if (pointCount >= maxPerCluster) {
            break;
        }
        let coverage = lightCoverage(pLights[i].pos.xyz, max(pLights[i].pos.w, 0.001), dims);
        if (cellF.x >= coverage[0].x && cellF.x <= coverage[0].y &&
            cellF.y >= coverage[1].x && cellF.y <= coverage[1].y &&
            cellF.z >= coverage[2].x && cellF.z <= coverage[2].y) {
            pointClusterIndices[pointOffset + pointCount] = i;
            pointCount++;
        }
    }
    pointClusterGrid[cellIndex] = vec2u(pointOffset, pointCount);

    var spotCount = 0u;
    let numSpotLights = u32(global.numSpotLights);
    for (var i = 0u; i < numSpotLights; i++) {
        if (spotCount >= maxPerCluster) {
            break;
        }
        let coverage = lightCoverage(sLights[i].pos.xyz, max(sLights[i].params.z, 0.001), dims);
        if (cellF.x >= coverage[0].x && cellF.x <= coverage[0].y &&
            cellF.y >= coverage[1].x && cellF.y <= coverage[1].y &&
            cellF.z >= coverage[2].x && cellF.z <= coverage[2].y) {
            spotClusterIndices[spotOffset + spotCount] = i;
            spotCount++;
        }
    }
    spotClusterGrid[cellIndex] = vec2u(spotOffset, spotCount);
}
