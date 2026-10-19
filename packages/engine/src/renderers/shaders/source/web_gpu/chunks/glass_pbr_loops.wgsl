    // Directional Light
    {
        let L = normalize(global.dirLightDir.xyz);
        let H = normalize(V + L);
        let dotNL = max(dot(N, L), 0.0);
        let dotNH = max(dot(N, H), 0.0);
        let dotVH = max(dot(V, H), 0.0);
        let radiance = global.dirLightColor.xyz;

        let D = D_GGX(dotNH, roughness);
        let G = G_SchlickGGX(dotNL, dotNV, roughness);
        let F = F_Schlick(dotVH, F0);

        let kS = F;
        let kD = (vec3f(1.0) - kS) * (1.0 - metallic);
        let specular = (D * G * F) / (4.0 * dotNV * dotNL + 0.0001);
        Lo += (kD * tintColor / 3.14159265359 + specular) * radiance * dotNL;
    }

    // Point Lights
    for(var j=0u; j<u32(global.numPointLights); j++) {
        let lightVec = pLights[j].pos.xyz - i.wp;
        let dist = length(lightVec);
        let L = lightVec / dist;
        let H = normalize(V + L);
        let attenuation = 1.0 / (dist * dist + 0.0001);
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
    for(var k=0u; k<u32(global.numSpotLights); k++) {
        let lightVec = sLights[k].pos.xyz - i.wp;
        let dist = length(lightVec);
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
        let distanceAttenuation = select(1.0 / (dist * dist + 0.0001), pow(clamp(1.0 - dist / maxDist, 0.0, 1.0), decay), maxDist > 0.0);
        let radiance = sLights[k].col.xyz * distanceAttenuation * spotIntensity;

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