// Unprojects one pixel's opaque depth into the decal's unit box. xyz = box position, w = raw depth.
fn decalUnproject(px: vec2i, clipToBox: mat4x4f) -> vec4f {
    let depth = textureLoad(u_opaqueDepthMap, px, 0);
    // The matrix is built from the GL (non zero-to-one) view-projection, hence the [-1, 1] depth remap.
    let ndc = vec4f(
        (f32(px.x) + 0.5) / global.resolution.x * 2.0 - 1.0,
        1.0 - (f32(px.y) + 0.5) / global.resolution.y * 2.0,
        depth * 2.0 - 1.0,
        1.0
    );
    let h = clipToBox * ndc;
    return vec4f(h.xyz / h.w, depth);
}

// Picks the neighbour (forward or backward) whose depth is closer to the centre's, so a
// finite difference never reaches across a silhouette; sky neighbours count as infinitely far.
fn decalNeighbourDelta(centre: vec4f, forward: vec4f, backward: vec4f) -> vec3f {
    let forwardGap = select(abs(forward.w - centre.w), 1.0e9, forward.w >= 1.0);
    let backwardGap = select(abs(backward.w - centre.w), 1.0e9, backward.w >= 1.0);
    return select(centre.xyz - backward.xyz, forward.xyz - centre.xyz, forwardGap <= backwardGap);
}

@diagnostic(off, derivative_uniformity)
@fragment fn fs(frag: Out) -> @location(0) vec4f {
    var i = frag;

    let clipToBox = mat4x4f(obj.matParam0, obj.matParam1, obj.matParam2, obj.matParam3);
    let dims = vec2i(textureDimensions(u_opaqueDepthMap));
    let last = dims - vec2i(1, 1);
    let px = vec2i(frag.pos.xy);
    let centre = decalUnproject(px, clipToBox);
    let boxPos = centre.xyz;
    let inside = centre.w < 1.0 && all(abs(boxPos) <= vec3f(0.5));
    if (!inside) {
        discard;
    }

    // Three taps per axis give the surface's tangent vectors and the UV derivatives without
    // reading across depth discontinuities (plain dpdx/dpdy would, and so would implicit mips).
    let stepX = decalNeighbourDelta(
        centre,
        decalUnproject(min(px + vec2i(1, 0), last), clipToBox),
        decalUnproject(max(px - vec2i(1, 0), vec2i(0, 0)), clipToBox)
    );
    let stepY = decalNeighbourDelta(
        centre,
        decalUnproject(min(px + vec2i(0, 1), last), clipToBox),
        decalUnproject(max(px - vec2i(0, 1), vec2i(0, 0)), clipToBox)
    );
    g_uvGradX = stepX.xz * obj.matParam4.w; // w = exp2(mipBias)
    g_uvGradY = stepY.xz * obj.matParam4.w;

    let surfaceWorld = (obj.model * vec4f(boxPos, 1.0)).xyz;
    let viewDir = normalize(global.viewPos.xyz - surfaceWorld);
    let worldX = (obj.model * vec4f(stepX, 0.0)).xyz;
    let worldY = (obj.model * vec4f(stepY, 0.0)).xyz;
    let tangentCross = cross(worldX, worldY);
    // Relative test (sin^2 of the angle between the edges): see AO.frag.wgsl for why not absolute.
    let edgeScaleSq = dot(worldX, worldX) * dot(worldY, worldY);
    let validDerived = edgeScaleSq > 0.0 && dot(tangentCross, tangentCross) > 0.0001 * edgeScaleSq;
    var baseNormal = select(viewDir, normalize(tangentCross), validDerived);
    if (dot(baseNormal, viewDir) < 0.0) {
        baseNormal = -baseNormal;
    }

    // The normal buffer, when present, wins: it includes the receiver's normal map.
    if (obj.matParam5.y > 0.5) {
        let encoded = textureLoad(u_normalBufferMap, px, 0).xy;
        if (abs(encoded.x) <= 1.0 && abs(encoded.y) <= 1.0) {
            baseNormal = octDecode(encoded);
        }
    }

    let decalUp = normalize(obj.model[1].xyz);
    let angleFade = smoothstep(obj.matParam4.z, obj.matParam4.y, dot(baseNormal, decalUp));
    let toEdge = vec3f(0.5) - abs(boxPos);
    let edgeFade = clamp(min(toEdge.x, min(toEdge.y, toEdge.z)) / max(obj.matParam4.x, 0.0001), 0.0, 1.0);

    let tangentSeed = normalize(obj.model[0].xyz);
    let tangent = normalize(tangentSeed - baseNormal * dot(tangentSeed, baseNormal));
    i.wp = surfaceWorld;
    i.n = baseNormal;
    i.t = tangent;
    i.b = cross(baseNormal, tangent);
    i.uv = boxPos.xz + vec2f(0.5);

    let diffuseTex = textureSampleGrad(u_diffuseMap, s, i.uv, g_uvGradX, g_uvGradY);
    let albedo = sRGBToLinear(diffuseTex.rgb) * sRGBToLinear(obj.color.rgb);
    let metallic = obj.metallic;
    let roughness = clamp(obj.roughness, 0.05, 1.0);
    let ao = 1.0;

    // Unlit decals keep the flat albedo; lit ones run the clustered PBR chunk inside this block
    // (its locals, including `color`, stay scoped to it).
    var shaded = albedo;
    g_shadingNormal = baseNormal;
    if (!USE_DECAL_UNLIT) {
        [WGSL_PBR_LIGHTING]
        shaded = color;
    }

    var color = shaded;
    color *= global.exposure;
    if (global.gamma != 1.0) {
        color = color / (color + vec3f(1.0)); // Reinhard
    }
    color = linearToSRGB(color);

    [WGSL_FOG_CALC]

    let alpha = diffuseTex.a * obj.color.a * angleFade * edgeFade;
    if (alpha < 0.002) {
        discard;
    }
    return vec4f(color, alpha);
}
