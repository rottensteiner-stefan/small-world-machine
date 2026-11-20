// Shared screen-space footprint math. Requires `structs.wgsl` (for `global.projScale`) prepended
// before this chunk.

// Converts a world-space radius at a given view distance into an NDC-space radius, via the
// projection matrix's diagonal scale terms (`global.projScale`). Conservative on-axis tangent
// radius `r / sqrt(max(viewDist^2 - r^2, 1e-4)) * projScale`.
fn worldRadiusToNdcRadius(radius: f32, viewDist: f32) -> vec2f {
    let safeZ = sqrt(max(viewDist * viewDist - radius * radius, 1e-4));
    return vec2f(radius / safeZ) * global.projScale;
}

// Conservative 2D perspective-projected bounding box of a sphere in NDC space `[-1, 1]^2`
// (Mara & McGuire, "2D Polyhedral Bounds of a Clipped, Perspective-Projected 3D Sphere", JCGT 2013).
// Reconstructs view-space center `(x_c, y_c)` from `ndcCenter * viewZ / projScale` and projects
// the exact 2D tangent rays `(a, z)` in the `(X, Z)` and `(Y, Z)` planes onto `z = 1`.
// Returns `vec4f(minNdcX, minNdcY, maxNdcX, maxNdcY)`. Caller must ensure `viewZ > radius`.
fn projectSphereBoundsNdc(ndcCenter: vec2f, viewZ: f32, radius: f32) -> vec4f {
    let safeProj = max(global.projScale, vec2f(1e-6));
    let cXY = (ndcCenter / safeProj) * viewZ;
    let z2 = viewZ * viewZ;
    let r2 = radius * radius;
    let fallbackHalf = worldRadiusToNdcRadius(radius, viewZ);

    let d2X = cXY.x * cXY.x + z2;
    let t2X = max(d2X - r2, 1e-6);
    let tX = sqrt(t2X);
    let denomMinX = viewZ * tX + radius * cXY.x;
    let denomMaxX = viewZ * tX - radius * cXY.x;
    var minX = ndcCenter.x - fallbackHalf.x;
    var maxX = ndcCenter.x + fallbackHalf.x;
    if (denomMinX > 1e-5 && denomMaxX > 1e-5) {
        let x0 = ((cXY.x * tX - radius * viewZ) / denomMinX) * safeProj.x;
        let x1 = ((cXY.x * tX + radius * viewZ) / denomMaxX) * safeProj.x;
        minX = min(minX, min(x0, x1));
        maxX = max(maxX, max(x0, x1));
    } else {
        minX = -1.0;
        maxX = 1.0;
    }

    let d2Y = cXY.y * cXY.y + z2;
    let t2Y = max(d2Y - r2, 1e-6);
    let tY = sqrt(t2Y);
    let denomMinY = viewZ * tY + radius * cXY.y;
    let denomMaxY = viewZ * tY - radius * cXY.y;
    var minY = ndcCenter.y - fallbackHalf.y;
    var maxY = ndcCenter.y + fallbackHalf.y;
    if (denomMinY > 1e-5 && denomMaxY > 1e-5) {
        let y0 = ((cXY.y * tY - radius * viewZ) / denomMinY) * safeProj.y;
        let y1 = ((cXY.y * tY + radius * viewZ) / denomMaxY) * safeProj.y;
        minY = min(minY, min(y0, y1));
        maxY = max(maxY, max(y0, y1));
    } else {
        minY = -1.0;
        maxY = 1.0;
    }

    return vec4f(minX, minY, maxX, maxY);
}

