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

// ── EVSM (Exponential Variance Shadow Maps) ────────────────────────────────────────────────
// ADR 0007. Produced in the Filament line (surface_shadowing.fs evaluateEVSM / chebyshevUpperBound):
// the umbra proof is a one-tailed Chebyshev bound on exponentially warped depth, hardened by a
// DYNAMIC min-variance floor (chain rule of the warp -- a flat floor is wrong because the warp
// expands variance enormously) and by Light-Bleeding-Reduction (LBR). Two warped VSMs are combined
// with min(pos, neg) to kill the far-depth single-sided leak. Getting the LBR remap order wrong or
// applying a flat bias here is the classic leak/acne failure; everything below intentionally
// mirrors Filament's terms 1:1 (only the tap pattern is simplified from their LOD-based EVSSM).
//
// Precondition: the moment texture (`u_dirEvsmMap`) stores (e^{c·d}, e^{2c·d}, -e^{-c·d}, e^{-2c·d})
// for the SAME remap d = ndc.z * 2 - 1 and c = 40 as EvsmMoment.frag.wgsl; the writer stores those
// values from the depth pass's rasterized [0,1] depth. `ndc.z` below is that receiver depth in the
// same [0,1] space, so both sides warp identically.

fn chebyshevUpperBoundEVSM(m1: f32, m2: f32, depth: f32) -> f32 {
    // Fast path: receiver fully in front of the filtered caster mean -- no possible occlusion.
    if (depth <= m1) {
        return 1.0;
    }
    // Dynamic variance floor: epsilon * (warpedDepth)^2 (Filament EPSILON_MULTIPLIER 0.002),
    // scaled by the SAME warped mean used by the bound. Replaces the depth bias in EVSM.
    let variance = max(m2 - m1 * m1, global.evsmParams.y * m1 * m1);
    let d = depth - m1;
    let pMax = variance / max(variance + d * d, 1e-7);
    // Light Bleeding Reduction: remap [lbrAmount, 1] onto [0, 1] (Filament chebyshevUpperBound).
    let lbrAmount = clamp(global.evsmParams.z, 0.0, 0.999);
    return clamp((pMax - lbrAmount) / max(1.0 - lbrAmount, 1e-7), 0.0, 1.0);
}

// Texture-sample-free EVSM evaluator. Taps are fetched with `textureLoad`, NOT `textureSample`, for
// two hard WebGPU reasons: (1) the moment map is rgba32float -- unfilterable by default, so a
// "float" (filterable) binding is invalid and only works where float32-filterable is enabled;
// texel loads ignore filtering entirely and bind as "unfilterable-float" on every device; and
// (2) this function runs inside the per-fragment cascade-selection control flow (its condition
// depends on the interpolated world position), and `textureSample` is only legal in UNIFORM
// control flow -- depth-compare sampling (getShadowPCSS/getShadowPCF) is exempt, regular texture
// sampling is not. Texel loads are legal in non-uniform flow, so this works everywhere without a
// filterable sampler or the float32-filterable feature. The 9-tap box (instead of one hardware
// bilinear fetch) is the same author-controlled moment smearing on both APIs.
fn getEVSM(map: texture_2d_array<f32>, shadowPos: vec4f, layer: u32) -> f32 {
    let ndc = shadowPos.xyz / shadowPos.w;
    let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);

    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || ndc.z > 1.0 || ndc.z < 0.0) {
        return 1.0;
    }

    let zReceiver = ndc.z;
    // Same remap + warp as the moment writer (2.7.4.1 & EvsmMoment.frag.wgsl).
    let depth = clamp(zReceiver * 2.0 - 1.0, -1.0, 1.0);
    let c = 40.0;
    let pw = exp(c * depth);
    let nw = -1.0 / pw;

    // Filter the moments (not the visibility): averaging warped moments is the only mathematically
    // sound smearing for VSM/EVSM (see docs/shaders.md / ADR 0007). A 3x3 box scaled by the same
    // PCSS radius cap gives a modest, stable penumbra. Each array layer is one full cascade map
    // (no atlas cell to bleed into), so taps only clamp to the texture bounds.
    let dims = vec2u(textureDimensions(map));
    let dimsF = vec2f(dims);
    let radius = max(global.shadowSoftness.y, 1.0);
    var acc = vec4f(0.0);
    for (var ty: i32 = -1; ty <= 1; ty++) {
        for (var tx: i32 = -1; tx <= 1; tx++) {
            let tapUV = clamp(
                uv + vec2f(f32(tx), f32(ty)) / dimsF * radius,
                vec2f(0.0),
                vec2f(1.0),
            );
            let tapTexel = min(vec2u(tapUV * dimsF), dims - vec2u(1));
            acc += textureLoad(map, tapTexel, layer, 0u);
        }
    }
    let moments = acc / 9.0;

    let p = chebyshevUpperBoundEVSM(moments.x, moments.y, pw);
    let n = chebyshevUpperBoundEVSM(moments.z, moments.w, nw);
    return min(p, n);
}

// Directional-shadow dispatchers: `evsmParams.x > 0.5` switches every directional sampling call
// site (main + PBR + glass + liquid dir_shadow) onto the EVSM moment path in one place. There are
// TWO dispatchers on purpose: the main-cascade sample (A) historically used PCSS, the
// cascade-blend sample (B) deliberately stayed on fixed PCF (ADR 0006 -- avoids doubling the
// blocker-search cost in the blend band). Routing both through one dispatcher would have silently
// changed the default pcss path in the blend band and broken the byte-identical gates; so each
// dispatcher's pcss branch re-invokes EXACTLY the function its call site used before (main ->
// getShadowPCSS, blend -> getShadowPCF), and the EVSM branch is identical for both. Static scenes
// and the box/pole gates stay byte-identical because the default mode is PCSS (all EVSM code is
// dead until an author opts in via quality.shadowMode -- ADR 0035 override-lock).
fn getShadowDirMain(map: texture_depth_2d_array, samp: sampler_comparison, shadowPos: vec4f, layer: u32, bias: f32) -> f32 {
    if (global.evsmParams.x > 0.5) {
        return getEVSM(u_dirEvsmMap, shadowPos, layer);
    }
    return getShadowPCSS(map, samp, shadowPos, layer, bias);
}

fn getShadowDirBlend(map: texture_depth_2d_array, samp: sampler_comparison, shadowPos: vec4f, layer: u32, bias: f32) -> f32 {
    if (global.evsmParams.x > 0.5) {
        return getEVSM(u_dirEvsmMap, shadowPos, layer);
    }
    return getShadowPCF(map, samp, shadowPos, layer, bias);
}

