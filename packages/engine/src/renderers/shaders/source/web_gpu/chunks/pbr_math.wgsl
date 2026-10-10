fn D_GGX(dotNH: f32, roughness: f32) -> f32 {
    let a = roughness * roughness;
    let a2 = a * a;
    let denom = (dotNH * dotNH * (a2 - 1.0) + 1.0);
    return a2 / (3.14159265359 * denom * denom);
}

fn G_SchlickGGX(dotNL: f32, dotNV: f32, roughness: f32) -> f32 {
    let r = (roughness + 1.0);
    let k = (r * r) / 8.0;
    let GL = dotNL / (dotNL * (1.0 - k) + k);
    let GV = dotNV / (dotNV * (1.0 - k) + k);
    return GL * GV;
}

fn F_Schlick(cosTheta: f32, F0: vec3f) -> vec3f {
    let x = clamp(1.0 - cosTheta, 0.0, 1.0);
    let x2 = x * x;
    return F0 + (1.0 - F0) * (x2 * x2 * x);
}

fn F_SchlickRoughness(cosTheta: f32, F0: vec3f, roughness: f32) -> vec3f {
    let x = clamp(1.0 - cosTheta, 0.0, 1.0);
    let x2 = x * x;
    return F0 + (max(vec3f(1.0 - roughness), F0) - F0) * (x2 * x2 * x);
}

fn linearToSRGB(color: vec3f) -> vec3f {
    return pow(color, vec3f(1.0 / global.gamma));
}

fn sRGBToLinear(color: vec3f) -> vec3f {
    return pow(color, vec3f(global.gamma));
}

fn D_Charlie(dotNH: f32, roughness: f32) -> f32 {
    let alpha = max(roughness * roughness, 0.000001);
    let invAlpha = 1.0 / alpha;
    let cos2h = dotNH * dotNH;
    let sin2h = max(1.0 - cos2h, 0.0078125);
    return (2.0 + invAlpha) * pow(sin2h, invAlpha * 0.5) / (2.0 * 3.14159265359);
}

fn V_Neubelt(dotNL: f32, dotNV: f32) -> f32 {
    return 1.0 / (4.0 * (dotNL + dotNV - dotNL * dotNV) + 0.0001);
}

fn G_Kelemen(dotVH: f32) -> f32 {
    return 0.25 / (dotVH * dotVH + 0.0001);
}

fn VolumeAbsorption(attenuationColor: vec3f, attenuationDistance: f32, thickness: f32) -> vec3f {
    if (attenuationDistance <= 0.0 || attenuationDistance >= 999.0) {
        return vec3f(1.0);
    }
    let sigma_a = -log(clamp(attenuationColor, vec3f(0.001), vec3f(1.0))) / attenuationDistance;
    return exp(-sigma_a * thickness);
}


fn getShadowPCF(map: texture_depth_2d_array, samp: sampler_comparison, shadowPos: vec4f, layer: u32, bias: f32) -> f32 {
    let ndc = shadowPos.xyz / shadowPos.w;
    let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
    
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || ndc.z > 1.0 || ndc.z < 0.0) {
        return 1.0;
    }
    
    let depthRef = ndc.z - bias;
    var shadow: f32 = 0.0;
    
    // Get texture dimensions for the specific mip level (level 0)
    let dims = textureDimensions(map);
    let texelSize = vec2f(1.0 / f32(dims.x), 1.0 / f32(dims.y));
    
    for (var y: i32 = -1; y <= 1; y++) {
        for (var x: i32 = -1; x <= 1; x++) {
            let offset = vec2f(f32(x), f32(y)) * texelSize;
            shadow += textureSampleCompareLevel(map, samp, uv + offset, layer, depthRef);
        }
    }
    return shadow / 9.0;
}

// PCSS: (1) blocker search via textureLoad -- an exact texel fetch straight off the same depth
// texture already bound for comparison sampling, no separate raw-depth binding needed, unlike
// WebGL2 where TEXTURE_COMPARE_MODE is baked onto the texture object itself; (2) derive a
// penumbra size from how far the receiver sits below those occluders, scaled relative to
// `bias` (already a scene/cascade-calibrated depth-slop unit in this same normalized depth
// space, so it keeps the softness estimate self-calibrating instead of a magic constant with a
// world-unit meaning that varies per cascade); (3) PCF again with that variable radius.
fn getShadowPCSS(map: texture_depth_2d_array, samp: sampler_comparison, shadowPos: vec4f, layer: u32, bias: f32) -> f32 {
    let ndc = shadowPos.xyz / shadowPos.w;
    let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);

    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || ndc.z > 1.0 || ndc.z < 0.0) {
        return 1.0;
    }

    let depthRef = ndc.z - bias;
    let dims = textureDimensions(map);
    let texelSize = vec2f(1.0 / f32(dims.x), 1.0 / f32(dims.y));
    let layerI = i32(layer);
    let maxCoord = vec2i(dims) - vec2i(1, 1);
    let centerCoord = vec2i(uv * vec2f(dims));

    let searchOffsets = array<vec2i, 8>(
        vec2i(-2, -2), vec2i(0, -2), vec2i(2, -2),
        vec2i(-2, 0), vec2i(2, 0),
        vec2i(-2, 2), vec2i(0, 2), vec2i(2, 2),
    );
    var avgBlockerDepth: f32 = 0.0;
    var blockerCount: f32 = 0.0;
    for (var s = 0; s < 8; s++) {
        let coord = clamp(centerCoord + searchOffsets[s], vec2i(0, 0), maxCoord);
        let blockerDepth = textureLoad(map, coord, layerI, 0);
        if (blockerDepth < depthRef) {
            avgBlockerDepth += blockerDepth;
            blockerCount += 1.0;
        }
    }

    if (blockerCount < 1.0) {
        return 1.0;
    }
    avgBlockerDepth /= blockerCount;
    let occluderDepthDelta = depthRef - avgBlockerDepth;
    let pcfRadius = clamp(1.0 + occluderDepthDelta / max(bias, 0.0001), 1.0, 4.0);

    var shadow: f32 = 0.0;
    for (var y: i32 = -1; y <= 1; y++) {
        for (var x: i32 = -1; x <= 1; x++) {
            let offset = vec2f(f32(x), f32(y)) * texelSize * pcfRadius;
            shadow += textureSampleCompareLevel(map, samp, uv + offset, layer, depthRef);
        }
    }
    return shadow / 9.0;
}

