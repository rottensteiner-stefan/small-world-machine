      vec3 V = normalize(u_viewPos - v_worldPos);
      vec3 finalLight = u_ambientColor;
      vec3 specular = vec3(0.0);

      // Directional Light
      vec3 L_dir = normalize(u_dirLightDir);
      float diff_dir = max(dot(N, L_dir), 0.0);
      
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

          // Cascade blending: fade towards the next cascade near the far edge of this one, so
          // the hard resolution/frustum seam between cascades doesn't pop as the camera moves.
          float blendToNext = 0.0;
          if (cascadeIndex < numCascades - 1) {
              float splitFar = u_cascadeSplits[cascadeIndex];
              float blendBand = max(splitFar * 0.1, 0.0001);
              blendToNext = 1.0 - clamp((splitFar - depth) / blendBand, 0.0, 1.0);
          }

          // Normal-offset bias: push the sample point along the surface normal (scaled by
          // NdotL, so grazing angles -- where acne is worst -- get the biggest offset and
          // surfaces facing the light head-on get almost none) instead of only biasing depth.
          vec3 dirShadowSamplePos = v_worldPos + N * u_dirShadowInfo.y * (1.0 - diff_dir);
          float cols = ceil(sqrt(u_dirShadowInfo.w));
          float bias = u_dirShadowInfo.x;
          vec2 texelSize = 1.0 / vec2(textureSize(u_dirShadowMap, 0));

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

              // PCSS: (1) blocker search via the raw (non-comparison) depth read, averaging
              // occluders found within a search radius; (2) derive a penumbra size from how far
              // the receiver is behind those occluders; (3) PCF again with that variable radius.
              // Samples are clamped to this cascade's own atlas cell so a wide search radius
              // near a cell edge can't bleed into a neighboring cascade's texels.
              // Directional light only, not spot lights -- see docs/adr/0006-pcss-directional-light-only.md.
              const int pcssTaps = 8;
              vec2 searchOffsets[pcssTaps];
              searchOffsets[0] = vec2(-1.0, -1.0);
              searchOffsets[1] = vec2(0.0, -1.0);
              searchOffsets[2] = vec2(1.0, -1.0);
              searchOffsets[3] = vec2(-1.0, 0.0);
              searchOffsets[4] = vec2(1.0, 0.0);
              searchOffsets[5] = vec2(-1.0, 1.0);
              searchOffsets[6] = vec2(0.0, 1.0);
              searchOffsets[7] = vec2(1.0, 1.0);

              float searchRadiusTexels = 2.0;
              float avgBlockerDepth = 0.0;
              float blockerCount = 0.0;
              for (int s = 0; s < pcssTaps; s++) {
                  vec2 sampleUV = clamp(
                      atlasUV + searchOffsets[s] * texelSize * searchRadiusTexels,
                      cellMin, cellMax
                  );
                  float blockerDepth = texture(u_dirShadowMapRaw, sampleUV).r;
                  if (blockerDepth < currentDepth - bias) {
                      avgBlockerDepth += blockerDepth;
                      blockerCount += 1.0;
                  }
              }

              if (blockerCount < 1.0) {
                  shadowA = 1.0; // Nothing occluding within the search radius -- fully lit.
              } else {
                  avgBlockerDepth /= blockerCount;
                  // Penumbra grows with how many "bias-widths" deep the average occluder sits
                  // below the receiver. `bias` is already a scene/cascade-calibrated depth-slop
                  // unit in this same normalized shadow-map depth space, so reusing it as the
                  // scale keeps the softness estimate self-calibrating instead of hand-tuning a
                  // magic constant against normalized depth (whose world-unit meaning varies
                  // per cascade).
                  float occluderDepthDelta = currentDepth - avgBlockerDepth;
                  float pcfRadius = clamp(1.0 + occluderDepthDelta / max(bias, 0.0001), 1.0, 4.0);

                  shadowA = 0.0;
                  for(int x = -1; x <= 1; ++x) {
                      for(int y = -1; y <= 1; ++y) {
                          vec2 tapUV = clamp(atlasUV + vec2(x, y) * texelSize * pcfRadius, cellMin, cellMax);
                          shadowA += texture(u_dirShadowMap, vec3(tapUV, currentDepth - bias));
                      }
                  }
                  shadowA /= 9.0;
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

                  shadowB = 0.0;
                  for(int x = -1; x <= 1; ++x) {
                      for(int y = -1; y <= 1; ++y) {
                          shadowB += texture(u_dirShadowMap, vec3(atlasUVB + vec2(x, y) * texelSize, currentDepthB - bias));
                      }
                  }
                  shadowB /= 9.0;
              }
          }

          dirShadow = mix(shadowA, shadowB, blendToNext);
      }

      finalLight += diff_dir * u_dirLightColor * dirShadow;
      if (u_shininess > 0.0 && diff_dir > 0.0) {
        specular += pow(max(dot(V, reflect(-L_dir, N)), 0.0), u_shininess) * u_dirLightColor * dirShadow;
      }

      // Clustered light lookup -- see docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md.
      int clusterCellIndex = computeClusterCellIndex(u_viewPos, v_worldPos, u_clusterDims, u_cameraNearFar, u_tileSizePx);

      // Point Lights
      uvec2 pointCluster = fetchPointClusterGridEntry(clusterCellIndex);
      for(int k = 0; k < CLUSTER_MAX_LIGHTS; k++) {
        if (k >= int(pointCluster.y)) break;
        int i = int(fetchPointClusterLightIndex(int(pointCluster.x) + k));
        vec3 lightVec = u_pointLights[i].pos - v_worldPos;
        float dist = length(lightVec);
        
        // Compute attenuation
        float lightDistance = max(u_pointLights[i].distance, 0.001);
        float decay = u_pointLights[i].decay;
        
        // PBR physically based attenuation: 1 / (distance^2)
        // With smooth cutoff at max distance
        float distanceFalloff = 1.0 / max(dist * dist, 0.01);
        
        // Windowing function to zero out light at max distance (Unreal Engine 4 style)
        float distRatio = dist / lightDistance;
        float distRatio4 = distRatio * distRatio * distRatio * distRatio;
        float window = clamp(1.0 - distRatio4, 0.0, 1.0);
        float cutoff = window * window;
        
        // If decay is 0, we don't fall off physically, we just do linear/constant
        float attenuation = (decay > 0.0) ? (distanceFalloff * cutoff) : clamp(1.0 - dist / lightDistance, 0.0, 1.0);
        
        if (attenuation > 0.0) {
            vec3 L_pt = lightVec / dist;
            float diff_pt = max(dot(N, L_pt), 0.0);
            finalLight += diff_pt * u_pointLights[i].color * attenuation;
            if (u_shininess > 0.0 && diff_pt > 0.0) {
                specular += pow(max(dot(V, reflect(-L_pt, N)), 0.0), u_shininess) * u_pointLights[i].color * attenuation;
            }
        }
      }

      // Spot Lights
      uvec2 spotCluster = fetchSpotClusterGridEntry(clusterCellIndex);
      for(int k = 0; k < CLUSTER_MAX_LIGHTS; k++) {
        if (k >= int(spotCluster.y)) break;
        int i = int(fetchSpotClusterLightIndex(int(spotCluster.x) + k));
        vec3 lightVec = u_spotLights[i].pos - v_worldPos;
        float dist = length(lightVec);
        vec3 L_sp = lightVec / dist;
        vec3 S_dir = normalize(u_spotLights[i].dir);
        float theta = dot(-L_sp, S_dir);
        if(theta > u_spotLights[i].params.x) {
            float spotEffect = smoothstep(u_spotLights[i].params.x, u_spotLights[i].params.y, theta);
            float maxDist = u_spotLights[i].params.z;
            float decay = u_spotLights[i].params.w;
            if (maxDist > 0.0 && dist >= maxDist) continue;
            float attenuation = (maxDist > 0.0) ? pow(clamp(1.0 - dist / maxDist, 0.0, 1.0), decay) : (1.0 / (dist * dist + 0.0001));
            float diff_sp = max(dot(N, L_sp), 0.0);
            
            // Shadow Calculation
            // Pre-existing constraint, unrelated to clustering: only the first 4 spot lights (by
            // scene traversal order) ever get a real shadow slot/v_spotLightSpacePos entry -- i
            // beyond that already read out-of-bounds before clustering existed too.
            float shadow = 1.0;
            if (i < 4 && u_spotShadowInfo[i].z > 0.5) {
                vec3 projCoords = v_spotLightSpacePos[i].xyz / v_spotLightSpacePos[i].w;
                projCoords = projCoords * 0.5 + 0.5;
                if (projCoords.x >= 0.0 && projCoords.x <= 1.0 && projCoords.y >= 0.0 && projCoords.y <= 1.0 && projCoords.z <= 1.0) {
                    float bias = u_spotShadowInfo[i].x;
                    float currentDepth = projCoords.z;
                    shadow = 0.0;
                    vec2 texelSize;
                    if (i == 0) texelSize = 1.0 / vec2(textureSize(u_spotShadowMap[0], 0));
                    else if (i == 1) texelSize = 1.0 / vec2(textureSize(u_spotShadowMap[1], 0));
                    else if (i == 2) texelSize = 1.0 / vec2(textureSize(u_spotShadowMap[2], 0));
                    else texelSize = 1.0 / vec2(textureSize(u_spotShadowMap[3], 0));
                    
                    for(int x = -1; x <= 1; ++x) {
                        for(int y = -1; y <= 1; ++y) {
                            vec3 tCoord = vec3(projCoords.xy + vec2(x, y) * texelSize, currentDepth - bias);
                            if (i == 0) shadow += texture(u_spotShadowMap[0], tCoord);
                            else if (i == 1) shadow += texture(u_spotShadowMap[1], tCoord);
                            else if (i == 2) shadow += texture(u_spotShadowMap[2], tCoord);
                            else shadow += texture(u_spotShadowMap[3], tCoord);
                        }
                    }
                    shadow /= 9.0;
                }
            }

            finalLight += diff_sp * u_spotLights[i].color * attenuation * spotEffect * shadow;
            if (u_shininess > 0.0 && diff_sp > 0.0) {
                specular += pow(max(dot(V, reflect(-L_sp, N)), 0.0), u_shininess) * u_spotLights[i].color * attenuation * spotEffect * shadow;
            }
        }
      }

      // Area Lights
      for(int i = 0; i < 4; i++) {
        if (i >= u_numAreaLights) break;

        vec3 L_center = u_areaLights[i].pos;
        vec3 L_normal = normalize(u_areaLights[i].normal);
        vec3 dirFromLight = v_worldPos - L_center;

        if(dot(dirFromLight, L_normal) < 0.0) continue;

        vec3 L_right = normalize(u_areaLights[i].right);
        vec3 L_up = normalize(u_areaLights[i].up);
        vec2 size = u_areaLights[i].size;

        float projX = clamp(dot(dirFromLight, L_right), -size.x, size.x);
        float projY = clamp(dot(dirFromLight, L_up), -size.y, size.y);

        vec3 closestPoint = L_center + L_right * projX + L_up * projY;

        vec3 lightVec = closestPoint - v_worldPos;
        float dist = length(lightVec);
        vec3 L_al = lightVec / (dist + 0.0001);

        float maxDist = u_areaLights[i].params.x;
        float decay = u_areaLights[i].params.y;
        if (maxDist > 0.0 && dist >= maxDist) continue;
        float attenuation = (maxDist > 0.0) ? pow(clamp(1.0 - dist / maxDist, 0.0, 1.0), decay) : (1.0 / (1.0 + 0.1 * dist + 0.01 * dist * dist));
        float diff_al = max(dot(N, L_al), 0.0);

        finalLight += diff_al * u_areaLights[i].color * attenuation;
        if (u_shininess > 0.0 && diff_al > 0.0) {
            specular += pow(max(dot(V, reflect(-L_al, N)), 0.0), u_shininess) * u_areaLights[i].color * attenuation;
        }
      }
