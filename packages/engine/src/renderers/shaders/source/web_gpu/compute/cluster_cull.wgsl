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
// space, so each light's own screen-space (X/Y) and planar view-Z (Z) coverage range is
// computed directly via the same `global.vp` projection metric the fragment shader and froxel
// passes use for their own cluster lookup -- no separate view matrix needed, and no
// world/view-space mismatch to get wrong.
fn zSliceRange(viewZ: f32, radius: f32) -> vec2f {
    let near = global.cameraNearFar.x;
    let far = global.cameraNearFar.y;
    let numSlices = global.clusterDims.z;
    let logRatio = max(log(far / near), 1e-6);
    let dMin = clamp(viewZ - radius, near, far);
    let dMax = clamp(viewZ + radius, near, far);
    let sliceMin = floor(log(dMin / near) * numSlices / logRatio);
    let sliceMax = floor(log(dMax / near) * numSlices / logRatio);
    return clamp(vec2f(sliceMin, sliceMax), vec2f(0.0), vec2f(numSlices - 1.0));
}

fn computeViewZ(worldPos: vec3f, clipW: f32) -> f32 {
    let r3 = vec3f(global.vp[0][3], global.vp[1][3], global.vp[2][3]);
    if (dot(r3, r3) > 1e-8) {
        return clipW;
    }
    let r2 = -vec3f(global.vp[0][2], global.vp[1][2], global.vp[2][2]);
    let r2Len = length(r2);
    if (r2Len > 1e-8) {
        return dot(worldPos - global.viewPos.xyz, r2 / r2Len);
    }
    return clipW;
}

// Returns (cellMinX, cellMaxX, cellMinY, cellMaxY, zMinSlice, zMaxSlice) for a light's bounding
// sphere, fully covering the grid on an axis if the light straddles the camera plane (viewZ <= radius
// while overlapping [near, far]), and returning an empty range (minX > maxX) when off-screen.
fn lightCoverage(worldPos: vec3f, radius: f32, dims: vec3u) -> array<vec2f, 3> {
    let clip = global.vp * vec4f(worldPos, 1.0);
    let viewZ = computeViewZ(worldPos, clip.w);
    let near = global.cameraNearFar.x;
    let far = global.cameraNearFar.y;
    let zNear = viewZ - radius;
    let zFar = viewZ + radius;

    if (zFar < near || zNear > far) {
        return array<vec2f, 3>(vec2f(1.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 0.0));
    }

    var rangeX = vec2f(0.0, f32(dims.x) - 1.0);
    var rangeY = vec2f(0.0, f32(dims.y) - 1.0);

    let isOrtho = abs(global.vp[0][3]) < 1e-6 && abs(global.vp[1][3]) < 1e-6 && abs(global.vp[2][3]) < 1e-6;
    if (isOrtho) {
        let radiusNdcX = radius * max(global.projScale.x, 1e-6);
        let radiusNdcY = radius * max(global.projScale.y, 1e-6);
        let ndcXMin = clip.x - radiusNdcX;
        let ndcXMax = clip.x + radiusNdcX;
        let ndcYMin = clip.y - radiusNdcY;
        let ndcYMax = clip.y + radiusNdcY;

        let pxX0 = (ndcXMin * 0.5 + 0.5) * global.resolution.x;
        let pxX1 = (ndcXMax * 0.5 + 0.5) * global.resolution.x;
        let pxY0 = (0.5 - ndcYMax * 0.5) * global.resolution.y;
        let pxY1 = (0.5 - ndcYMin * 0.5) * global.resolution.y;

        let rawMinX = floor(pxX0 / global.tileSizePx.x);
        let rawMaxX = floor(pxX1 / global.tileSizePx.x);
        let rawMinY = floor(pxY0 / global.tileSizePx.y);
        let rawMaxY = floor(pxY1 / global.tileSizePx.y);

        if (rawMaxX < 0.0 || rawMinX >= f32(dims.x) || rawMaxY < 0.0 || rawMinY >= f32(dims.y)) {
            return array<vec2f, 3>(vec2f(1.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 0.0));
        }

        rangeX = clamp(vec2f(rawMinX, rawMaxX), vec2f(0.0), vec2f(f32(dims.x) - 1.0));
        rangeY = clamp(vec2f(rawMinY, rawMaxY), vec2f(0.0), vec2f(f32(dims.y) - 1.0));
    } else if (clip.w > 0.0001 && viewZ > radius && global.projScale.x > 0.0 && global.projScale.y > 0.0) {
        let tanX = (clip.x / clip.w) / global.projScale.x;
        let tanY = (clip.y / clip.w) / global.projScale.y;
        let vz = viewZ;
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

        let rawMinX = floor(pxX0 / global.tileSizePx.x);
        let rawMaxX = floor(pxX1 / global.tileSizePx.x);
        let rawMinY = floor(pxY0 / global.tileSizePx.y);
        let rawMaxY = floor(pxY1 / global.tileSizePx.y);

        if (rawMaxX < 0.0 || rawMinX >= f32(dims.x) || rawMaxY < 0.0 || rawMinY >= f32(dims.y)) {
            return array<vec2f, 3>(vec2f(1.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 0.0));
        }

        rangeX = clamp(vec2f(rawMinX, rawMaxX), vec2f(0.0), vec2f(f32(dims.x) - 1.0));
        rangeY = clamp(vec2f(rawMinY, rawMaxY), vec2f(0.0), vec2f(f32(dims.y) - 1.0));
    }

    let rangeZ = zSliceRange(viewZ, radius);
    return array<vec2f, 3>(rangeX, rangeY, rangeZ);
}

struct LightCoverage {
    rangeX: vec2f,
    rangeY: vec2f,
    rangeZ: vec2f,
}

var<workgroup> s_pointCoverage: array<LightCoverage, 64>;
var<workgroup> s_spotCoverage: array<LightCoverage, 64>;

@compute @workgroup_size(4, 4, 4)
fn cullLights(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lid: u32) {
    let dims = vec3u(u32(global.clusterDims.x), u32(global.clusterDims.y), u32(global.clusterDims.z));
    let inBounds = gid.x < dims.x && gid.y < dims.y && gid.z < dims.z;

    let cellIndex = gid.x + dims.x * (gid.y + dims.y * gid.z);
    let maxPerCluster = u32(global.clusterDims.w);
    let pointOffset = cellIndex * maxPerCluster;
    let spotOffset = cellIndex * maxPerCluster;
    let cellF = vec3f(f32(gid.x), f32(gid.y), f32(gid.z));

    var pointCount = 0u;
    let numPointLights = u32(global.numPointLights);
    for (var batch = 0u; batch < numPointLights; batch += 64u) {
        let lightIdx = batch + lid;
        if (lightIdx < numPointLights) {
            let cov = lightCoverage(pLights[lightIdx].pos.xyz, max(pLights[lightIdx].pos.w, 0.001), dims);
            s_pointCoverage[lid] = LightCoverage(cov[0], cov[1], cov[2]);
        }
        workgroupBarrier();

        if (inBounds) {
            let countInBatch = min(64u, numPointLights - batch);
            for (var i = 0u; i < countInBatch; i++) {
                if (pointCount >= maxPerCluster) {
                    break;
                }
                let cov = s_pointCoverage[i];
                if (cellF.x >= cov.rangeX.x && cellF.x <= cov.rangeX.y &&
                    cellF.y >= cov.rangeY.x && cellF.y <= cov.rangeY.y &&
                    cellF.z >= cov.rangeZ.x && cellF.z <= cov.rangeZ.y) {
                    pointClusterIndices[pointOffset + pointCount] = batch + i;
                    pointCount++;
                }
            }
        }
        workgroupBarrier();
    }
    if (inBounds) {
        pointClusterGrid[cellIndex] = vec2u(pointOffset, pointCount);
    }

    var spotCount = 0u;
    let numSpotLights = u32(global.numSpotLights);
    for (var batch = 0u; batch < numSpotLights; batch += 64u) {
        let lightIdx = batch + lid;
        if (lightIdx < numSpotLights) {
            let cov = lightCoverage(sLights[lightIdx].pos.xyz, max(sLights[lightIdx].params.z, 0.001), dims);
            s_spotCoverage[lid] = LightCoverage(cov[0], cov[1], cov[2]);
        }
        workgroupBarrier();

        if (inBounds) {
            let countInBatch = min(64u, numSpotLights - batch);
            for (var i = 0u; i < countInBatch; i++) {
                if (spotCount >= maxPerCluster) {
                    break;
                }
                let cov = s_spotCoverage[i];
                if (cellF.x >= cov.rangeX.x && cellF.x <= cov.rangeX.y &&
                    cellF.y >= cov.rangeY.x && cellF.y <= cov.rangeY.y &&
                    cellF.z >= cov.rangeZ.x && cellF.z <= cov.rangeZ.y) {
                    spotClusterIndices[spotOffset + spotCount] = batch + i;
                    spotCount++;
                }
            }
        }
        workgroupBarrier();
    }
    if (inBounds) {
        spotClusterGrid[cellIndex] = vec2u(spotOffset, spotCount);
    }
}
