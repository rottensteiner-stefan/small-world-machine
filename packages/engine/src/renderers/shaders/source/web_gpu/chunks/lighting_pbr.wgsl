// WGSL PBR Lighting calculation (Logic only)

let V = normalize(global.viewPos.xyz - i.wp);
let TBN = mat3x3f(normalize(i.t), normalize(i.b), normalize(i.n));
var rawNormal = textureSample(u_normalMap, s, i.uv).rgb * 2.0 - 1.0;
rawNormal.x *= obj.extraParams.z;
rawNormal.y *= obj.extraParams.w;
let N = normalize(TBN * rawNormal);
let dotNV = max(dot(N, V), 0.0001);

let ior = select(1.5, obj.liquidParams.x, obj.liquidParams.x > 0.0);
let f0_dielectric = pow((ior - 1.0) / (ior + 1.0), 2.0);
// Albedo can exceed 1 (texture x tint), which would push F0 above 1, make kD = (1 - kS) * (1 - metallic)
// negative and turn the later pow()/gamma step into NaN -- the HDR NaN then bloomed into rectangles.
var F0 = clamp(mix(vec3f(f0_dielectric), albedo, metallic), vec3f(0.0), vec3f(1.0));

let clearcoat = obj.liquidParams.w;
let clearcoatRoughness = clamp(obj.thresholds.x, 0.05, 1.0);
let sheenRoughness = clamp(obj.thresholds.y, 0.05, 1.0);

var Lo = vec3f(0.0);

// Directional Light
{
    let L = normalize(global.dirLightDir.xyz);
    let H = normalize(V + L);
    let dotNL = max(dot(N, L), 0.0);
    let dotNH = max(dot(N, H), 0.0);
    let dotVH = max(dot(V, H), 0.0);
    
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

        // Cascade blending (see lighting.wgsl for rationale).
        var blendToNext: f32 = 0.0;
        if (cascadeIndex + 1u < numCascades) {
            let splitFar = global.cascadeSplits[cascadeIndex];
            let blendBand = max(splitFar * 0.1, 0.0001);
            blendToNext = 1.0 - clamp((splitFar - viewDist) / blendBand, 0.0, 1.0);
        }

        // Normal-offset bias, scaled by NdotL (see lighting.wgsl for rationale).
        let dirShadowSamplePos = i.wp + N * global.dirShadowInfo.y * (1.0 - dotNL);
        let shadowPos = global.cascadeMatrices[cascadeIndex] * vec4f(dirShadowSamplePos, 1.0);
        let shadowA = getShadowPCSS(u_dirShadowMap, shadowSampler, shadowPos, cascadeIndex, global.dirShadowInfo.x);

        var shadowB = shadowA;
        if (blendToNext > 0.0) {
            let nextCascade = cascadeIndex + 1u;
            let shadowPosB = global.cascadeMatrices[nextCascade] * vec4f(dirShadowSamplePos, 1.0);
            shadowB = getShadowPCF(u_dirShadowMap, shadowSampler, shadowPosB, nextCascade, global.dirShadowInfo.x);
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
    var directLight = (kD * albedo / 3.14159265359 + specular) * radiance * dotNL;

    if (clearcoat > 0.0) {
        let D_cc = D_GGX(dotNH, clearcoatRoughness);
        let G_cc = G_Kelemen(dotVH);
        let F_cc = F_Schlick(dotVH, vec3f(0.04));
        let clearcoatSpecular = (D_cc * G_cc * F_cc) * clearcoat;
        directLight = directLight * (1.0 - clearcoat * F_cc.x) + clearcoatSpecular * radiance * dotNL;
    }

    if (sheenRoughness > 0.0 && (obj.specColor.r > 0.0 || obj.specColor.g > 0.0 || obj.specColor.b > 0.0)) {
        let D_s = D_Charlie(dotNH, sheenRoughness);
        let V_s = V_Neubelt(dotNL, dotNV);
        let sheenSpecular = obj.specColor.rgb * (D_s * V_s);
        directLight += sheenSpecular * radiance * dotNL;
    }

    Lo += directLight;
}

// Clustered light lookup -- see docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md and
// lighting.wgsl (identical formula, duplicated here since this chunk has no shared-code
// mechanism with the non-PBR lighting chunk).
let clusterDimsU = vec3u(u32(global.clusterDims.x), u32(global.clusterDims.y), u32(global.clusterDims.z));
let clusterCellX = min(u32(i.pos.x / global.tileSizePx.x), clusterDimsU.x - 1u);
let clusterCellY = min(u32(i.pos.y / global.tileSizePx.y), clusterDimsU.y - 1u);
let clusterViewDist = clamp(length(global.viewPos.xyz - i.wp), global.cameraNearFar.x, global.cameraNearFar.y);
let clusterLogRatio = log(global.cameraNearFar.y / global.cameraNearFar.x);
let clusterSliceF = floor(log(clusterViewDist / global.cameraNearFar.x) * f32(clusterDimsU.z) / clusterLogRatio);
let clusterCellZ = min(u32(max(clusterSliceF, 0.0)), clusterDimsU.z - 1u);
let clusterCellIndex = clusterCellX + clusterDimsU.x * (clusterCellY + clusterDimsU.y * clusterCellZ);

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
        var directLight = (kD * albedo / 3.14159265359 + specular) * radiance * dotNL;

        if (clearcoat > 0.0) {
            let D_cc = D_GGX(dotNH, clearcoatRoughness);
            let G_cc = G_Kelemen(dotVH);
            let F_cc = F_Schlick(dotVH, vec3f(0.04));
            let clearcoatSpecular = (D_cc * G_cc * F_cc) * clearcoat;
            directLight = directLight * (1.0 - clearcoat * F_cc.x) + clearcoatSpecular * radiance * dotNL;
        }

        if (sheenRoughness > 0.0 && (obj.specColor.r > 0.0 || obj.specColor.g > 0.0 || obj.specColor.b > 0.0)) {
            let D_s = D_Charlie(dotNH, sheenRoughness);
            let V_s = V_Neubelt(dotNL, dotNV);
            let sheenSpecular = obj.specColor.rgb * (D_s * V_s);
            directLight += sheenSpecular * radiance * dotNL;
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
        let F = F_Schlick(dotVH, F0);

        let kS = F;
        let kD = (vec3f(1.0) - kS) * (1.0 - metallic);
        let specular = (D * G * F) / (4.0 * dotNV * dotNL + 0.0001);
        var directLight = (kD * albedo / 3.14159265359 + specular) * radiance * dotNL;

        if (clearcoat > 0.0) {
            let D_cc = D_GGX(dotNH, clearcoatRoughness);
            let G_cc = G_Kelemen(dotVH);
            let F_cc = F_Schlick(dotVH, vec3f(0.04));
            let clearcoatSpecular = (D_cc * G_cc * F_cc) * clearcoat;
            directLight = directLight * (1.0 - clearcoat * F_cc.x) + clearcoatSpecular * radiance * dotNL;
        }

        if (sheenRoughness > 0.0 && (obj.specColor.r > 0.0 || obj.specColor.g > 0.0 || obj.specColor.b > 0.0)) {
            let D_s = D_Charlie(dotNH, sheenRoughness);
            let V_s = V_Neubelt(dotNL, dotNV);
            let sheenSpecular = obj.specColor.rgb * (D_s * V_s);
            directLight += sheenSpecular * radiance * dotNL;
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
    let F = F_Schlick(dotVH, F0);

    let kS = F;
    let kD = (vec3f(1.0) - kS) * (1.0 - metallic);
    let specular = (D * G * F) / (4.0 * dotNV * dotNL + 0.0001);
    var directLight = (kD * albedo / 3.14159265359 + specular) * radiance * dotNL;

    if (clearcoat > 0.0) {
        let D_cc = D_GGX(dotNH, clearcoatRoughness);
        let G_cc = G_Kelemen(dotVH);
        let F_cc = F_Schlick(dotVH, vec3f(0.04));
        let clearcoatSpecular = (D_cc * G_cc * F_cc) * clearcoat;
        directLight = directLight * (1.0 - clearcoat * F_cc.x) + clearcoatSpecular * radiance * dotNL;
    }

    if (sheenRoughness > 0.0 && (obj.specColor.r > 0.0 || obj.specColor.g > 0.0 || obj.specColor.b > 0.0)) {
        let D_s = D_Charlie(dotNH, sheenRoughness);
        let V_s = V_Neubelt(dotNL, dotNV);
        let sheenSpecular = obj.specColor.rgb * (D_s * V_s);
        directLight += sheenSpecular * radiance * dotNL;
    }

    Lo += directLight;
}

// -- Ambient IBL --
let kS_ambient = F_SchlickRoughness(dotNV, F0, roughness);
var kD_ambient = vec3f(1.0) - kS_ambient;
kD_ambient *= 1.0 - metallic;

let irradiance = textureSampleLevel(u_irradianceMap, globalSampler, N, 0.0).rgb * global.envIntensity;
let diffuseAmbient = irradiance * albedo;

// A per-object dynamic reflection probe (u_envMap, e.g. DynamicReflectionProbe) is a sharp,
// real-time capture of this object's actual surroundings, while the scene's prefilter map is a
// single static, low-res bake shared by everything in the scene. When both are present the probe
// wins: without this check, adding scene-level IBL to a scene permanently hid real-time mirror
// reflections behind the blurry static one, even though the probe kept updating correctly
// underneath (e.g. Showcase 15's mirror spheres going flat/hazy once scene IBL was added).
let R = reflect(-V, N);
let MAX_REFLECTION_LOD = 4.0;
var specularAmbient: vec3f;
if (obj.useEnvMap > 0.5) {
    let lod = roughness * 5.0;
    let envColor = sRGBToLinear(textureSampleLevel(u_envMap, s, R, lod).rgb);
    specularAmbient = envColor * F_Schlick(dotNV, F0);
} else {
    let prefilteredColor = textureSampleLevel(u_prefilterMap, globalSampler, R, roughness * MAX_REFLECTION_LOD).rgb * global.envIntensity;
    let envBRDF = textureSampleLevel(u_brdfLUT, globalSampler, vec2f(max(dotNV, 0.0), roughness), 0.0).rg;
    specularAmbient = prefilteredColor * (kS_ambient * envBRDF.x + envBRDF.y);
}

var ambient = (kD_ambient * diffuseAmbient + specularAmbient) * ao;

if (clearcoat > 0.0) {
    let ccPrefilter = textureSampleLevel(u_prefilterMap, globalSampler, R, clearcoatRoughness * MAX_REFLECTION_LOD).rgb * global.envIntensity;
    let ccEnvBRDF = textureSampleLevel(u_brdfLUT, globalSampler, vec2f(max(dotNV, 0.0), clearcoatRoughness), 0.0).rg;
    let ccSpecular = ccPrefilter * (vec3f(0.04) * ccEnvBRDF.x + ccEnvBRDF.y) * clearcoat;
    ambient = ambient * (1.0 - clearcoat * F_Schlick(dotNV, vec3f(0.04)).x) + ccSpecular;
}

if (dot(irradiance, irradiance) < 1e-6) {
    let f_fallback = F_Schlick(dotNV, F0);
    let kD_fallback = (vec3f(1.0) - f_fallback) * (1.0 - metallic);
    ambient = (kD_fallback * global.ambientColor.rgb * albedo + specularAmbient) * ao;
}

var color = ambient + Lo;

// Emissive
let emissive = sRGBToLinear(textureSample(u_emissiveMap, s, i.uv).rgb) * sRGBToLinear(obj.specColor.rgb) * obj.specColor.a;
color += emissive;
