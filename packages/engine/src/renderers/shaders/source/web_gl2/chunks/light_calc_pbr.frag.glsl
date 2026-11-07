vec3 V = normalize(u_viewPos - v_worldPos);
float normalMapLength = 1.0;
#ifdef USE_NORMAL_MAP
vec3 rawNormal = SAMPLE_NORMAL_MAP(v_uv).rgb * 2.0 - 1.0;
normalMapLength = length(rawNormal);
rawNormal.xy *= u_extraParams.zw;
vec3 N = v_tbn * rawNormal;
if (dot(N, N) < 0.0001) {
    N = v_normal;
}
if (dot(N, N) < 0.0001) {
    N = vec3(0.0, 0.0, 1.0);
}
N = normalize(N);
#else
vec3 N = v_normal;
if (dot(N, N) < 0.0001) {
    N = vec3(0.0, 0.0, 1.0);
}
N = normalize(N);
#endif
#ifdef USE_NORMAL_OUT
g_shadingNormal = N;
#endif
roughness = specularAntiAliasing(roughness, N, normalMapLength, max(abs(u_extraParams.z), abs(u_extraParams.w)));
float dotNV = max(dot(N, V), 0.0001);

// Base Reflectivity for non-metals from IOR (KHR_materials_ior)
float ior = u_liquidParams.x > 0.0 ? u_liquidParams.x : 1.5;
float f0_dielectric = pow((ior - 1.0) / (ior + 1.0), 2.0);
vec3 F0 = vec3(f0_dielectric);
float F90 = 1.0;
#ifdef USE_MATERIAL_SPECULAR
// KHR_materials_specular: u_matParam12.rgb = f0(ior) x specularColor (linear, unclamped); u_matParam13.x = specularFactor, the dielectric F90.
vec3 specularTint = u_matParam12.rgb;
float specularWeight = u_matParam13.x;
#ifdef USE_SPECULAR_COLOR_MAP
specularTint *= sRGBToLinear(texture(u_specularColorMap, v_uv).rgb);
#endif
#ifdef USE_SPECULAR_WEIGHT_MAP
#ifdef USE_SPECULAR_MAPS_SHARED
// Same texture as the tint map: read the alpha channel through that sampler (one unit, not two).
specularWeight *= texture(u_specularColorMap, v_uv).a;
#else
specularWeight *= texture(u_specularWeightMap, v_uv).a;
#endif
#endif
F0 = min(specularTint, vec3(1.0));
F90 = specularWeight;
#endif
// Albedo can exceed 1 (texture x tint), which would push F0 above 1, make kD = (1 - kS) * (1 - metallic)
// negative and turn the later pow()/gamma step into NaN -- the HDR NaN then bloomed into rectangles.
F0 = clamp(mix(F0, albedo, metallic), vec3(0.0), vec3(1.0));
F90 = mix(F90, 1.0, metallic);

// KHR_materials_transmission: the specular BTDF REPLACES the diffuse lobe (spec: mix(diffuse, btdf, T)),
// so every diffuse term below uses the transmission-weighted albedo; the BTDF is added after the IBL.
float transmissionWeight = 0.0;
#ifdef USE_TRANSMISSION
transmissionWeight = u_liquidParams.z;
#ifdef USE_TRANSMISSION_MAP
transmissionWeight *= texture(u_transmissionMap, v_uv).r;
#endif
#endif
vec3 diffuseAlbedo = albedo * (1.0 - transmissionWeight);

#ifdef USE_IRIDESCENCE
// KHR_materials_iridescence: u_matParam14 = (factor, film ior, thickness min nm, thickness max nm). The
// thin-film Fresnel is evaluated once per fragment at the view angle with the combined base F0 and folded
// back into F0, so every Fresnel call below picks it up (ADR 0055). Without a thickness texture the film has
// the maximum thickness. The optional textures scale the factor (red) and mix the thickness range (green).
{
    float iridescenceStrength = u_matParam14.x;
#ifdef USE_IRIDESCENCE_MAP
    iridescenceStrength *= texture(u_iridescenceMap, v_uv).r;
#endif
    float iridescenceThickness = u_matParam14.w;
#ifdef USE_IRIDESCENCE_THICKNESS_MAP
#ifdef USE_IRIDESCENCE_MAPS_SHARED
    // Same texture as the intensity map: read the green channel through that sampler (one unit, not two).
    iridescenceThickness = mix(u_matParam14.z, u_matParam14.w, texture(u_iridescenceMap, v_uv).g);
#else
    iridescenceThickness = mix(u_matParam14.z, u_matParam14.w, texture(u_iridescenceThicknessMap, v_uv).g);
#endif
#endif
#ifdef USE_IRIDESCENCE_CHEAP
    vec3 iridescenceFresnel = iridescenceFresnelCheap(dotNV, u_matParam14.y, iridescenceThickness, F0);
#else
    vec3 iridescenceFresnel = evalIridescence(1.0, u_matParam14.y, dotNV, iridescenceThickness, F0);
#endif
    F0 = mix(F0, clamp(schlickToF0(iridescenceFresnel, 1.0, dotNV), 0.0, 1.0), iridescenceStrength);
}
#endif

#ifdef USE_ANISOTROPY
// KHR_materials_anisotropy: u_matParam15 = (strength, cos(rotation), sin(rotation), 0). T follows the
// rotated tangent direction, B = cross(geometric normal, T) (Khronos reference). The optional texture holds
// the per-texel direction (red/green, [0,1] -> [-1,1], then rotated by anisotropyRotation) and multiplies the
// strength with its blue channel; without it the default texel is direction +X at full strength.
float anisotropyStrength = u_matParam15.x;
vec2 anisotropyDirection = vec2(u_matParam15.y, u_matParam15.z);
#ifdef USE_ANISOTROPY_MAP
{
    vec3 anisotropySample = texture(u_anisotropyMap, v_uv).rgb;
    vec2 texelDirection = anisotropySample.rg * 2.0 - 1.0;
    texelDirection = dot(texelDirection, texelDirection) > 1e-8 ? normalize(texelDirection) : vec2(1.0, 0.0);
    anisotropyDirection = vec2(
        u_matParam15.y * texelDirection.x - u_matParam15.z * texelDirection.y,
        u_matParam15.z * texelDirection.x + u_matParam15.y * texelDirection.y
    );
    anisotropyStrength *= anisotropySample.b;
}
#endif
vec3 anisoT = normalize(v_tbn * vec3(anisotropyDirection, 0.0));
vec3 anisoB = normalize(cross(normalize(v_tbn[2]), anisoT));
float anisoAlpha = max(roughness * roughness, 0.002);
float anisoAlphaT = mix(anisoAlpha, 1.0, anisotropyStrength * anisotropyStrength);
#endif

#ifdef USE_CLEARCOAT
float clearcoat = u_liquidParams.w;
#ifdef USE_CLEARCOAT_MAP
clearcoat *= texture(u_clearcoatMap, v_uv).r;
#endif
float clearcoatRoughness = clamp(u_thresholds.x, 0.05, 1.0);
#ifdef USE_CLEARCOAT_ROUGHNESS_MAP
clearcoatRoughness = clamp(clearcoatRoughness * texture(u_clearcoatRoughnessMap, v_uv).g, 0.05, 1.0);
#endif
#ifdef USE_CLEARCOAT_NORMAL_MAP
vec3 rawCcNormal = texture(u_clearcoatNormalMap, v_uv).rgb * 2.0 - 1.0;
rawCcNormal.xy *= u_extraParams.zw;
vec3 N_cc = normalize(v_tbn * rawCcNormal);
#else
vec3 N_cc = N;
#endif
float dotNV_cc = max(dot(N_cc, V), 0.0001);
#endif

#ifdef USE_SHEEN
// Sheen tint comes from the typed u_matParam10 lane (decoupled from the emissive u_specColor); see
// StandardMaterial._LANES. The USE_SHEEN compile gate is pushed from the same basis as the lane's w-flag.
vec3 sheenColor = sRGBToLinear(u_matParam10.rgb);
#ifdef USE_SHEEN_COLOR_MAP
sheenColor = sRGBToLinear(texture(u_sheenColorMap, v_uv).rgb);
#endif
float sheenRoughness = clamp(u_thresholds.y, 0.05, 1.0);
#ifdef USE_SHEEN_ROUGHNESS_MAP
sheenRoughness = clamp(sheenRoughness * texture(u_sheenRoughnessMap, v_uv).a, 0.05, 1.0);
#endif
// KHR_materials_sheen albedo scaling: the layer under the sheen loses the share the sheen reflects.
// Constant directional-albedo fit 0.157 (three.js MeshPhysicalMaterial sheenEnergyComp).
float sheenEnergyComp = 1.0 - 0.157 * max(sheenColor.r, max(sheenColor.g, sheenColor.b));
#endif

vec3 Lo = vec3(0.0);

// -- Directional Light --
{
    vec3 L = normalize(u_dirLightDir);
    vec3 H = normalize(V + L);
    float dotNL = max(dot(N, L), 0.0);
    float dotNH = max(dot(N, H), 0.0);
    float dotVH = max(dot(V, H), 0.0);

    float dirShadow = 1.0;
    if (u_dirShadowInfo.z > 0.5 && u_dirShadowInfo.w > 0.0) {
        float depth = length(u_viewPos - v_worldPos);
        int numCascades = int(u_dirShadowInfo.w);
        int cascadeIndex = numCascades - 1;
        for (int i = 0; i < 4; i++) {
            if (i >= numCascades) break;
            if (depth < u_cascadeSplits[i]) {
                cascadeIndex = i;
                break;
            }
        }

        // Cascade blending (see non-PBR light_calc.frag.glsl for rationale).
        float blendToNext = 0.0;
        if (cascadeIndex < numCascades - 1) {
            float splitFar = u_cascadeSplits[cascadeIndex];
            float blendBand = max(splitFar * 0.1, 0.0001);
            blendToNext = 1.0 - clamp((splitFar - depth) / blendBand, 0.0, 1.0);
        }

        // Normal-offset bias (see non-PBR light_calc.frag.glsl for rationale).
        // E10 (P3): per-cascade lane (see non-PBR light_calc.frag.glsl).
        vec3 dirShadowSamplePos = v_worldPos + N * u_dirShadowBias[cascadeIndex] * (1.0 - dotNL);
        float cols = ceil(sqrt(u_dirShadowInfo.w));
        float bias = u_dirShadowInfo.x;

        vec4 lightSpacePos = u_cascadeMatrices[cascadeIndex] * vec4(dirShadowSamplePos, 1.0);
        vec3 projCoords = lightSpacePos.xyz / lightSpacePos.w;
        projCoords = projCoords * 0.5 + 0.5;

        float shadowA = 1.0;
        if (projCoords.z <= 1.0 && projCoords.x >= 0.0 && projCoords.x <= 1.0 && projCoords.y >= 0.0 && projCoords.y <= 1.0) {
            float col = mod(float(cascadeIndex), cols);
            float row = floor(float(cascadeIndex) / cols);
            vec2 cellMin = vec2(col, row) / cols;
            vec2 cellMax = cellMin + vec2(1.0) / cols;
            vec2 atlasUV = (projCoords.xy + vec2(col, row)) / cols;
            float currentDepth = projCoords.z;

            if (u_evsmParams.x > 0.5) {
                // EVSM (ADR 0043): cell-clamped moment evaluation (see base_fragment_header).
                shadowA = evalEVSMDir(atlasUV, cellMin, cellMax, currentDepth);
            } else {
                // PCSS, cell-clamped (evalPCSSDir in base_fragment_header, ADR 0006).
                shadowA = evalPCSSDir(atlasUV, cellMin, cellMax, currentDepth, bias, cascadeIndex);
            }
        }

        float shadowB = shadowA;
        if (blendToNext > 0.0) {
            int nextCascade = cascadeIndex + 1;
            vec4 lightSpacePosB = u_cascadeMatrices[nextCascade] * vec4(dirShadowSamplePos, 1.0);
            vec3 projCoordsB = lightSpacePosB.xyz / lightSpacePosB.w;
            projCoordsB = projCoordsB * 0.5 + 0.5;

            shadowB = 1.0;
            if (projCoordsB.z <= 1.0 && projCoordsB.x >= 0.0 && projCoordsB.x <= 1.0 && projCoordsB.y >= 0.0 && projCoordsB.y <= 1.0) {
                float colB = mod(float(nextCascade), cols);
                float rowB = floor(float(nextCascade) / cols);
                vec2 atlasUVB = (projCoordsB.xy + vec2(colB, rowB)) / cols;
                float currentDepthB = projCoordsB.z;

                // Same filter as sample A (see non-PBR light_calc.frag.glsl).
                vec2 cellMinB = vec2(colB, rowB) / cols;
                vec2 cellMaxB = cellMinB + vec2(1.0) / cols;
                if (u_evsmParams.x > 0.5) {
                    shadowB = evalEVSMDir(atlasUVB, cellMinB, cellMaxB, currentDepthB);
                } else {
                    shadowB = evalPCSSDir(atlasUVB, cellMinB, cellMaxB, currentDepthB, bias, nextCascade);
                }
            }
        }

        dirShadow = mix(shadowA, shadowB, blendToNext);
    }

    vec3 radiance = u_dirLightColor * dirShadow;

    // Cook-Torrance BRDF
    float D = D_GGX(dotNH, roughness);
    float G = G_SchlickGGX(dotNL, dotNV, roughness);
    vec3 F = F_Schlick90(dotVH, F0, F90);

    vec3 kS = F;
    vec3 kD = vec3(1.0) - kS;
    kD *= 1.0 - metallic;

    vec3 numerator = D * G * F;
    float denominator = 4.0 * dotNV * dotNL + 0.0001;
    vec3 specular = numerator / denominator;
#ifdef USE_ANISOTROPY
    specular = F * specularAnisotropic(anisoT, anisoB, V, L, H, dotNL, dotNV, dotNH, anisoAlphaT, anisoAlpha);
#endif

    vec3 directLight = (kD * diffuseAlbedo / 3.14159265359 + specular) * radiance * dotNL;

#ifdef USE_SHEEN
    float dotNH_s = max(dot(N, H), 0.0);
    float D_s = D_Charlie(dotNH_s, sheenRoughness);
    float V_s = V_Neubelt(dotNL, dotNV);
    vec3 sheenSpecular = sheenColor * (D_s * V_s);
    directLight = directLight * sheenEnergyComp + sheenSpecular * radiance * dotNL;
#endif

#ifdef USE_CLEARCOAT
    if (clearcoat > 0.0) {
        float dotNL_cc = max(dot(N_cc, L), 0.0);
        float dotNH_cc = max(dot(N_cc, H), 0.0);
        float dotVH_cc = max(dot(V, H), 0.0);
        float D_cc = D_GGX(dotNH_cc, clearcoatRoughness);
        float G_cc = G_Kelemen(dotVH_cc);
        vec3 F_cc = F_Schlick(dotVH_cc, vec3(0.04));
        vec3 clearcoatSpecular = (D_cc * G_cc * F_cc) * clearcoat;
        directLight = directLight * (1.0 - clearcoat * F_cc.r) + clearcoatSpecular * radiance * dotNL_cc;
    }
#endif

    Lo += directLight;
}

// Clustered light lookup -- see docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md.
int clusterCellIndex = computeClusterCellIndex(u_viewPos, v_worldPos, u_clusterDims, u_cameraNearFar, u_tileSizePx);

// -- Point Lights --
uvec2 pointCluster = fetchPointClusterGridEntry(clusterCellIndex);
for(int k = 0; k < CLUSTER_MAX_LIGHTS; k++) {
    if (k >= int(pointCluster.y)) break;
    int i = int(fetchPointClusterLightIndex(int(pointCluster.x) + k));
    vec3 lightVec = u_pointLights[i].pos - v_worldPos;
    float dist = length(lightVec);
    vec3 L = normalize(lightVec);
    vec3 H = normalize(V + L);

    // Compute attenuation
    float lightDistance = max(u_pointLights[i].distance, 0.001);
    float decay = u_pointLights[i].decay;
    
    // PBR physically based attenuation: 1 / (distance^2)
    float distanceFalloff = 1.0 / max(dist * dist, 0.01);
    
    // Windowing function to zero out light at max distance
    float distRatio = dist / lightDistance;
    float distRatio4 = distRatio * distRatio * distRatio * distRatio;
    float window = clamp(1.0 - distRatio4, 0.0, 1.0);
    float cutoff = window * window;
    
    // If decay is 0, we don't fall off physically, we just do linear/constant
    float attenuation = (decay > 0.0) ? (distanceFalloff * cutoff) : clamp(1.0 - dist / lightDistance, 0.0, 1.0);
    vec3 radiance = u_pointLights[i].color * attenuation * pointShadowFactor(i, u_pointLights[i].pos, v_worldPos, v_normal);

    float dotNL = max(dot(N, L), 0.0);
    float dotNH = max(dot(N, H), 0.0);
    float dotVH = max(dot(V, H), 0.0);

    float D = D_GGX(dotNH, roughness);
    float G = G_SchlickGGX(dotNL, dotNV, roughness);
    vec3 F = F_Schlick90(dotVH, F0, F90);

    vec3 kS = F;
    vec3 kD = (vec3(1.0) - kS) * (1.0 - metallic);

    vec3 specular = (D * G * F) / (4.0 * dotNV * dotNL + 0.0001);
#ifdef USE_ANISOTROPY
    specular = F * specularAnisotropic(anisoT, anisoB, V, L, H, dotNL, dotNV, dotNH, anisoAlphaT, anisoAlpha);
#endif
    vec3 directLight = (kD * diffuseAlbedo / 3.14159265359 + specular) * radiance * dotNL;

#ifdef USE_SHEEN
    float dotNH_s = max(dot(N, H), 0.0);
    float D_s = D_Charlie(dotNH_s, sheenRoughness);
    float V_s = V_Neubelt(dotNL, dotNV);
    vec3 sheenSpecular = sheenColor * (D_s * V_s);
    directLight = directLight * sheenEnergyComp + sheenSpecular * radiance * dotNL;
#endif

#ifdef USE_CLEARCOAT
    if (clearcoat > 0.0) {
        float dotNL_cc = max(dot(N_cc, L), 0.0);
        float dotNH_cc = max(dot(N_cc, H), 0.0);
        float dotVH_cc = max(dot(V, H), 0.0);
        float D_cc = D_GGX(dotNH_cc, clearcoatRoughness);
        float G_cc = G_Kelemen(dotVH_cc);
        vec3 F_cc = F_Schlick(dotVH_cc, vec3(0.04));
        vec3 clearcoatSpecular = (D_cc * G_cc * F_cc) * clearcoat;
        directLight = directLight * (1.0 - clearcoat * F_cc.r) + clearcoatSpecular * radiance * dotNL_cc;
    }
#endif

    Lo += directLight;
}

// -- Spot Lights --
uvec2 spotCluster = fetchSpotClusterGridEntry(clusterCellIndex);
for(int k = 0; k < CLUSTER_MAX_LIGHTS; k++) {
    if (k >= int(spotCluster.y)) break;
    int i = int(fetchSpotClusterLightIndex(int(spotCluster.x) + k));
    vec3 lightVec = u_spotLights[i].pos - v_worldPos;
    float dist = length(lightVec);
    vec3 L = normalize(lightVec);
    vec3 H = normalize(V + L);

    vec3 spotDir = normalize(u_spotLights[i].dir);
    float cosOuter = u_spotLights[i].params.x;
    float cosInner = u_spotLights[i].params.y;
    float maxDist = u_spotLights[i].params.z;
    float decay = u_spotLights[i].params.w;

    float theta = dot(-L, spotDir);
    float epsilon = max(cosInner - cosOuter, 0.0001);
    float intensity = clamp((theta - cosOuter) / epsilon, 0.0, 1.0);

    if (intensity > 0.0 && dist < maxDist) {
        float distanceAttenuation = pow(clamp(1.0 - dist / maxDist, 0.0, 1.0), decay);
        float attenuation = distanceAttenuation * intensity;
        
        // Shadow Calculation
        // Pre-existing constraint, unrelated to clustering: only the first 4 spot lights (by
        // scene traversal order) ever get a real shadow slot -- see light_calc.frag.glsl.
        float shadow = 1.0;
        if (i < 4 && u_spotShadowInfo[i].z > 0.5) {
            vec3 projCoords = v_spotLightSpacePos[i].xyz / v_spotLightSpacePos[i].w;
            projCoords = projCoords * 0.5 + 0.5;
            if (projCoords.x >= 0.0 && projCoords.x <= 1.0 && projCoords.y >= 0.0 && projCoords.y <= 1.0 && projCoords.z <= 1.0) {
                float bias = u_spotShadowInfo[i].x;
                float currentDepth = projCoords.z;
                shadow = 0.0;
                vec2 texelSize = 1.0 / vec2(textureSize(u_spotShadowMap, 0).xy);

                for(int x = -1; x <= 1; ++x) {
                    for(int y = -1; y <= 1; ++y) {
                        vec3 tCoord = vec3(projCoords.xy + vec2(x, y) * texelSize, currentDepth - bias);
                        shadow += texture(u_spotShadowMap, vec4(tCoord.xy, float(i), tCoord.z));
                    }
                }
                shadow /= 9.0;
            }
        }

        vec3 radiance = u_spotLights[i].color * attenuation * shadow;

        float dotNL = max(dot(N, L), 0.0);
        float dotNH = max(dot(N, H), 0.0);
        float dotVH = max(dot(V, H), 0.0);

        float D = D_GGX(dotNH, roughness);
        float G = G_SchlickGGX(dotNL, dotNV, roughness);
        vec3 F = F_Schlick90(dotVH, F0, F90);

        vec3 kS = F;
        vec3 kD = (vec3(1.0) - kS) * (1.0 - metallic);

        vec3 specular = (D * G * F) / (4.0 * dotNV * dotNL + 0.0001);
#ifdef USE_ANISOTROPY
        specular = F * specularAnisotropic(anisoT, anisoB, V, L, H, dotNL, dotNV, dotNH, anisoAlphaT, anisoAlpha);
#endif
        vec3 directLight = (kD * diffuseAlbedo / 3.14159265359 + specular) * radiance * dotNL;

#ifdef USE_SHEEN
        float dotNH_s = max(dot(N, H), 0.0);
        float D_s = D_Charlie(dotNH_s, sheenRoughness);
        float V_s = V_Neubelt(dotNL, dotNV);
        vec3 sheenSpecular = sheenColor * (D_s * V_s);
        directLight = directLight * sheenEnergyComp + sheenSpecular * radiance * dotNL;
#endif

#ifdef USE_CLEARCOAT
        if (clearcoat > 0.0) {
            float dotNL_cc = max(dot(N_cc, L), 0.0);
            float dotNH_cc = max(dot(N_cc, H), 0.0);
            float dotVH_cc = max(dot(V, H), 0.0);
            float D_cc = D_GGX(dotNH_cc, clearcoatRoughness);
            float G_cc = G_Kelemen(dotVH_cc);
            vec3 F_cc = F_Schlick(dotVH_cc, vec3(0.04));
            vec3 clearcoatSpecular = (D_cc * G_cc * F_cc) * clearcoat;
            directLight = directLight * (1.0 - clearcoat * F_cc.r) + clearcoatSpecular * radiance * dotNL_cc;
        }
#endif

        Lo += directLight;
    }
}

// -- Area Lights --
for(int i = 0; i < 4; i++) {
    if (i >= u_numAreaLights) break;

    vec3 L_center = u_areaLights[i].pos;
    vec3 L_normal = normalize(u_areaLights[i].normal);
    vec3 dirFromLight = v_worldPos - L_center;

    if (dot(dirFromLight, L_normal) < 0.0) continue;

    vec3 L_right = normalize(u_areaLights[i].right);
    vec3 L_up = normalize(u_areaLights[i].up);
    vec2 size = u_areaLights[i].size;

    float projX = clamp(dot(dirFromLight, L_right), -size.x, size.x);
    float projY = clamp(dot(dirFromLight, L_up), -size.y, size.y);

    vec3 closestPoint = L_center + L_right * projX + L_up * projY;
    vec3 lightVec = closestPoint - v_worldPos;
    float dist = length(lightVec);
    vec3 L = lightVec / (dist + 0.0001);
    vec3 H = normalize(V + L);

    float maxDist = u_areaLights[i].params.x;
    float decay = u_areaLights[i].params.y;
    if (maxDist > 0.0 && dist >= maxDist) continue;
    float attenuation = (maxDist > 0.0) ? pow(clamp(1.0 - dist / maxDist, 0.0, 1.0), decay) : (1.0 / (1.0 + 0.1 * dist + 0.01 * dist * dist));
    vec3 radiance = u_areaLights[i].color * attenuation;

    float dotNL = max(dot(N, L), 0.0);
    float dotNH = max(dot(N, H), 0.0);
    float dotVH = max(dot(V, H), 0.0);

    float D = D_GGX(dotNH, roughness);
    float G = G_SchlickGGX(dotNL, dotNV, roughness);
    vec3 F = F_Schlick90(dotVH, F0, F90);

    vec3 kS = F;
    vec3 kD = (vec3(1.0) - kS) * (1.0 - metallic);

    vec3 specular = (D * G * F) / (4.0 * dotNV * dotNL + 0.0001);
#ifdef USE_ANISOTROPY
    specular = F * specularAnisotropic(anisoT, anisoB, V, L, H, dotNL, dotNV, dotNH, anisoAlphaT, anisoAlpha);
#endif
    vec3 directLight = (kD * diffuseAlbedo / 3.14159265359 + specular) * radiance * dotNL;

#ifdef USE_SHEEN
    float dotNH_s = max(dot(N, H), 0.0);
    float D_s = D_Charlie(dotNH_s, sheenRoughness);
    float V_s = V_Neubelt(dotNL, dotNV);
    vec3 sheenSpecular = sheenColor * (D_s * V_s);
    directLight = directLight * sheenEnergyComp + sheenSpecular * radiance * dotNL;
#endif

#ifdef USE_CLEARCOAT
    if (clearcoat > 0.0) {
        float dotNL_cc = max(dot(N_cc, L), 0.0);
        float dotNH_cc = max(dot(N_cc, H), 0.0);
        float dotVH_cc = max(dot(V, H), 0.0);
        float D_cc = D_GGX(dotNH_cc, clearcoatRoughness);
        float G_cc = G_Kelemen(dotVH_cc);
        vec3 F_cc = F_Schlick(dotVH_cc, vec3(0.04));
        vec3 clearcoatSpecular = (D_cc * G_cc * F_cc) * clearcoat;
        directLight = directLight * (1.0 - clearcoat * F_cc.r) + clearcoatSpecular * radiance * dotNL_cc;
    }
#endif

    Lo += directLight;
}

// -- Ambient Lighting --
#ifdef USE_IBL
vec3 kS_ambient = F_SchlickRoughness90(dotNV, F0, F90, roughness);
vec3 kD_ambient = 1.0 - kS_ambient;
kD_ambient *= 1.0 - metallic;

// Diffuse
// The baked irradiance/prefilter cubes are 8-bit sRGB-encoded like u_envMap (ADR 0048).
vec3 irradiance = sRGBToLinear(texture(u_irradianceMap, N).rgb) * u_envIntensity;
vec3 diffuseAmbient = irradiance * diffuseAlbedo;

// Specular -- a per-object dynamic reflection probe (u_envMap, e.g. DynamicReflectionProbe) is
// a sharp, real-time capture of this object's actual surroundings, while the scene's prefilter
// map is a single static, low-res bake shared by everything in the scene. When both are present
// the probe wins: without this check, every material picked up USE_IBL as soon as the SCENE had
// any baked environment at all, permanently hiding real-time mirror reflections behind the
// blurry static one (e.g. Showcase 15's mirror spheres going flat/hazy once scene-level IBL was
// added, even though their own DynamicReflectionProbe kept updating correctly underneath).
vec3 R = reflect(-V, N);
#ifdef USE_ANISOTROPY
// The specular lookup follows the Khronos bent normal; the clearcoat has its own R_cc.
R = reflect(-V, anisotropyBentNormal(anisoB, V, N, anisotropyStrength, roughness));
#endif
const float MAX_REFLECTION_LOD = 4.0;
vec3 prefilteredColor;
#ifdef USE_ENV_MAP
if (u_useEnvMap > 0.5) {
    float lod = roughness * 5.0;
    // u_useEnvMap 2 = a RenderTargetCube probe written through the output lane, 1 = an sRGB asset cube.
    vec3 envRaw = textureLod(u_envMap, R, lod).rgb;
    prefilteredColor = (u_useEnvMap > 1.5 ? targetToLinear(envRaw) : sRGBToLinear(envRaw)) * u_envIntensity;
} else {
    prefilteredColor = sRGBToLinear(textureLod(u_prefilterMap, R, roughness * MAX_REFLECTION_LOD).rgb) * u_envIntensity;
}
#else
prefilteredColor = sRGBToLinear(textureLod(u_prefilterMap, R, roughness * MAX_REFLECTION_LOD).rgb) * u_envIntensity;
#endif
vec2 envBRDF  = texture(u_brdfLUT, vec2(max(dotNV, 0.0), roughness)).rg;
vec3 specularAmbient = prefilteredColor * (kS_ambient * envBRDF.x + envBRDF.y);

vec3 ambient = (kD_ambient * diffuseAmbient + specularAmbient) * ao;

#ifdef USE_SHEEN
// KHR_materials_sheen under IBL: base scaled by the sheen albedo; the rough Charlie lobe reads the diffuse
// irradiance through the analytic directional-albedo fit (Estevez & Kulla 2017, three.js IBLSheenBRDF).
// Added before the clearcoat block so the coat attenuates it (layer order: coat > sheen > base).
ambient = ambient * sheenEnergyComp + irradiance * sheenColor * IBLSheenBRDF(dotNV, sheenRoughness) * ao;
#endif

#ifdef USE_CLEARCOAT
if (clearcoat > 0.0) {
    vec3 R_cc = reflect(-V, N_cc);
    vec3 ccPrefilter = sRGBToLinear(textureLod(u_prefilterMap, R_cc, clearcoatRoughness * MAX_REFLECTION_LOD).rgb) * u_envIntensity;
    vec2 ccEnvBRDF = texture(u_brdfLUT, vec2(max(dotNV_cc, 0.0), clearcoatRoughness)).rg;
    vec3 ccSpecular = ccPrefilter * (vec3(0.04) * ccEnvBRDF.x + ccEnvBRDF.y) * clearcoat;
    ambient = ambient * (1.0 - clearcoat * F_Schlick(dotNV_cc, vec3(0.04)).r) + ccSpecular;
}
#endif

#else
vec3 R = reflect(-V, N);
#ifdef USE_ANISOTROPY
// The specular lookup follows the Khronos bent normal; the clearcoat has its own R_cc.
R = reflect(-V, anisotropyBentNormal(anisoB, V, N, anisotropyStrength, roughness));
#endif
vec3 f_fallback = F_Schlick90(dotNV, F0, F90);
vec3 kD_fallback = (1.0 - f_fallback) * (1.0 - metallic);
vec3 ambient = (kD_fallback * u_ambientColor * diffuseAlbedo) * ao;

#ifdef USE_ENV_MAP
// Per-material envMap fallback
if (u_useEnvMap > 0.5) {
    float lod = roughness * 5.0;
    vec3 envRaw = textureLod(u_envMap, R, lod).rgb;
    vec3 envColor = u_useEnvMap > 1.5 ? targetToLinear(envRaw) : sRGBToLinear(envRaw);
    ambient += (envColor * f_fallback) * ao;
}
#endif
#endif

#ifdef USE_TRANSMISSION
if (transmissionWeight > 0.0) {
    // Khronos reference (glTF-Sample-Renderer getVolumeTransmissionRay): refract the view ray, march
    // it `thickness` (mesh space -> world via the model scale) through the volume, project the exit
    // point and sample the opaque-scene snapshot there. A thick sphere thus shows the scene inverted.
    float thickness = u_liquidParams.y;
    #ifdef USE_THICKNESS_MAP
    thickness *= texture(u_thicknessMap, v_uv).g;
    #endif
    float attenuationDist = u_thresholds.z;

    vec3 modelScale = vec3(length(u_model[0].xyz), length(u_model[1].xyz), length(u_model[2].xyz));
    vec3 transmissionRay = normalize(refract(-V, N, 1.0 / ior)) * thickness * modelScale;
    vec4 exitClip = u_vp * vec4(v_worldPos + transmissionRay, 1.0);
    vec2 screenUv = clamp(exitClip.xy / exitClip.w * 0.5 + 0.5, vec2(0.001), vec2(0.999));

    // A01: cancel the forward-capture exposure (mirror pattern); identity when post owns the tail
    // (u_exposure forced to 1.0 by WebGL2Renderer while post is active).
    vec3 transmittedLight = targetToLinear(texture(u_opaqueMap, screenUv).rgb) / max(u_exposure, 0.001);
    vec3 volumeTransmittance = VolumeAbsorption(sRGBToLinear(u_matParam11.rgb), attenuationDist, length(transmissionRay));
    vec3 btdf = transmittedLight * volumeTransmittance * albedo;

    vec3 kT = (vec3(1.0) - F_Schlick90(dotNV, F0, F90)) * (1.0 - metallic);
    ambient += btdf * kT * transmissionWeight;
}
#endif

vec3 color = ambient + Lo;

// Emissive
#ifdef USE_EMISSIVE_MAP
vec3 emissive = sRGBToLinear(SAMPLE_EMISSIVE_MAP(v_uv).rgb) * sRGBToLinear(u_specColor.rgb) * u_specColor.a;
#else
vec3 emissive = sRGBToLinear(u_specColor.rgb) * u_specColor.a;
#endif

color += emissive;

#ifdef USE_REFLECTION_MAP
    // A02: the planar-reflection blend must run in LINEAR space before the exposure/tone-map tail
    // (matching WebGPU Standard.frag.wgsl ordering). On this tier the tail lives inside LIGHT_CALC_PBR,
    // so the blend lives here; it only touches the USE_REFLECTION_MAP program variant (Standard). The
    // capture carries the forward-pass exposure when post is OFF, so it is divided out (mirror pattern);
    // u_exposure is forced to 1.0 while post owns the tail (see WebGL2Renderer).
    if (u_useReflectionMap > 0.5) {
        vec4 clipPos = u_vp * vec4(v_worldPos, 1.0);
        vec2 ndc = clipPos.xy / clipPos.w;
        vec2 screenUV = ndc * 0.5 + 0.5;
        vec3 reflectionColor = targetToLinear(texture(u_reflectionMap, screenUV).rgb) / max(u_exposure, 0.001);
        // Blend based on reflectivity and fresnel or fixed factor
        float f = u_reflectivity * mix(1.0, F_Schlick(max(dot(normalize(v_normal), V), 0.0), F0).x, u_matParam0.x); // simple approx
        color = mix(color, reflectionColor, f);
    }
#endif

// Exposure
color *= u_exposure;

// ── Forward-Pass / Post-Pass tonemapping contract ──────────────────────────────────────────────
// u_gamma == 1.0  →  PostProcessing is ENABLED. The renderer writes gamma=1.0 specifically
//                    as a signal that the PostProcess pass will handle tonemapping, gamma,
//                    and exposure (see WebGL2Renderer.ts).
// u_gamma != 1.0  →  PostProcessing is DISABLED. The forward pass IS the final pass.
//                    Reinhard + linearToSRGB run here as a lightweight single-pass pipeline.
if (u_gamma != 1.0) {
    color = color / (color + vec3(1.0)); // Reinhard
}

// Gamma Correction (when u_gamma == 1.0, 1.0 / 1.0 = 1.0, preserving linear HDR values for PostProcessPassGL)
color = linearToSRGB(color);

fragColor = vec4(color, u_color.a * texColor.a);

if (fragColor.a < u_extraParams.y) {
    discard;
}
