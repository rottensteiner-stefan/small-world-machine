// WGSL PBR Lighting calculation (Logic only)

let V = normalize(global.viewPos.xyz - i.wp);
let TBN = mat3x3f(normalize(i.t), normalize(i.b), normalize(i.n));
var rawNormal = sampleNormalMap(i.uv).rgb * 2.0 - 1.0;
let normalMapLength = length(rawNormal);
rawNormal.x *= obj.extraParams.z;
rawNormal.y *= obj.extraParams.w;
let N = normalize(TBN * rawNormal);
g_shadingNormal = N;
roughness = specularAntiAliasing(roughness, N, normalMapLength, max(abs(obj.extraParams.z), abs(obj.extraParams.w)));
let dotNV = max(dot(N, V), 0.0001);

let ior = select(1.5, obj.liquidParams.x, obj.liquidParams.x > 0.0);
let f0_dielectric = pow((ior - 1.0) / (ior + 1.0), 2.0);
// Albedo can exceed 1 (texture x tint), which would push F0 above 1, make kD = (1 - kS) * (1 - metallic)
// negative and turn the later pow()/gamma step into NaN -- the HDR NaN then bloomed into rectangles.
// KHR_materials_specular: matParam12.xyz = f0(ior) x specularColor (linear, unclamped), w = enable;
// matParam13.x = specularFactor, the dielectric F90. Metals keep F90 = 1.
let specularEnabled = obj.matParam12.w > 0.5;
var specularTint = obj.matParam12.xyz;
var specularWeight = obj.matParam13.x;
#ifdef USE_SPECULAR_COLOR_MAP
specularTint *= sRGBToLinear(textureSample(u_specularColorMap, s, i.uv).rgb);
#endif
#ifdef USE_SPECULAR_WEIGHT_MAP
#ifndef USE_SPECULAR_MAPS_SHARED
specularWeight *= textureSample(u_specularWeightMap, s, i.uv).a;
#else
// Packed layout: the strength rides in the tint map's alpha channel (one unit, not two).
specularWeight *= textureSample(u_specularColorMap, s, i.uv).a;
#endif
#endif
let dielectricF0 = select(vec3f(f0_dielectric), min(specularTint, vec3f(1.0)), specularEnabled);
let dielectricF90 = select(1.0, specularWeight, specularEnabled);
var F0 = clamp(mix(dielectricF0, albedo, metallic), vec3f(0.0), vec3f(1.0));
let F90 = mix(dielectricF90, 1.0, metallic);

// KHR_materials_transmission: the specular BTDF REPLACES the diffuse lobe (spec: mix(diffuse, btdf, T)),
// so every diffuse term below uses the transmission-weighted albedo; the BTDF is added after the IBL.
var transmissionWeight = 0.0;
#ifdef USE_TRANSMISSION
transmissionWeight = obj.liquidParams.z;
#ifdef USE_TRANSMISSION_MAP
transmissionWeight *= textureSample(u_transmissionMap, s, i.uv).r;
#endif
#endif
let diffuseAlbedo = albedo * (1.0 - transmissionWeight);

// The #ifdef blocks below are stripped by `preprocessConditionals` (GPUPipelineCache) unless the material
// compiles with the flag, so materials without the feature pay nothing for it (ADR 0055).
#ifdef USE_IRIDESCENCE
// KHR_materials_iridescence: matParam14 = (factor, film ior, thickness min nm, thickness max nm).
// The thin-film Fresnel is evaluated once per fragment at the view angle with the combined base F0 and folded
// back into F0, so every Fresnel call below picks it up (the Khronos spec leaves the per-device BRDF choice
// open). Without a thickness texture the film has the maximum thickness; the textures are WebGL2 only.
{
#ifdef USE_IRIDESCENCE_CHEAP
    let iridescenceFresnel = iridescenceFresnelCheap(dotNV, obj.matParam14.y, obj.matParam14.w, F0);
#else
    let iridescenceFresnel = evalIridescence(1.0, obj.matParam14.y, dotNV, obj.matParam14.w, F0);
#endif
    F0 = mix(F0, clamp(schlickToF0(iridescenceFresnel, 1.0, dotNV), vec3f(0.0), vec3f(1.0)), obj.matParam14.x);
}
#endif

#ifdef USE_ANISOTROPY
// KHR_materials_anisotropy: matParam15 = (strength, cos(rotation), sin(rotation), 0).
// T follows the rotated tangent direction, B = cross(geometric normal, T) (Khronos reference).
let anisotropyStrength = obj.matParam15.x;
let anisoAlpha = max(roughness * roughness, 0.002);
let anisoAlphaT = mix(anisoAlpha, 1.0, anisotropyStrength * anisotropyStrength);
let anisoT = normalize(TBN * vec3f(obj.matParam15.y, obj.matParam15.z, 0.0));
let anisoB = normalize(cross(normalize(i.n), anisoT));
#endif

var clearcoat = obj.liquidParams.w;
#ifdef USE_CLEARCOAT_MAP
clearcoat *= textureSample(u_clearcoatMap, s, i.uv).r;
#endif
var clearcoatRoughness = clamp(obj.thresholds.x, 0.05, 1.0);
#ifdef USE_CLEARCOAT_ROUGHNESS_MAP
clearcoatRoughness = clamp(clearcoatRoughness * textureSample(u_clearcoatRoughnessMap, s, i.uv).g, 0.05, 1.0);
#endif
#ifdef USE_CLEARCOAT_NORMAL_MAP
var rawCcNormal = textureSample(u_clearcoatNormalMap, s, i.uv).rgb * 2.0 - 1.0;
rawCcNormal.x *= obj.extraParams.z;
rawCcNormal.y *= obj.extraParams.w;
let N_cc = normalize(TBN * rawCcNormal);
#else
let N_cc = N;
#endif
let dotNV_cc = max(dot(N_cc, V), 0.0001);
// Sheen is decoupled from the emissive specColor: tint + enable travel in the typed matParam10 lane
// (ADR 0039 sheen decision); the runtime w-flag mirrors WebGL2's USE_SHEEN compile gate.
var sheenColor = sRGBToLinear(obj.matParam10.rgb);
#ifdef USE_SHEEN_COLOR_MAP
sheenColor = sRGBToLinear(textureSample(u_sheenColorMap, s, i.uv).rgb);
#endif
var sheenRoughness = clamp(obj.thresholds.y, 0.05, 1.0);
#ifdef USE_SHEEN_ROUGHNESS_MAP
sheenRoughness = clamp(sheenRoughness * textureSample(u_sheenRoughnessMap, s, i.uv).a, 0.05, 1.0);
#endif
let sheenOn = obj.matParam10.w > 0.5;
// KHR_materials_sheen albedo scaling: the layer under the sheen loses the share the sheen reflects.
// Constant directional-albedo fit 0.157 (three.js MeshPhysicalMaterial sheenEnergyComp).
let sheenEnergyComp = select(1.0, 1.0 - 0.157 * max(sheenColor.r, max(sheenColor.g, sheenColor.b)), sheenOn);

var Lo = vec3f(0.0);

// Directional Light
{
    let L = normalize(global.dirLightDir.xyz);
    let H = normalize(V + L);
    let dotNL = max(dot(N, L), 0.0);
    let dotNH = max(dot(N, H), 0.0);
    let dotVH = max(dot(V, H), 0.0);
    
    var shadow: f32 = 1.0;
#ifdef USE_BACKLIGHT
    var backlightShadow: f32 = 1.0;
#endif
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

        // Cascade blending (see lighting.wgsl for rationale).
        var blendToNext: f32 = 0.0;
        if (cascadeIndex + 1u < numCascades) {
            let splitFar = global.cascadeSplits[cascadeIndex];
            // G08: same band constant + linear law as every other tier (GL2 PBR/Phong,
            // froxel_integrate compute -- cross-tier seam-fade parity).
            let blendBand = max(splitFar * 0.1, 0.0001);
            blendToNext = 1.0 - clamp((splitFar - viewDist) / blendBand, 0.0, 1.0);
        }

        // Normal-offset bias, scaled by NdotL (see lighting.wgsl for rationale).
        // E10 (P3): per-cascade lane (see lighting.wgsl).
        let dirShadowSamplePos = i.wp + N * global.dirShadowBias[cascadeIndex] * (1.0 - dotNL);
        let shadowPos = global.cascadeMatrices[cascadeIndex] * vec4f(dirShadowSamplePos, 1.0);
        let shadowA = getShadowDirMain(u_dirShadowMap, shadowSampler, shadowPos, cascadeIndex, global.dirShadowInfo.x);

        var shadowB = shadowA;
        if (blendToNext > 0.0) {
            let nextCascade = cascadeIndex + 1u;
            let shadowPosB = global.cascadeMatrices[nextCascade] * vec4f(dirShadowSamplePos, 1.0);
            shadowB = getShadowDirBlend(u_dirShadowMap, shadowSampler, shadowPosB, nextCascade, global.dirShadowInfo.x);
        }

        shadow = mix(shadowA, shadowB, blendToNext);
#ifdef USE_BACKLIGHT
        // Transmission shadow sampled `thickness` metres toward the sun: the surface's own leaf or
        // crown must not occlude the light passing through it, other casters still do (ADR 0060).
        // WP-C2: the +L*thickness offset can push the sample out of `cascadeIndex`'s ortho box near
        // a cascade split. Blend across to the next cascade in the blend band, or fall back to it
        // entirely when the primary sample escaped the box, instead of the 1.0 (unshadowed) halo
        // the failed read used to leave along the split.
        let backlightPos = global.cascadeMatrices[cascadeIndex] * vec4f(i.wp + L * obj.matParam1.w, 1.0);
        let backNdc = backlightPos.xyz / backlightPos.w;
        let backUv = vec2f(backNdc.x * 0.5 + 0.5, 0.5 - backNdc.y * 0.5);
        let backInRange = backUv.x >= 0.0 && backUv.x <= 1.0 && backUv.y >= 0.0 && backUv.y <= 1.0 && backNdc.z >= 0.0 && backNdc.z <= 1.0;
        if (backInRange) {
            backlightShadow = getShadowDirMain(u_dirShadowMap, shadowSampler, backlightPos, cascadeIndex, global.dirShadowInfo.x);
        }
        if (backInRange && blendToNext > 0.0 && cascadeIndex + 1u < numCascades) {
            let nextBackPos = global.cascadeMatrices[cascadeIndex + 1u] * vec4f(i.wp + L * obj.matParam1.w, 1.0);
            backlightShadow = mix(backlightShadow, getShadowDirMain(u_dirShadowMap, shadowSampler, nextBackPos, cascadeIndex + 1u, global.dirShadowInfo.x), blendToNext);
        } else if (!backInRange && cascadeIndex + 1u < numCascades) {
            let nextBackPos = global.cascadeMatrices[cascadeIndex + 1u] * vec4f(i.wp + L * obj.matParam1.w, 1.0);
            backlightShadow = getShadowDirMain(u_dirShadowMap, shadowSampler, nextBackPos, cascadeIndex + 1u, global.dirShadowInfo.x);
        }
#endif
    }

    let radiance = global.dirLightColor.xyz * shadow;

    let D = D_GGX(dotNH, roughness);
    let G = G_SchlickGGX(dotNL, dotNV, roughness);
    let F = F_Schlick90(dotVH, F0, F90);

    let kS = F;
    let kD = (vec3f(1.0) - kS) * (1.0 - metallic);
    var specular = (D * G * F) / (4.0 * dotNV * dotNL + 0.0001);
#ifdef USE_ANISOTROPY
    specular = F * specularAnisotropic(anisoT, anisoB, V, L, H, dotNL, dotNV, dotNH, anisoAlphaT, anisoAlpha);
#endif
    var directLight = (kD * diffuseAlbedo / 3.14159265359 + specular) * radiance * dotNL;

    if (sheenOn) {
        let D_s = D_Charlie(dotNH, sheenRoughness);
        let V_s = V_Neubelt(dotNL, dotNV);
        let sheenSpecular = sheenColor * (D_s * V_s);
        directLight = directLight * sheenEnergyComp + sheenSpecular * radiance * dotNL;
    }

    if (clearcoat > 0.0) {
        let dotNL_cc = max(dot(N_cc, L), 0.0);
        let dotNH_cc = max(dot(N_cc, H), 0.0);
        let dotVH_cc = max(dot(V, H), 0.0);
        let D_cc = D_GGX(dotNH_cc, clearcoatRoughness);
        let G_cc = G_Kelemen(dotVH_cc);
        let F_cc = F_Schlick(dotVH_cc, vec3f(0.04));
        let clearcoatSpecular = (D_cc * G_cc * F_cc) * clearcoat;
        directLight = directLight * (1.0 - clearcoat * F_cc.x) + clearcoatSpecular * radiance * dotNL_cc;
    }

    Lo += directLight;
#ifdef USE_BACKLIGHT
    // Thin-surface transmission (Godot `backlight`): wrap from the unlit side + forward lobe toward the sun.
    let backlightForwardPower = 6.0;
    let backlightLobe = max(dot(-N, L), 0.0) + pow(max(dot(-V, L), 0.0), backlightForwardPower);
    Lo += sRGBToLinear(obj.matParam1.rgb) * diffuseAlbedo / 3.14159265359 * global.dirLightColor.xyz * (backlightShadow * backlightLobe);
#endif
}

// Clustered light lookup -- see docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md and
// lighting.wgsl (identical formula, duplicated here since this chunk has no shared-code
// mechanism with the non-PBR lighting chunk).
[CLUSTER_INDEX_LOOKUP]

// Point Lights
let pointCluster = pointClusterGrid[clusterCellIndex];
for(var k=0u; k<pointCluster.y; k++) {
    let j = pointClusterIndices[pointCluster.x + k];
    let lightVec = pLights[j].pos.xyz - i.wp;
    let dist = length(lightVec);
    let L = lightVec / dist;
    let lDist = max(pLights[j].pos.w, 0.001);
    let decay = pLights[j].col.w;
    let distFalloff = 1.0 / max(dist * dist, 0.01);
    
    let distRatio = dist / lDist;
    let distRatio4 = distRatio * distRatio * distRatio * distRatio;
    let window = clamp(1.0 - distRatio4, 0.0, 1.0);
    let cutoff = window * window;
    
    var attenuation = clamp(1.0 - dist / lDist, 0.0, 1.0);
    if (decay > 0.0) {
        attenuation = distFalloff * cutoff;
    }
    
    if (attenuation > 0.0) {
        let H = normalize(V + L);
        // Geometric (interpolated vertex) normal for the shadow bias, as WebGL2 pointShadowFactor(v_normal).
        let geomN = normalize(i.n);
        let pShadow = getPointShadow(u_spotShadowMap, shadowSampler, j, pLights[j].pos.xyz, i.wp, geomN, max(dot(geomN, L), 0.0));
        let radiance = pLights[j].col.xyz * attenuation * pShadow;
        
        let dotNL = max(dot(N, L), 0.0);
        let dotNH = max(dot(N, H), 0.0);
        let dotVH = max(dot(V, H), 0.0);

        let D = D_GGX(dotNH, roughness);
        let G = G_SchlickGGX(dotNL, dotNV, roughness);
        let F = F_Schlick90(dotVH, F0, F90);

        let kS = F;
        let kD = (vec3f(1.0) - kS) * (1.0 - metallic);
        var specular = (D * G * F) / (4.0 * dotNV * dotNL + 0.0001);
#ifdef USE_ANISOTROPY
        specular = F * specularAnisotropic(anisoT, anisoB, V, L, H, dotNL, dotNV, dotNH, anisoAlphaT, anisoAlpha);
#endif
        var directLight = (kD * diffuseAlbedo / 3.14159265359 + specular) * radiance * dotNL;

        if (sheenOn) {
            let D_s = D_Charlie(dotNH, sheenRoughness);
            let V_s = V_Neubelt(dotNL, dotNV);
            let sheenSpecular = sheenColor * (D_s * V_s);
            directLight = directLight * sheenEnergyComp + sheenSpecular * radiance * dotNL;
        }

        if (clearcoat > 0.0) {
            let dotNL_cc = max(dot(N_cc, L), 0.0);
            let dotNH_cc = max(dot(N_cc, H), 0.0);
            let dotVH_cc = max(dot(V, H), 0.0);
            let D_cc = D_GGX(dotNH_cc, clearcoatRoughness);
            let G_cc = G_Kelemen(dotVH_cc);
            let F_cc = F_Schlick(dotVH_cc, vec3f(0.04));
            let clearcoatSpecular = (D_cc * G_cc * F_cc) * clearcoat;
            directLight = directLight * (1.0 - clearcoat * F_cc.x) + clearcoatSpecular * radiance * dotNL_cc;
        }

        Lo += directLight;
    }
}

// Spot Lights
let spotCluster = spotClusterGrid[clusterCellIndex];
for(var k=0u; k<spotCluster.y; k++) {
    let j = spotClusterIndices[spotCluster.x + k];
    let lightVec = sLights[j].pos.xyz - i.wp;
    let dist = length(lightVec);
    let L = lightVec / dist;
    
    // SpotLight parameters
    let spotDir = normalize(sLights[j].dir.xyz);
    let cosOuter = sLights[j].params.x;
    let cosInner = sLights[j].params.y;
    let maxDist = sLights[j].params.z;
    let decay = sLights[j].params.w;
    
    let theta = dot(L, -spotDir);
    let epsilon = max(cosInner - cosOuter, 0.0001);
    let intensity = clamp((theta - cosOuter) / epsilon, 0.0, 1.0);
    
    if (intensity > 0.0 && dist < maxDist) {
        let H = normalize(V + L);
        let distanceAttenuation = pow(clamp(1.0 - dist / maxDist, 0.0, 1.0), decay);
        let attenuation = distanceAttenuation * intensity;
        
        var shadow: f32 = 1.0;
        if (j < 4u && global.spotShadowInfo[j].z > 0.5) {
            let shadowPos = global.spotShadowMatrices[j] * vec4f(i.wp + N * global.spotShadowInfo[j].y * (1.0 - max(dot(N, L), 0.0)), 1.0);
            shadow = getShadowPCSS(u_spotShadowMap, shadowSampler, shadowPos, j, global.spotShadowInfo[j].x);
        }
        
        let radiance = sLights[j].col.xyz * attenuation * shadow;

        let dotNL = max(dot(N, L), 0.0);
        let dotNH = max(dot(N, H), 0.0);
        let dotVH = max(dot(V, H), 0.0);

        let D = D_GGX(dotNH, roughness);
        let G = G_SchlickGGX(dotNL, dotNV, roughness);
        let F = F_Schlick90(dotVH, F0, F90);

        let kS = F;
        let kD = (vec3f(1.0) - kS) * (1.0 - metallic);
        var specular = (D * G * F) / (4.0 * dotNV * dotNL + 0.0001);
#ifdef USE_ANISOTROPY
        specular = F * specularAnisotropic(anisoT, anisoB, V, L, H, dotNL, dotNV, dotNH, anisoAlphaT, anisoAlpha);
#endif
        var directLight = (kD * diffuseAlbedo / 3.14159265359 + specular) * radiance * dotNL;

        if (sheenOn) {
            let D_s = D_Charlie(dotNH, sheenRoughness);
            let V_s = V_Neubelt(dotNL, dotNV);
            let sheenSpecular = sheenColor * (D_s * V_s);
            directLight = directLight * sheenEnergyComp + sheenSpecular * radiance * dotNL;
        }

        if (clearcoat > 0.0) {
            let dotNL_cc = max(dot(N_cc, L), 0.0);
            let dotNH_cc = max(dot(N_cc, H), 0.0);
            let dotVH_cc = max(dot(V, H), 0.0);
            let D_cc = D_GGX(dotNH_cc, clearcoatRoughness);
            let G_cc = G_Kelemen(dotVH_cc);
            let F_cc = F_Schlick(dotVH_cc, vec3f(0.04));
            let clearcoatSpecular = (D_cc * G_cc * F_cc) * clearcoat;
            directLight = directLight * (1.0 - clearcoat * F_cc.x) + clearcoatSpecular * radiance * dotNL_cc;
        }

        Lo += directLight;
    }
}

// -- Area Lights --
for(var j=0u; j<u32(global.numAreaLights); j++) {
    let L_center = aLights[j].pos.xyz;
    let L_normal = normalize(aLights[j].normal.xyz);
    let dirFromLight = i.wp - L_center;
    if(dot(dirFromLight, L_normal) < 0.0) { continue; }

    let L_right = normalize(aLights[j].right.xyz);
    let L_up = normalize(aLights[j].up.xyz);
    let size = aLights[j].size.xy;

    let projX = clamp(dot(dirFromLight, L_right), -size.x, size.x);
    let projY = clamp(dot(dirFromLight, L_up), -size.y, size.y);

    let closestPoint = L_center + L_right * projX + L_up * projY;
    let lightVec = closestPoint - i.wp;
    let dist = length(lightVec);
    let L = lightVec / (dist + 0.0001);
    let H = normalize(V + L);

    let maxDist = aLights[j].size.z;
    let decay = aLights[j].size.w;
    if (maxDist > 0.0 && dist >= maxDist) { continue; }
    let atten = select(1.0 / (1.0 + 0.1*dist + 0.01*dist*dist), pow(clamp(1.0 - dist / maxDist, 0.0, 1.0), decay), maxDist > 0.0);
    let radiance = aLights[j].col.xyz * atten;

    let dotNL = max(dot(N, L), 0.0);
    let dotNH = max(dot(N, H), 0.0);
    let dotVH = max(dot(V, H), 0.0);

    let D = D_GGX(dotNH, roughness);
    let G = G_SchlickGGX(dotNL, dotNV, roughness);
    let F = F_Schlick90(dotVH, F0, F90);

    let kS = F;
    let kD = (vec3f(1.0) - kS) * (1.0 - metallic);
    var specular = (D * G * F) / (4.0 * dotNV * dotNL + 0.0001);
#ifdef USE_ANISOTROPY
    specular = F * specularAnisotropic(anisoT, anisoB, V, L, H, dotNL, dotNV, dotNH, anisoAlphaT, anisoAlpha);
#endif
    var directLight = (kD * diffuseAlbedo / 3.14159265359 + specular) * radiance * dotNL;

    if (sheenOn) {
        let D_s = D_Charlie(dotNH, sheenRoughness);
        let V_s = V_Neubelt(dotNL, dotNV);
        let sheenSpecular = sheenColor * (D_s * V_s);
        directLight = directLight * sheenEnergyComp + sheenSpecular * radiance * dotNL;
    }

    if (clearcoat > 0.0) {
        let dotNL_cc = max(dot(N_cc, L), 0.0);
        let dotNH_cc = max(dot(N_cc, H), 0.0);
        let dotVH_cc = max(dot(V, H), 0.0);
        let D_cc = D_GGX(dotNH_cc, clearcoatRoughness);
        let G_cc = G_Kelemen(dotVH_cc);
        let F_cc = F_Schlick(dotVH_cc, vec3f(0.04));
        let clearcoatSpecular = (D_cc * G_cc * F_cc) * clearcoat;
        directLight = directLight * (1.0 - clearcoat * F_cc.x) + clearcoatSpecular * radiance * dotNL_cc;
    }

    Lo += directLight;
}

// -- Ambient IBL --
let kS_ambient = F_SchlickRoughness90(dotNV, F0, F90, roughness);
var kD_ambient = vec3f(1.0) - kS_ambient;
kD_ambient *= 1.0 - metallic;

// The baked irradiance/prefilter cubes are 8-bit sRGB-encoded like u_envMap (ADR 0048).
let irradiance = sRGBToLinear(textureSampleLevel(u_irradianceMap, globalSampler, N, 0.0).rgb) * global.envIntensity;
let diffuseAmbient = irradiance * diffuseAlbedo;

// A per-object dynamic reflection probe (u_envMap, e.g. DynamicReflectionProbe) is a sharp,
// real-time capture of this object's actual surroundings, while the scene's prefilter map is a
// single static, low-res bake shared by everything in the scene. When both are present the probe
// wins: without this check, adding scene-level IBL to a scene permanently hid real-time mirror
// reflections behind the blurry static one, even though the probe kept updating correctly
// underneath (e.g. Showcase 15's mirror spheres going flat/hazy once scene IBL was added).
let R = reflect(-V, N);
// KHR_materials_anisotropy: the specular lookup follows the bent normal; the clearcoat keeps R.
#ifdef USE_ANISOTROPY
let RSpec = reflect(-V, anisotropyBentNormal(anisoB, V, N, anisotropyStrength, roughness));
#else
let RSpec = R;
#endif
let MAX_REFLECTION_LOD = 4.0;
var specularAmbient: vec3f;
if (obj.useEnvMap > 0.5) {
    let lod = roughness * 5.0;
    // useEnvMap 2 = a RenderTargetCube probe written through the output lane, 1 = an sRGB asset cube.
    let envRaw = textureSampleLevel(u_envMap, s, RSpec, lod).rgb;
    let envColor = select(sRGBToLinear(envRaw), targetToLinear(envRaw), obj.useEnvMap > 1.5) * global.envIntensity;
    // G01: same split-sum BRDF integration as the WebGL2 probe path (light_calc_pbr.frag.glsl).
    // Without the BRDF-LUT term rough dielectrics were overbright and rough metals nearly black
    // (specularAmbient = envColor * F only drops the kS*envBRDF.x + envBRDF.y energy split).
    let envBRDF = textureSampleLevel(u_brdfLUT, globalSampler, vec2f(max(dotNV, 0.0), roughness), 0.0).rg;
    specularAmbient = envColor * (kS_ambient * envBRDF.x + envBRDF.y);
} else {
    let prefilteredColor = sRGBToLinear(textureSampleLevel(u_prefilterMap, globalSampler, RSpec, roughness * MAX_REFLECTION_LOD).rgb) * global.envIntensity;
    let envBRDF = textureSampleLevel(u_brdfLUT, globalSampler, vec2f(max(dotNV, 0.0), roughness), 0.0).rg;
    specularAmbient = prefilteredColor * (kS_ambient * envBRDF.x + envBRDF.y);
}

var ambient = (kD_ambient * diffuseAmbient + specularAmbient) * ao;

// KHR_materials_sheen under IBL: base scaled by the sheen albedo; the rough Charlie lobe reads the diffuse
// irradiance through the analytic directional-albedo fit (Estevez & Kulla 2017, three.js IBLSheenBRDF).
// Added before the clearcoat block so the coat attenuates it (layer order: coat > sheen > base).
if (sheenOn) {
    ambient = ambient * sheenEnergyComp + irradiance * sheenColor * IBLSheenBRDF(dotNV, sheenRoughness) * ao;
}

if (clearcoat > 0.0) {
    let R_cc = reflect(-V, N_cc);
    let ccPrefilter = sRGBToLinear(textureSampleLevel(u_prefilterMap, globalSampler, R_cc, clearcoatRoughness * MAX_REFLECTION_LOD).rgb) * global.envIntensity;
    let ccEnvBRDF = textureSampleLevel(u_brdfLUT, globalSampler, vec2f(max(dotNV_cc, 0.0), clearcoatRoughness), 0.0).rg;
    let ccSpecular = ccPrefilter * (vec3f(0.04) * ccEnvBRDF.x + ccEnvBRDF.y) * clearcoat;
    ambient = ambient * (1.0 - clearcoat * F_Schlick(dotNV_cc, vec3f(0.04)).x) + ccSpecular;
}

if (dot(irradiance, irradiance) < 1e-6) {
    let f_fallback = F_Schlick90(dotNV, F0, F90);
    let kD_fallback = (vec3f(1.0) - f_fallback) * (1.0 - metallic);
    ambient = (kD_fallback * global.ambientColor.rgb * diffuseAlbedo + specularAmbient) * ao;
}

#ifdef USE_TRANSMISSION
// KHR_materials_transmission + volume, mirror of the WebGL2 path (light_calc_pbr.frag.glsl). Khronos
// reference (glTF-Sample-Renderer getVolumeTransmissionRay): refract the view ray, march it `thickness`
// (mesh space -> world via the model scale) through the volume, project the exit point and sample the
// opaque-scene snapshot there -- a thick sphere thus shows the scene inverted. Inputs are per-object
// uniforms, so the branch is uniform and implicit-derivative sampling stays legal inside it.
if (transmissionWeight > 0.0) {
    var thickness = obj.liquidParams.y;
    #ifdef USE_THICKNESS_MAP
    thickness *= textureSample(u_thicknessMap, s, i.uv).g;
    #endif
    let attenuationDist = obj.thresholds.z;

    let modelScale = vec3f(length(obj.model[0].xyz), length(obj.model[1].xyz), length(obj.model[2].xyz));
    let transmissionRay = normalize(refract(-V, N, 1.0 / ior)) * thickness * modelScale;
    let exitClip = global.vp * vec4f(i.wp + transmissionRay, 1.0);
    let exitNdc = exitClip.xy / exitClip.w;
    // WebGPU texture space is y-down; NDC is y-up.
    let screenUv = clamp(vec2f(exitNdc.x * 0.5 + 0.5, 0.5 - exitNdc.y * 0.5), vec2f(0.001), vec2f(0.999));

    // A01: cancel the forward-capture exposure (mirror pattern); identity when post owns the tail
    // (renderer forces global.exposure = 1.0), exact inverse when the forward pass is final.
    let transmittedLight = targetToLinear(textureSampleLevel(u_opaqueMap, globalSampler, screenUv, 0.0).rgb) / max(global.exposure, 0.001);
    let volumeTransmittance = VolumeAbsorption(sRGBToLinear(obj.matParam11.xyz), attenuationDist, length(transmissionRay));
    let btdf = transmittedLight * volumeTransmittance * albedo;

    let kT = (vec3f(1.0) - F_Schlick90(dotNV, F0, F90)) * (1.0 - metallic);
    ambient += btdf * kT * transmissionWeight;
}
#endif

var color = ambient + Lo;

// Emissive
let emissive = sRGBToLinear(sampleEmissiveMap(i.uv).rgb) * sRGBToLinear(obj.specColor.rgb) * obj.specColor.a;
color += emissive;
