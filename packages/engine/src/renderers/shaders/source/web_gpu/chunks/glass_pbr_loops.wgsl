    // Directional Light
    {
        let L = normalize(global.dirLightDir.xyz);
        let H = normalize(V + L);
        let dotNL = max(dot(N, L), 0.0);
        let dotNH = max(dot(N, H), 0.0);
        let dotVH = max(dot(V, H), 0.0);
        // Same cascade selection + normal-offset PCSS as lighting_pbr.wgsl: glass is lit by the sun
        // only where the scene is not in shadow.
        var shadow: f32 = 1.0;
        if (global.dirShadowInfo.z > 0.5) {
            let numCascades = u32(global.dirShadowInfo.w);
            var cascadeIndex = max(numCascades, 1u) - 1u;
            let viewDist = length(global.viewPos.xyz - i.wp);
            for (var c: u32 = 0u; c < numCascades; c++) {
                if (viewDist < global.cascadeSplits[c]) {
                    cascadeIndex = c;
                    break;
                }
            }
            var blendToNext: f32 = 0.0;
            if (cascadeIndex + 1u < numCascades) {
                let splitFar = global.cascadeSplits[cascadeIndex];
                let blendBand = max(splitFar * 0.1, 0.0001);
                blendToNext = 1.0 - clamp((splitFar - viewDist) / blendBand, 0.0, 1.0);
            }
            let dirShadowSamplePos = i.wp + N * global.dirShadowInfo.y * (1.0 - dotNL);
            let shadowPos = global.cascadeMatrices[cascadeIndex] * vec4f(dirShadowSamplePos, 1.0);
            let shadowA = getShadowDirMain(u_dirShadowMap, shadowSampler, shadowPos, cascadeIndex, global.dirShadowInfo.x);
            var shadowB = shadowA;
            if (blendToNext > 0.0) {
                let nextCascade = cascadeIndex + 1u;
                let shadowPosB = global.cascadeMatrices[nextCascade] * vec4f(dirShadowSamplePos, 1.0);
                shadowB = getShadowDirBlend(u_dirShadowMap, shadowSampler, shadowPosB, nextCascade, global.dirShadowInfo.x);
            }
            shadow = mix(shadowA, shadowB, blendToNext);
        }
        let radiance = global.dirLightColor.xyz * shadow;

        let D = D_GGX(dotNH, roughness);
        let G = G_SchlickGGX(dotNL, dotNV, roughness);
        let F = F_Schlick(dotVH, F0);

        let kS = F;
        let kD = (vec3f(1.0) - kS) * (1.0 - metallic);
        let specular = (D * G * F) / (4.0 * dotNV * dotNL + 0.0001);
        Lo += (kD * tintColor / 3.14159265359 + specular) * radiance * dotNL;
    }

    // Point Lights
    // Clustered light lookup (same cell math as lighting_pbr.wgsl / ADR 0007) instead of
    // iterating every light for every glass fragment.
    let clusterDimsU = vec3u(u32(global.clusterDims.x), u32(global.clusterDims.y), u32(global.clusterDims.z));
    let clusterCellX = min(u32(i.pos.x / global.tileSizePx.x), clusterDimsU.x - 1u);
    let clusterCellY = min(u32(i.pos.y / global.tileSizePx.y), clusterDimsU.y - 1u);
    let clusterViewDist = clamp(length(global.viewPos.xyz - i.wp), global.cameraNearFar.x, global.cameraNearFar.y);
    let clusterLogRatio = log(global.cameraNearFar.y / global.cameraNearFar.x);
    let clusterSliceF = floor(log(clusterViewDist / global.cameraNearFar.x) * f32(clusterDimsU.z) / clusterLogRatio);
    let clusterCellZ = min(u32(max(clusterSliceF, 0.0)), clusterDimsU.z - 1u);
    let clusterCellIndex = clusterCellX + clusterDimsU.x * (clusterCellY + clusterDimsU.y * clusterCellZ);

    let pointCluster = pointClusterGrid[clusterCellIndex];
    for(var pk=0u; pk<pointCluster.y; pk++) {
        let j = pointClusterIndices[pointCluster.x + pk];
        let lightVec = pLights[j].pos.xyz - i.wp;
        let dist = max(length(lightVec), 0.0001);
        let L = lightVec / dist;
        let H = normalize(V + L);
        // Same range window as lighting_pbr.wgsl so glass and surfaces agree on light reach.
        let pRange = max(pLights[j].pos.w, 0.001);
        let pRatio = dist / pRange;
        let pRatio4 = pRatio * pRatio * pRatio * pRatio;
        let pWindow = clamp(1.0 - pRatio4, 0.0, 1.0);
        var attenuation = clamp(1.0 - dist / pRange, 0.0, 1.0);
        if (pLights[j].col.w > 0.0) {
            attenuation = (1.0 / max(dist * dist, 0.01)) * pWindow * pWindow;
        }
        let radiance = pLights[j].col.xyz * attenuation;

        let dotNL = max(dot(N, L), 0.0);
        let dotNH = max(dot(N, H), 0.0);
        let dotVH = max(dot(V, H), 0.0);

        let D = D_GGX(dotNH, roughness);
        let G = G_SchlickGGX(dotNL, dotNV, roughness);
        let F = F_Schlick(dotVH, F0);

        let kS = F;
        let kD = (vec3f(1.0) - kS) * (1.0 - metallic);
        let specular = (D * G * F) / (4.0 * dotNV * dotNL + 0.0001);
        Lo += (kD * tintColor / 3.14159265359 + specular) * radiance * dotNL;
    }

    // Spot Lights
    let spotCluster = spotClusterGrid[clusterCellIndex];
    for(var sk=0u; sk<spotCluster.y; sk++) {
        let k = spotClusterIndices[spotCluster.x + sk];
        let lightVec = sLights[k].pos.xyz - i.wp;
        let dist = max(length(lightVec), 0.0001);
        let L = lightVec / dist;
        let H = normalize(V + L);
        
        let spotDir = normalize(sLights[k].dir.xyz);
        let cosOuter = sLights[k].params.x;
        let cosInner = sLights[k].params.y;
        let maxDist = sLights[k].params.z;
        let decay = sLights[k].params.w;
        let theta = dot(L, -spotDir);
        let epsilon = max(cosInner - cosOuter, 0.0001);
        let spotIntensity = clamp((theta - cosOuter) / epsilon, 0.0, 1.0);
        let dotNL_spot = max(dot(N, L), 0.0);
        let distanceAttenuation = select(1.0 / (dist * dist + 0.0001), pow(clamp(1.0 - dist / maxDist, 0.0, 1.0), decay), maxDist > 0.0);
        var spotShadow: f32 = 1.0;
        if (k < 4u && global.spotShadowInfo[k].z > 0.5) {
            let spotShadowPos = global.spotShadowMatrices[k] * vec4f(i.wp + N * global.spotShadowInfo[k].y * (1.0 - dotNL_spot), 1.0);
            spotShadow = getShadowPCSS(u_spotShadowMap, shadowSampler, spotShadowPos, k, global.spotShadowInfo[k].x);
        }
        let radiance = sLights[k].col.xyz * distanceAttenuation * spotIntensity * spotShadow;

        let dotNL = max(dot(N, L), 0.0);
        let dotNH = max(dot(N, H), 0.0);
        let dotVH = max(dot(V, H), 0.0);

        let D = D_GGX(dotNH, roughness);
        let G = G_SchlickGGX(dotNL, dotNV, roughness);
        let F = F_Schlick(dotVH, F0);

        let kS = F;
        let kD = (vec3f(1.0) - kS) * (1.0 - metallic);
        let specular = (D * G * F) / (4.0 * dotNV * dotNL + 0.0001);
        Lo += (kD * tintColor / 3.14159265359 + specular) * radiance * dotNL;
    }