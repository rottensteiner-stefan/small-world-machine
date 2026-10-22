fn sampleDirShadow(worldPos: vec3f, N: vec3f) -> f32 {
    if (global.dirShadowInfo.z < 0.5 || global.dirShadowInfo.w < 1.0) {
        return 1.0;
    }

    let numCascades = u32(global.dirShadowInfo.w);
    var cascadeIndex = max(numCascades, 1u) - 1u;
    let viewDist = length(global.viewPos.xyz - worldPos);
    for (var c: u32 = 0u; c < numCascades; c++) {
        if (viewDist < global.cascadeSplits[c]) {
            cascadeIndex = c;
            break;
        }
    }

    let nDotL = max(dot(N, normalize(global.dirLightDir.xyz)), 0.0);
    let samplePos = worldPos + N * global.dirShadowInfo.y * (1.0 - nDotL);
    let shadowPos = global.cascadeMatrices[cascadeIndex] * vec4f(samplePos, 1.0);
    return getShadowDirBlend(u_dirShadowMap, shadowSampler, shadowPos, cascadeIndex, global.dirShadowInfo.x);
}
