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
    o.wp = worldPos.xyz;
    o.pos = view.vp * worldPos;
    let uvScaled = uv * obj.texRepeat;
    var uvCos = 1.0;
    var uvSin = 0.0;
    if (obj.texRotation != 0.0) {
        uvCos = cos(obj.texRotation);
        uvSin = sin(obj.texRotation);
    }
    o.uv = vec2f(uvCos * uvScaled.x - uvSin * uvScaled.y, uvSin * uvScaled.x + uvCos * uvScaled.y) + obj.texOffset;
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
        // Fallback handedness mirrors web_gl2/web_gl1 (`cross(N, up)`, NOT `cross(up, N)` --
        // the reversed order mirrored the tangent X axis for tangent-less meshes, G03).
        let up = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(o.n.y) > 0.999);
        o.t = normalize(cross(o.n, up));
    } else {
        o.t = normalize(worldT);
    }
    // Gram-Schmidt orthogonalization, unconditional like the GLSL base vertex stages
    // (base_vertex_main.vert.glsl): under non-uniform scale/shear the transformed tangent is not
    // orthogonal to N and would skew the TBN; the fallback cross(N, up) is already orthogonal, so
    // this is an identity there. Tangent frames must stay right-handed orthonormal (G03).
    o.t = normalize(o.t - dot(o.t, o.n) * o.n);
    
    let worldB = cross(o.n, o.t) * tangentSign;
    if (dot(worldB, worldB) < 1e-20) {
        let up = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(o.n.y) > 0.999);
        o.b = normalize(cross(o.n, up));
    } else {
        o.b = normalize(worldB);
    }

    // UV rotation (KHR_texture_transform: uv' = R(theta) * (uv * repeat) + offset) also turns the tangent frame.
    // The map's +u' axis lies along R^T * e_u = (cos, -sin) in mesh-UV space, so T' = cos*T - sin*B and
    // B' = sin*T + cos*B (B carries the handedness sign; the rotation is proper, so T', B', N stay orthonormal).
    // Without it a rotated normal map would shade with the unrotated tangent direction.
    let uvT = o.t;
    let uvB = o.b;
    o.t = uvCos * uvT - uvSin * uvB;
    o.b = uvSin * uvT + uvCos * uvB;

    return o;
}
