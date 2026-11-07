vec3 V = normalize(u_viewPos - v_worldPos);
vec3 rawNormal = texture2D(u_normalMap, v_uv).rgb * 2.0 - 1.0;
float normalMapLength = length(rawNormal);
rawNormal.xy *= u_extraParams.zw;
vec3 N = normalize(v_tbn * rawNormal);
roughness = specularAntiAliasing(roughness, N, normalMapLength, max(abs(u_extraParams.z), abs(u_extraParams.w)));
float dotNV = max(dot(N, V), 0.0001);

float ior = u_liquidParams.x > 0.0 ? u_liquidParams.x : 1.5;
float f0_dielectric = pow((ior - 1.0) / (ior + 1.0), 2.0);
// KHR_materials_specular: u_matParam12.rgb = f0(ior) x specularColor (linear, unclamped), w = enable;
// u_matParam13.x = specularFactor, the dielectric F90. Metals keep F90 = 1.
bool specularEnabled = u_matParam12.w > 0.5;
vec3 F0 = specularEnabled ? min(u_matParam12.rgb, vec3(1.0)) : vec3(f0_dielectric);
float F90 = specularEnabled ? u_matParam13.x : 1.0;
// Albedo can exceed 1 (texture x tint), which would push F0 above 1, make kD = (1 - kS) * (1 - metallic)
// negative and turn the later pow()/gamma step into NaN -- the HDR NaN then bloomed into rectangles.
F0 = clamp(mix(F0, albedo, metallic), vec3(0.0), vec3(1.0));
F90 = mix(F90, 1.0, metallic);

#ifdef USE_IRIDESCENCE
// KHR_materials_iridescence: u_matParam14 = (factor, film ior, thickness min nm, thickness max nm). Cheap
// two-beam film on this tier (ADR 0055), evaluated once per fragment at the view angle and folded back into
// F0. Without a thickness texture the film has the maximum thickness; the textures are WebGL2 only.
{
    vec3 iridescenceFresnel = iridescenceFresnelCheap(dotNV, u_matParam14.y, u_matParam14.w, F0);
    F0 = mix(F0, clamp(schlickToF0(iridescenceFresnel, 1.0, dotNV), 0.0, 1.0), u_matParam14.x);
}
#endif

#ifdef USE_ANISOTROPY
// KHR_materials_anisotropy: u_matParam15 = (strength, cos(rotation), sin(rotation), 0). T follows the
// rotated tangent direction, B = cross(geometric normal, T) (Khronos reference).
float anisotropyStrength = u_matParam15.x;
float anisoAlpha = max(roughness * roughness, 0.002);
float anisoAlphaT = mix(anisoAlpha, 1.0, anisotropyStrength * anisotropyStrength);
vec3 anisoT = normalize(v_tbn * vec3(u_matParam15.y, u_matParam15.z, 0.0));
vec3 anisoB = normalize(cross(normalize(v_tbn[2]), anisoT));
#endif

float clearcoat = u_liquidParams.w;
// Sheen is decoupled from u_specColor (emissive): tint + enable travel in the typed u_matParam10
// lane (ADR 0039 sheen decision); the runtime w-flag mirrors WebGL2's USE_SHEEN compile gate.
float clearcoatRoughness = clamp(u_thresholds.x, 0.05, 1.0);
float sheenRoughness = clamp(u_thresholds.y, 0.05, 1.0);
bool sheenOn = u_matParam10.w > 0.5;
vec3 sheenColor = sRGBToLinear(u_matParam10.rgb);
// KHR_materials_sheen albedo scaling: the layer under the sheen loses the share the sheen reflects.
// Constant directional-albedo fit 0.157 (three.js MeshPhysicalMaterial sheenEnergyComp).
float sheenEnergyComp = sheenOn ? 1.0 - 0.157 * max(sheenColor.r, max(sheenColor.g, sheenColor.b)) : 1.0;

// KHR_materials_transmission: the specular BTDF REPLACES the diffuse lobe (Khronos reference:
// mix(diffuse, btdf, T)), so every diffuse term below uses the transmission-weighted albedo; the
// BTDF is added after the ambient. WebGL2/WGSL parity (light_calc_pbr.frag.glsl / lighting_pbr.wgsl).
float transmissionWeight = 0.0;
#ifdef USE_TRANSMISSION
transmissionWeight = u_liquidParams.z;
#ifdef USE_TRANSMISSION_MAP
transmissionWeight *= texture2D(u_transmissionMap, v_uv).r;
#endif
#endif
vec3 diffuseAlbedo = albedo * (1.0 - transmissionWeight);

vec3 Lo = vec3(0.0);

// Directional Light
{
    vec3 L = normalize(u_dirLightDir);
    vec3 H = normalize(V + L);
    float dotNL = max(dot(N, L), 0.0);
    float dotNH = max(dot(N, H), 0.0);
    float dotVH = max(dot(V, H), 0.0);

    vec3 radiance = u_dirLightColor;

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

    if (sheenOn) {
        float D_s = D_Charlie(dotNH, sheenRoughness);
        float V_s = V_Neubelt(dotNL, dotNV);
        vec3 sheenSpecular = sheenColor * (D_s * V_s);
        directLight = directLight * sheenEnergyComp + sheenSpecular * radiance * dotNL;
    }

    if (clearcoat > 0.0) {
        float D_cc = D_GGX(dotNH, clearcoatRoughness);
        float G_cc = G_Kelemen(dotVH);
        vec3 F_cc = F_Schlick(dotVH, vec3(0.04));
        vec3 clearcoatSpecular = (D_cc * G_cc * F_cc) * clearcoat;
        directLight = directLight * (1.0 - clearcoat * F_cc.r) + clearcoatSpecular * radiance * dotNL;
    }

    Lo += directLight;
}

// -- Point Lights --
for(int i = 0; i < 16; i++) {
    if (i >= u_numPointLights) break;
    vec3 lightVec = u_pointLightPos[i] - v_worldPos;
    float dist = length(lightVec);
    vec3 L = normalize(lightVec);
    vec3 H = normalize(V + L);

    // Compute attenuation
    float lightDistance = max(u_pointLightDistance[i], 0.001);
    float decay = u_pointLightDecay[i];
    
    // PBR physically based attenuation: 1 / (distance^2)
    float distanceFalloff = 1.0 / max(dist * dist, 0.01);
    
    // Windowing function to zero out light at max distance
    float distRatio = dist / lightDistance;
    float distRatio4 = distRatio * distRatio * distRatio * distRatio;
    float window = clamp(1.0 - distRatio4, 0.0, 1.0);
    float cutoff = window * window;
    
    // If decay is 0, we don't fall off physically, we just do linear/constant
    float attenuation = (decay > 0.0) ? (distanceFalloff * cutoff) : clamp(1.0 - dist / lightDistance, 0.0, 1.0);
    vec3 radiance = u_pointLightColor[i] * attenuation;

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

    if (sheenOn) {
        float D_s = D_Charlie(dotNH, sheenRoughness);
        float V_s = V_Neubelt(dotNL, dotNV);
        vec3 sheenSpecular = sheenColor * (D_s * V_s);
        directLight = directLight * sheenEnergyComp + sheenSpecular * radiance * dotNL;
    }

    if (clearcoat > 0.0) {
        float D_cc = D_GGX(dotNH, clearcoatRoughness);
        float G_cc = G_Kelemen(dotVH);
        vec3 F_cc = F_Schlick(dotVH, vec3(0.04));
        vec3 clearcoatSpecular = (D_cc * G_cc * F_cc) * clearcoat;
        directLight = directLight * (1.0 - clearcoat * F_cc.r) + clearcoatSpecular * radiance * dotNL;
    }

    Lo += directLight;
}

// -- Area Lights --
for(int i = 0; i < 4; i++) {
    if (i >= u_numAreaLights) break;

    vec3 L_center = u_areaLightPos[i];
    vec3 L_normal = normalize(u_areaLightNormal[i]);
    vec3 dirFromLight = v_worldPos - L_center;

    if (dot(dirFromLight, L_normal) < 0.0) continue;

    vec3 L_right = normalize(u_areaLightRight[i]);
    vec3 L_up = normalize(u_areaLightUp[i]);
    vec2 size = u_areaLightSize[i];

    float projX = clamp(dot(dirFromLight, L_right), -size.x, size.x);
    float projY = clamp(dot(dirFromLight, L_up), -size.y, size.y);

    vec3 closestPoint = L_center + L_right * projX + L_up * projY;
    vec3 lightVec = closestPoint - v_worldPos;
    float dist = length(lightVec);
    vec3 L = lightVec / (dist + 0.0001);
    vec3 H = normalize(V + L);

    // G06: authored area range now clips exactly like the GL2 opaque PBR path (default distance 0 =
    // infinite keeps the legacy inverse fallback). Before, the fixed 1/(1+0.1d+0.01d^2) ignored the
    // authored range and decay entirely.
    float aMaxDist = u_areaLightParams[i].x;
    float aDecay = u_areaLightParams[i].y;
    if (aMaxDist > 0.0 && dist >= aMaxDist) continue;
    float attenuation = (aMaxDist > 0.0) ? pow(clamp(1.0 - dist / aMaxDist, 0.0, 1.0), aDecay) : (1.0 / (1.0 + 0.1 * dist + 0.01 * dist * dist));
    vec3 radiance = u_areaLightColor[i] * attenuation;

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

    if (sheenOn) {
        float D_s = D_Charlie(dotNH, sheenRoughness);
        float V_s = V_Neubelt(dotNL, dotNV);
        vec3 sheenSpecular = sheenColor * (D_s * V_s);
        directLight = directLight * sheenEnergyComp + sheenSpecular * radiance * dotNL;
    }

    if (clearcoat > 0.0) {
        float D_cc = D_GGX(dotNH, clearcoatRoughness);
        float G_cc = G_Kelemen(dotVH);
        vec3 F_cc = F_Schlick(dotVH, vec3(0.04));
        vec3 clearcoatSpecular = (D_cc * G_cc * F_cc) * clearcoat;
        directLight = directLight * (1.0 - clearcoat * F_cc.r) + clearcoatSpecular * radiance * dotNL;
    }

    Lo += directLight;
}

vec3 irradiance = u_ambientColor;
vec3 diffuseAmbient = irradiance * diffuseAlbedo;
vec3 specularAmbient = vec3(0.0);

// G04: the GL2/WGPU ambient energy split keeps the Fresnel share out of the diffuse response
// ((1 - F_Schlick90) * (1 - metallic), see the GL2 no-IBL fallback); GL1 applied only
// (1 - metallic), leaving dielectrics' ambient diffuse up to 1/(1-F) brighter than upper tiers.
vec3 ambientFresnel = F_Schlick90(dotNV, F0, F90);
vec3 kD_ambient = (vec3(1.0) - ambientFresnel) * (1.0 - metallic);

if (u_useEnvMap > 0.5) {
    vec3 R = reflect(-V, N);
#ifdef USE_ANISOTROPY
    R = reflect(-V, anisotropyBentNormal(anisoB, V, N, anisotropyStrength, roughness));
#endif
    // textureCubeLod needs an extension in WebGL1; the core `bias` argument shifts the hardware LOD
    // by the GL2 roughness lane (`roughness * 5`) so rough surfaces read blurred mips (no-op without mips).
    vec3 envColor = sRGBToLinear(textureCube(u_envMap, R, roughness * 5.0).rgb) * u_envIntensity;

    // G01: probe specular integrates the BRDF (kS * scale + bias) like GL2/WGPU; the analytic
    // Karis fit replaces the LUT (WebGL1 has no LUT sampler).
#ifdef USE_BRDF_LUT
    vec2 envBRDF = texture2D(u_brdfLUT, vec2(max(dotNV, 0.0), roughness)).rg;
#else
    vec2 envBRDF = EnvBRDFApprox(roughness, max(dotNV, 0.0));
#endif
    specularAmbient = envColor * (ambientFresnel * envBRDF.x + envBRDF.y);
}

// `specularAmbient` is already `vec3(0.0)` when there's no envMap, so this one formula covers
// both cases; the ambient diffuse uses the G04 Fresnel energy split, never a separate override.
vec3 ambient = (kD_ambient * diffuseAmbient + specularAmbient) * ao;
// KHR_materials_sheen ambient (WebGL1 has no IBL: u_ambientColor stands in for the irradiance).
if (sheenOn) {
    ambient = ambient * sheenEnergyComp + irradiance * sheenColor * IBLSheenBRDF(dotNV, sheenRoughness) * ao;
}

#ifdef USE_TRANSMISSION
// KHR_materials_transmission/volume on WebGL1, mirror of the WebGL2 light_calc_pbr chunk (Khronos
// getVolumeTransmissionRay): refract the view ray, march it `thickness` (mesh space -> world via the
// model scale) through the volume, project the exit point and sample the opaque-scene snapshot there.
// GLSL ES 1.00 has no targetToLinear, so the sRGB snapshot is decoded with the tier's pow(., 2.2)
// approximation (Glass.frag.glsl100 convention). u_vp/u_model mirror the vertex-stage declarations
// (same name/type/precision -> one shared uniform location per program).
if (transmissionWeight > 0.0) {
    float thickness = u_liquidParams.y;
    #ifdef USE_THICKNESS_MAP
    thickness *= texture2D(u_thicknessMap, v_uv).g;
    #endif
    float attenuationDist = u_thresholds.z;

    vec3 modelScale = vec3(length(u_model[0].xyz), length(u_model[1].xyz), length(u_model[2].xyz));
    vec3 transmissionRay = normalize(refract(-V, N, 1.0 / ior)) * thickness * modelScale;
    vec4 exitClip = u_vp * vec4(v_worldPos + transmissionRay, 1.0);
    vec2 screenUv = clamp(exitClip.xy / exitClip.w * 0.5 + 0.5, vec2(0.001), vec2(0.999));

    vec3 transmittedLight = pow(texture2D(u_opaqueMap, screenUv).rgb, vec3(2.2)) / max(u_exposure, 0.001);
    vec3 volumeTransmittance = VolumeAbsorption(sRGBToLinear(u_matParam11.rgb), attenuationDist, length(transmissionRay));
    vec3 btdf = transmittedLight * volumeTransmittance * albedo;

    vec3 kT = (vec3(1.0) - F_Schlick90(dotNV, F0, F90)) * (1.0 - metallic);
    ambient += btdf * kT * transmissionWeight;
}
#endif

vec3 color = ambient + Lo;

// Emissive
vec3 emissive = sRGBToLinear(texture2D(u_emissiveMap, v_uv).rgb) * sRGBToLinear(u_specColor.rgb) * u_specColor.a;
color += emissive;

// Exposure (A03): same forward order as GL2 -- gain, then forwardToneMap, then encode.
color *= u_exposure;
color = forwardToneMap(color);
color = linearToSRGB(color);

gl_FragColor = vec4(color, u_color.a * texColor.a);
if (gl_FragColor.a < u_extraParams.y) {
    discard;
}
