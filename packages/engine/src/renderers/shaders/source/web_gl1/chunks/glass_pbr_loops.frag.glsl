    // --- Directional Light ---
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
    Lo += (kD * tintColor / 3.14159265359 + specular) * radiance * dotNL;

    // --- Point Lights ---
    for(int i = 0; i < 4; i++) {
        if (i >= u_numPointLights) break;
        vec3 lightVec = u_pointLightPos[i] - v_worldPos;
        float dist = length(lightVec);
        vec3 L_p = normalize(lightVec);
        vec3 H_p = normalize(V + L_p);

        float attenuation = 1.0 / (dist * dist + 0.0001);
        vec3 pRadiance = u_pointLightColor[i] * attenuation;

        float pDotNL = max(dot(N, L_p), 0.0);
        float pDotNH = max(dot(N, H_p), 0.0);
        float pDotVH = max(dot(V, H_p), 0.0);

        float pD = D_GGX(pDotNH, roughness);
        float pG = G_SchlickGGX(pDotNL, dotNV, roughness);
        vec3 pF = F_Schlick(pDotVH, F0);

        vec3 pkS = pF;
        vec3 pkD = (vec3(1.0) - pkS) * (1.0 - metallic);
        vec3 pSpecular = (pD * pG * pF) / (4.0 * dotNV * pDotNL + 0.0001);
        Lo += (pkD * tintColor / 3.14159265359 + pSpecular) * pRadiance * pDotNL;
    }

    // --- Spot Lights ---
    for(int i = 0; i < 4; i++) {
        if (i >= u_numSpotLights) break;
        vec3 lightVec = u_spotLightPos[i] - v_worldPos;
        float dist = length(lightVec);
        vec3 L_s = normalize(lightVec);
        vec3 H_s = normalize(V + L_s);

        vec3 spotDir = normalize(u_spotLightDir[i]);
        float cosOuter = u_spotLightParams[i].x;
        float cosInner = u_spotLightParams[i].y;
        float maxDist = u_spotLightParams[i].z;
        float decay = u_spotLightParams[i].w;

        float theta = dot(-L_s, spotDir);
        float epsilon = max(cosInner - cosOuter, 0.0001);
        float intensity = clamp((theta - cosOuter) / epsilon, 0.0, 1.0);

        if (intensity > 0.0 && dist < maxDist) {
            float distanceAttenuation = pow(clamp(1.0 - dist / maxDist, 0.0, 1.0), decay);
            float attenuation = distanceAttenuation * intensity;
            vec3 sRadiance = u_spotLightColor[i] * attenuation;

            float sDotNL = max(dot(N, L_s), 0.0);
            float sDotNH = max(dot(N, H_s), 0.0);
            float sDotVH = max(dot(V, H_s), 0.0);

            float sD = D_GGX(sDotNH, roughness);
            float sG = G_SchlickGGX(sDotNL, dotNV, roughness);
            vec3 sF = F_Schlick(sDotVH, F0);

            vec3 skS = sF;
            vec3 skD = (vec3(1.0) - skS) * (1.0 - metallic);
            vec3 sSpecular = (sD * sG * sF) / (4.0 * dotNV * sDotNL + 0.0001);
            Lo += (skD * tintColor / 3.14159265359 + sSpecular) * sRadiance * sDotNL;
        }
    }