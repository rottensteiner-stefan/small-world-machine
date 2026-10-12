@diagnostic(off, derivative_uniformity)
@fragment fn fs(frag: Out) -> @location(0) vec4f {
    var i = frag;

    // Unproject this pixel's opaque depth into the decal's unit box. The matrix is built from the
    // GL (non zero-to-one) view-projection, hence the [-1, 1] depth remap.
    let px = vec2i(frag.pos.xy);
    let depth = textureLoad(u_opaqueDepthMap, px, 0);
    let ndc = vec4f(
        frag.pos.x / global.resolution.x * 2.0 - 1.0,
        1.0 - frag.pos.y / global.resolution.y * 2.0,
        depth * 2.0 - 1.0,
        1.0
    );
    let clipToBox = mat4x4f(obj.matParam0, obj.matParam1, obj.matParam2, obj.matParam3);
    let boxPos4 = clipToBox * ndc;
    let boxPos = boxPos4.xyz / boxPos4.w;
    let inside = depth < 1.0 && all(abs(boxPos) <= vec3f(0.5));
    if (!inside) {
        discard;
    }
    let surfaceWorld = (obj.model * vec4f(boxPos, 1.0)).xyz;

    // Base normal beneath the decal: the normal buffer when present, else the depth-derived one.
    // Derivatives stay in uniform control flow: no early exit before the lighting chunk.
    let viewDir = normalize(global.viewPos.xyz - surfaceWorld);
    var derivedNormal = normalize(cross(dpdx(surfaceWorld), dpdy(surfaceWorld)));
    if (dot(derivedNormal, viewDir) < 0.0) {
        derivedNormal = -derivedNormal;
    }
    var baseNormal = derivedNormal;
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

    let boxClamped = clamp(boxPos, vec3f(-0.5), vec3f(0.5));
    let tangentSeed = normalize(obj.model[0].xyz);
    let tangent = normalize(tangentSeed - baseNormal * dot(tangentSeed, baseNormal));
    i.wp = surfaceWorld;
    i.n = baseNormal;
    i.t = tangent;
    i.b = cross(baseNormal, tangent);
    i.uv = boxClamped.xz + vec2f(0.5);

    let diffuseTex = textureSampleLevel(u_diffuseMap, s, i.uv, 0.0);
    let albedo = sRGBToLinear(diffuseTex.rgb) * sRGBToLinear(obj.color.rgb);
    let metallic = obj.metallic;
    let roughness = clamp(obj.roughness, 0.05, 1.0);
    let ao = 1.0;
    [WGSL_PBR_LIGHTING]

    color *= global.exposure;
    if (global.gamma != 1.0) {
        color = color / (color + vec3f(1.0)); // Reinhard
    }
    color = linearToSRGB(color);

    [WGSL_FOG_CALC]

    let alpha = diffuseTex.a * obj.color.a * angleFade * edgeFade;
    if (!inside || alpha < 0.002) {
        discard;
    }
    return vec4f(color, alpha);
}
