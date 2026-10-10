vec3 V = normalize(u_viewPos - v_worldPos);
vec3 rawNormal = texture2D(u_normalMap, v_uv).rgb * 2.0 - 1.0;
rawNormal.xy *= u_extraParams.zw;
vec3 N = normalize(v_tbn * rawNormal);
float dotNV = max(dot(N, V), 0.0001);

float ior = u_liquidParams.x > 0.0 ? u_liquidParams.x : 1.5;
float f0_dielectric = pow((ior - 1.0) / (ior + 1.0), 2.0);
vec3 F0 = vec3(f0_dielectric); 
// Albedo can exceed 1 (texture x tint), which would push F0 above 1, make kD = (1 - kS) * (1 - metallic)
// negative and turn the later pow()/gamma step into NaN -- the HDR NaN then bloomed into rectangles.
F0 = clamp(mix(F0, albedo, metallic), vec3(0.0), vec3(1.0));

float clearcoat = u_liquidParams.w;
float clearcoatRoughness = clamp(u_thresholds.x, 0.05, 1.0);
float sheenRoughness = clamp(u_thresholds.y, 0.05, 1.0);

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
    vec3 F = F_Schlick(dotVH, F0);

    vec3 kS = F;
    vec3 kD = (vec3(1.0) - kS) * (1.0 - metallic);

    vec3 specular = (D * G * F) / (4.0 * dotNV * dotNL + 0.0001);
    vec3 directLight = (kD * albedo / 3.14159265359 + specular) * radiance * dotNL;

    if (clearcoat > 0.0) {
        float D_cc = D_GGX(dotNH, clearcoatRoughness);
        float G_cc = G_Kelemen(dotVH);
        vec3 F_cc = F_Schlick(dotVH, vec3(0.04));
        vec3 clearcoatSpecular = (D_cc * G_cc * F_cc) * clearcoat;
        directLight = directLight * (1.0 - clearcoat * F_cc.r) + clearcoatSpecular * radiance * dotNL;
    }

    if (sheenRoughness > 0.0 && (u_specColor.r > 0.0 || u_specColor.g > 0.0 || u_specColor.b > 0.0)) {
        float D_s = D_Charlie(dotNH, sheenRoughness);
        float V_s = V_Neubelt(dotNL, dotNV);
        vec3 sheenSpecular = u_specColor.rgb * (D_s * V_s);
        directLight += sheenSpecular * radiance * dotNL;
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
    vec3 F = F_Schlick(dotVH, F0);

    vec3 kS = F;
    vec3 kD = (vec3(1.0) - kS) * (1.0 - metallic);

    vec3 specular = (D * G * F) / (4.0 * dotNV * dotNL + 0.0001);
    vec3 directLight = (kD * albedo / 3.14159265359 + specular) * radiance * dotNL;

    if (clearcoat > 0.0) {
        float D_cc = D_GGX(dotNH, clearcoatRoughness);
        float G_cc = G_Kelemen(dotVH);
        vec3 F_cc = F_Schlick(dotVH, vec3(0.04));
        vec3 clearcoatSpecular = (D_cc * G_cc * F_cc) * clearcoat;
        directLight = directLight * (1.0 - clearcoat * F_cc.r) + clearcoatSpecular * radiance * dotNL;
    }

    if (sheenRoughness > 0.0 && (u_specColor.r > 0.0 || u_specColor.g > 0.0 || u_specColor.b > 0.0)) {
        float D_s = D_Charlie(dotNH, sheenRoughness);
        float V_s = V_Neubelt(dotNL, dotNV);
        vec3 sheenSpecular = u_specColor.rgb * (D_s * V_s);
        directLight += sheenSpecular * radiance * dotNL;
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

    float attenuation = 1.0 / (1.0 + 0.1 * dist + 0.01 * dist * dist);
    vec3 radiance = u_areaLightColor[i] * attenuation;

    float dotNL = max(dot(N, L), 0.0);
    float dotNH = max(dot(N, H), 0.0);
    float dotVH = max(dot(V, H), 0.0);

    float D = D_GGX(dotNH, roughness);
    float G = G_SchlickGGX(dotNL, dotNV, roughness);
    vec3 F = F_Schlick(dotVH, F0);

    vec3 kS = F;
    vec3 kD = (vec3(1.0) - kS) * (1.0 - metallic);

    vec3 specular = (D * G * F) / (4.0 * dotNV * dotNL + 0.0001);
    vec3 directLight = (kD * albedo / 3.14159265359 + specular) * radiance * dotNL;

    if (clearcoat > 0.0) {
        float D_cc = D_GGX(dotNH, clearcoatRoughness);
        float G_cc = G_Kelemen(dotVH);
        vec3 F_cc = F_Schlick(dotVH, vec3(0.04));
        vec3 clearcoatSpecular = (D_cc * G_cc * F_cc) * clearcoat;
        directLight = directLight * (1.0 - clearcoat * F_cc.r) + clearcoatSpecular * radiance * dotNL;
    }

    if (sheenRoughness > 0.0 && (u_specColor.r > 0.0 || u_specColor.g > 0.0 || u_specColor.b > 0.0)) {
        float D_s = D_Charlie(dotNH, sheenRoughness);
        float V_s = V_Neubelt(dotNL, dotNV);
        vec3 sheenSpecular = u_specColor.rgb * (D_s * V_s);
        directLight += sheenSpecular * radiance * dotNL;
    }

    Lo += directLight;
}

vec3 irradiance = u_ambientColor;
vec3 diffuseAmbient = irradiance * albedo;
vec3 specularAmbient = vec3(0.0);

if (u_useEnvMap > 0.5) {
    vec3 R = reflect(-V, N);
    // In WebGL1, textureCubeLod is not universally available without extension, 
    // so we just sample the base cubemap or let hardware handle mip-mapping.
    vec3 envColor = sRGBToLinear(textureCube(u_envMap, R).rgb);
    
    vec3 F_env = F_Schlick(dotNV, F0);
    specularAmbient = envColor * F_env;
}

// `specularAmbient` is already `vec3(0.0)` when there's no envMap, so this one formula covers
// both cases -- no need for a separate override that (until now) forgot the `(1.0 - metallic)`
// factor the envMap branch already applies, incorrectly brightening the diffuse response of
// metals with no envMap bound.
vec3 ambient = (diffuseAmbient * (1.0 - metallic) + specularAmbient) * ao;
vec3 color = ambient + Lo;

// Emissive
vec3 emissive = sRGBToLinear(texture2D(u_emissiveMap, v_uv).rgb) * sRGBToLinear(u_specColor.rgb) * u_specColor.a;
color += emissive;

color = color / (color + vec3(1.0));
color = linearToSRGB(color);

gl_FragColor = vec4(color, u_color.a * texColor.a);
if (gl_FragColor.a < u_extraParams.y) {
    discard;
}
