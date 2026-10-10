// WGSL Lighting calculation (Logic only)

// IMPORTANT: Re-normalize interpolated normal in fragment shader!
let N = normalize(i.n);
let V = normalize(global.viewPos.xyz - i.wp); 
var fL = global.ambientColor.xyz; 
var spec = vec3f(0.0);

// Directional Light
let L_dir = normalize(global.dirLightDir.xyz);
let diff_dir = max(dot(N, L_dir), 0.0);
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

        // Cascade blending: fade towards the next cascade near the far edge of this one, so
        // the hard resolution/frustum seam between cascades doesn't pop as the camera moves.
        var blendToNext: f32 = 0.0;
        if (cascadeIndex + 1u < numCascades) {
            let splitFar = global.cascadeSplits[cascadeIndex];
            let blendBand = max(splitFar * 0.1, 0.0001);
            blendToNext = 1.0 - clamp((splitFar - viewDist) / blendBand, 0.0, 1.0);
        }

        // Normal-offset bias, scaled by NdotL so grazing angles get the biggest offset.
        let dirShadowSamplePos = i.wp + N * global.dirShadowInfo.y * (1.0 - diff_dir);
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

    fL += diff_dir * global.dirLightColor.xyz * shadow;
    if (obj.shininess > 0.0 && diff_dir > 0.0) { 
        spec += pow(max(dot(V, reflect(-L_dir, N)), 0.0), obj.shininess) * global.dirLightColor.xyz * shadow; 
    }

// Clustered light lookup -- see docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md.
// Same cell coordinates ClusterCullPassGPU used to fill pointClusterGrid/spotClusterGrid.
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
  let lVec = pLights[j].pos.xyz - i.wp;
  let d = length(lVec); 
  
  let lDist = max(pLights[j].pos.w, 0.001);
  let decay = pLights[j].col.w;
  
  let distFalloff = 1.0 / max(d * d, 0.01);
  let distRatio = d / lDist;
  let distRatio4 = distRatio * distRatio * distRatio * distRatio;
  let window = clamp(1.0 - distRatio4, 0.0, 1.0);
  let cutoff = window * window;
  
  var atten = clamp(1.0 - d / lDist, 0.0, 1.0);
  if (decay > 0.0) {
      atten = distFalloff * cutoff;
  }
  
  if (atten > 0.0) {
      let L = lVec/max(d, 0.0001);
      let diff = max(dot(N, L), 0.0); 
      fL += diff * pLights[j].col.xyz * atten;
      if (obj.shininess > 0.0 && diff > 0.0) { 
        spec += pow(max(dot(V, reflect(-L, N)), 0.0), obj.shininess) * pLights[j].col.xyz * atten; 
      }
  }
}

// Spot Lights
let spotCluster = spotClusterGrid[clusterCellIndex];
for(var k=0u; k<spotCluster.y; k++) {
  let j = spotClusterIndices[spotCluster.x + k];
  let lVec = sLights[j].pos.xyz - i.wp;
  let d = length(lVec); 
  let L = lVec / max(d, 0.0001); 
  let S = normalize(sLights[j].dir.xyz); 
  let theta = dot(-L, S);
  if(theta > sLights[j].params.x) {
    let sEff = smoothstep(sLights[j].params.x, sLights[j].params.y, theta);
    let maxDist = sLights[j].params.z;
    let decay = sLights[j].params.w;
    if (maxDist > 0.0 && d >= maxDist) { continue; }
    let atten = select(1.0 / (d * d + 0.0001), pow(clamp(1.0 - d / maxDist, 0.0, 1.0), decay), maxDist > 0.0);
    let diff = max(dot(N, L), 0.0);
    var shadow: f32 = 1.0;
    // Pre-existing constraint, unrelated to clustering: only the first 4 spot lights (by scene
    // traversal order) ever get a real shadow map slot -- j beyond that clamps in these
    // fixed-size-4 arrays. Clustering doesn't change which lights get shadows, only which ones
    // reach this loop body at all for a given fragment.
    if (j < 4u && global.spotShadowInfo[j].z > 0.5) {
        let shadowPos = global.spotShadowMatrices[j] * vec4f(i.wp + N * global.spotShadowInfo[j].y * (1.0 - diff), 1.0);
        shadow = getShadowPCSS(u_spotShadowMap, shadowSampler, shadowPos, j, global.spotShadowInfo[j].x);
    }
    
    fL += diff * sLights[j].col.xyz * atten * sEff * shadow;
    if (obj.shininess > 0.0 && diff > 0.0) { 
        spec += pow(max(dot(V, reflect(-L, N)), 0.0), obj.shininess) * sLights[j].col.xyz * atten * sEff * shadow; 
    }
  }
}

// Area Lights
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

    let maxDist = aLights[j].size.z;
    let decay = aLights[j].size.w;
    if (maxDist > 0.0 && dist >= maxDist) { continue; }
    let atten = select(1.0 / (1.0 + 0.1*dist + 0.01*dist*dist), pow(clamp(1.0 - dist / maxDist, 0.0, 1.0), decay), maxDist > 0.0);
    let diff = max(dot(N, L), 0.0);

    fL += diff * aLights[j].col.xyz * atten;
    if (obj.shininess > 0.0 && diff > 0.0) {
        spec += pow(max(dot(V, reflect(-L, N)), 0.0), obj.shininess) * aLights[j].col.xyz * atten;
    }
}
