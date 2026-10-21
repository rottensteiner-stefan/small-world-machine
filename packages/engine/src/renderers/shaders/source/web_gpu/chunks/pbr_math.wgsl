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
// penumbra size from the receiver/blocker depth GAP, in normalized (linear, cascades are
// orthographic) depth space. The radius is the perspective-normalized gap times the map texel
// count and a baked light-size coefficient -- so shadows read hard right at the contact line and
// progressively softer the farther a receiver sits from its occluder, instead of the legacy
// "1 + gap / depthBias" heuristic that (a) exploded against the tiny bias value, always saturating
// to the cap and bleeding dark everywhere, and (b) flipped direction run-to-run because it was
// numerically unstable near the cap; (3) PCF again with that variable radius.
//
// All taps are a fixed, deterministic sunflower disk, so the result is stable frame-to-frame.
// The softness knobs (shadowSoftness.x = penumbra scale, shadowSoftness.y = radius cap in texels)
// still scale the principled estimate; the depth `bias` param remains solely the acne/peter-pan
// guard and no longer couples into the penumbra width.
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

    // Sunflower (low-discrepancy) unit-disk offsets; scaled by SEARCH_TEXELS for the blocker disk.
    let searchOffsets = array<vec2f, 16>(
        vec2f(0.0000, 0.0000),
        vec2f(-0.1843, 0.1689),
        vec2f(0.0309, -0.3522),
        vec2f(0.2635, 0.3436),
        vec2f(-0.4924, -0.0871),
        vec2f(0.4717, -0.3000),
        vec2f(-0.1590, 0.5914),
        vec2f(-0.3049, -0.5870),
        vec2f(0.6642, 0.2426),
        vec2f(-0.6933, 0.2862),
        vec2f(0.3351, -0.7160),
        vec2f(0.2482, 0.7912),
        vec2f(-0.7493, -0.4342),
        vec2f(0.8804, -0.1935),
        vec2f(-0.5380, 0.7652),
        vec2f(-0.1244, -0.9602),
    );
    // Search disk radius in shadow-map texels. 8 covers near and far penumbra alike without
    // sampling half the map; fully lit fragments leave early below (blockerCount < 1).
    //
    // Deliberate design decisions (7d review A14, see ADR 0006 / docs/shadows.md):
    // - FIXED sunflower disk, no per-pixel rotation (interleaved gradient noise): the search is
    //   deterministic by contract (bit-identical frames, gated by check-swm42*.mjs); rotation
    //   would trade that for noise that only TAA hides. Kept fixed.
    // - searchTexels stays a constant: it equals the reach of the default PCF cap (1.5 * 4 texels
    //   < 8); shadowSoftness.z remains reserved rather than becoming an unused knob.
    // - Spot maps (perspective): ndc.z is hyperbolic in view depth, so `radial` below shrinks for
    //   distant receivers and the penumbra reads harder than for the ortho cascades. That errs
    //   toward a sharper (never leakier) shadow; linearizing needs the spot near/far, which no
    //   uniform lane carries yet (spotShadowInfo is full) -- a struct growth, not a shader tweak.
    let searchTexels = 8.0;

    var avgBlockerDepth: f32 = 0.0;
    var blockerCount: f32 = 0.0;
    for (var s = 0; s < 16; s++) {
        let offsetCoord = searchOffsets[s] * searchTexels;
        let coord = clamp(
            centerCoord + vec2i(i32(offsetCoord.x), i32(offsetCoord.y)),
            vec2i(0, 0),
            maxCoord,
        );
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

    // Principled penumbra width in texels: the perspective-normalized receiver/blocker gap,
    // scaled to the map's texel count and a baked light-size coefficient. Contact (gap ~ 0)
    // stays hard; the more the receiver recedes from its occluder along the light ray, the
    // wider the soft band reads. `penumbraScale` rescales it; `maxRadius` remains the ceiling.
    let dz = max(depthRef - avgBlockerDepth, 0.0);
    let radial = dz / max(depthRef, 0.00001);
    let pcfRadius = clamp(
        1.0 + radial * f32(dims.x) * 0.12 * global.shadowSoftness.x,
        1.0,
        max(global.shadowSoftness.y, 1.0),
    );

    var shadow: f32 = 0.0;
    for (var y: i32 = -1; y <= 1; y++) {
        for (var x: i32 = -1; x <= 1; x++) {
            let offset = vec2f(f32(x), f32(y)) * texelSize * pcfRadius;
            shadow += textureSampleCompareLevel(map, samp, uv + offset, layer, depthRef);
        }
    }
    return shadow / 9.0;
}

