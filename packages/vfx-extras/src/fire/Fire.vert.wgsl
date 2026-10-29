// FireMaterial vertex shader (WebGPU). Derived from
// packages/engine/src/renderers/shaders/source/web_gpu/base.vert.wgsl — keep in sync; the ONLY
// divergence is the world-space lean shear below. The entry point MUST stay `fn vs(...) -> Out`
// ending with returning `o`: the GPU pipeline cache locates instancing by matching that return
// statement and injects `o.texIndex`/`o.instColor`.
@vertex fn vs(
    @location(0) pos: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
    @location(3) tangent: vec4f, // (tx, ty, tz, w), w = ±1 bitangent handedness (MikkTSpace/glTF)
    @location(4) joints: vec4f,
    @location(5) weights: vec4f
) -> Out {
    var o: Out;
    
    var localPos = vec4f(pos, 1.0);
    var localNormal = normal;
    var localTangent = tangent.xyz;
    
    if (obj.isSkinned > 0.5) {
        let bOffset = u32(obj.boneOffset);
        let b0 = boneMatrices[bOffset + u32(joints.x)];
        let b1 = boneMatrices[bOffset + u32(joints.y)];
        let b2 = boneMatrices[bOffset + u32(joints.z)];
        let b3 = boneMatrices[bOffset + u32(joints.w)];
        
        let skinMat = weights.x * b0 + weights.y * b1 + weights.z * b2 + weights.w * b3;
        localPos = skinMat * vec4f(pos, 1.0);
        let skinMat3 = mat3x3f(skinMat[0].xyz, skinMat[1].xyz, skinMat[2].xyz);
        localNormal = skinMat3 * normal;
        localTangent = skinMat3 * tangent.xyz;
    }
    
    let worldPos = obj.model * localPos;
    // Same expression the base main uses for o.uv; computed early as the height fraction for the
    // world-space lean shear. The injection replaces `obj.model` with `modelMat`, so referencing it
    // with the obj prefix keeps instanced draws on this path working.
    let fireUv = uv * obj.texRepeat + obj.texOffset;
    // World-space fire lean shear (2b): displace along the world-space lean axis by the SQUARED
    // height fraction, so the base stays anchored and the tip leans — uniformly across crossed
    // cards (the per-card fragment shear it replaces could not lean a card perpendicular to the wind).
    let shearedWorld = worldPos.xyz + obj.matParam4.xyz * (fireUv.y * fireUv.y);
    o.wp = shearedWorld;
    o.pos = view.vp * vec4f(shearedWorld, 1.0);
    o.uv = fireUv;
    o.original_uv = uv;
    
    // Improved Normal Matrix (handling scaling correctly)
    let m33 = mat3x3f(obj.model[0].xyz, obj.model[1].xyz, obj.model[2].xyz);
    
    // Normalize normals after transformation to world space with robust fallbacks
    let worldN = m33 * localNormal;
    if (dot(localNormal, localNormal) < 0.0001 || dot(worldN, worldN) < 1e-20) {
        o.n = vec3f(0.0, 1.0, 0.0);
    } else {
        o.n = normalize(worldN);
    }
    
    // Bitangent handedness w = ±1, folded into B in the VERTEX stage (fragment/material
    // shaders reconstruct the TBN unmodified). Defaults to +1 when the tangent is zero or
    // absent, so mirrored-UV islands keep their authored/derived sign only.
    let tangentSign = select(tangent.w, 1.0, dot(localTangent, localTangent) < 0.0001);
    
    let worldT = m33 * localTangent;
    if (dot(localTangent, localTangent) < 0.0001 || dot(worldT, worldT) < 1e-20) {
        let up = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(o.n.y) > 0.999);
        o.t = normalize(cross(up, o.n));
    } else {
        o.t = normalize(worldT);
    }
    
    let worldB = cross(o.n, o.t) * tangentSign;
    if (dot(worldB, worldB) < 1e-20) {
        let up = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(o.n.y) > 0.999);
        o.b = normalize(cross(o.n, up));
    } else {
        o.b = normalize(worldB);
    }
    
    return o;
}
