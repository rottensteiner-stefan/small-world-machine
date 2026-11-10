// Pulled-draw module for the instance-field GPU lane (ADR 0059 step 1, P1-2). Runtime assembly:
//   renderer.computeStructsChunk()   // group(0)-only structs -> `global` (and the `ViewUniforms`
//                                    // STRUCT -- the group-0-only split stops before the material
//                                    // `@group(1)` bindings and before the SHARED `@group(3) view`
//                                    // binding of structs.wgsl, so the struct is in scope while
//                                    // the binding is not)
//   + chunks/instance_field_structs.wgsl  // shared @group(2) field-data declarations (FieldInfo /
//                                    // CullParams structs + 11 bindings, single source)
//   + this file
// giving `@group(0)` (GlobalUniforms) and the frozen `@group(2)` field-data slot. This file only
// adds the field-owned per-view uniform at `@group(3)` (`view.vp`), bound by the renderer to the
// same per-draw view-slot buffer every shared material shader uses -- group 3 slot/layout stay
// the engine's; only the module-side declaration is this module's (the shared one lives behind a
// `@group(1)`-gated region of structs.wgsl, see above). Group 1 is deliberately absent (null in
// the pipeline layout): this module declares no material bindings.
//
// INSTANCE STREAM IS PULLED FROM STORAGE, NOT VERTEX-BUFFERED: the per-vertex mesh attributes
// stay on the standard vertex buffers (slots 0/2, matching GPUPipelineCache's layout), while the
// per-instance transform stream moves entirely into `fieldVisibleIndices` + `fieldRecords`
// (storage reads, group 2). The draw layer records one `drawIndexedIndirect` per (view x bucket)
// segment with `baseInstance = 0`; the vertex resolves `recordIndex =
// visibleIndices[pageBase(bv) + instance_index]` via the dynamic-offset `cullParams.segmentBase`
// (P1: bucket 0, so `bv == segmentBase`) -- no `indirect-first-instance` dependency.
//
// The pass that hosts a field draw MUST already have bound group 0 (each hosting pass binds the
// pass-appropriate global group -- the dummy-referencing snapshot inside shadow passes -- and the
// field draw never re-binds it, so a cascade layer is never sampled while written).
//
// Record decode is the frozen bit layout (INSTANCE_POSE_BITS): yaw = packed[15:0] / 0xFFFF * 2pi
// around world +Y (toward +Z), uniformScale = packed[31:16] / 256. Bit-identical to the CPU
// packer `packInstancePose` and to the cull unpack (Bob D-1 drift guard).

// The compute structs chunk provides the `ViewUniforms` STRUCT but stops before the shared
// `@group(3) view` binding (structs.wgsl); this module declares the binding on its own slot-3
// group -- the renderer binds the very same per-draw view buffer behind it.
@group(3) @binding(0) var<uniform> view: ViewUniforms;

// Stage-specific binding 3 of the field group (see instance_field_structs.wgsl): the vertex stage
// may only read storage (`read-only-storage` in the draw layout).
@group(2) @binding(3) var<storage, read> fieldVisibleIndices: array<u32>; // pages [bv * pageCapacity, +cap)

// P2 LOD-blend pages (ADR 0059 step 2), per-consumer declaration of slot 11 (see
// instance_field_structs.wgsl visibility contract; the cull declares its own write on this slot in
// instance_cull.wgsl, the binding-2/3 pattern). Page-indexed EXACTLY like `fieldVisibleIndices`
// ([bv * pageCapacity + slot]); per-slot signed value [CONTRACT veg-p2-bob, published 2026-11-09:
//   +p (0 < p < 1) = FINE-side entry of a crossfade band pair (fades out)
//   -p (0 < p < 1) = COARSE-side entry (fades in)
//   both magnitudes |p| = the SHARED crossfade position between the two buckets: the pair's two
//   slots carry the SAME |p| at any band state -- this is what makes the two draws' kept pixels
//   an exact partition (see `fieldLodDitherDiscard`, complementary-by-construction).
//   0            = settled (single-write outside any band) / unwritten zero-filled slot: keep all.
// The buffer is zero-filled at creation (InstanceFieldSystem); the cull rewrites live records.
@group(2) @binding(11) var<storage, read> fieldLodBlend: array<f32>;

struct FieldVertOut {
    @builtin(position) pos: vec4f,
    @location(0) wp: vec3f,
    @location(1) uv: vec2f,
    @location(2) n: vec3f,
    // Linear albedo (rgb) + foliage/transmission mask (a), from the vertex colour stream.
    @location(3) color: vec4f,
    // Per-instance albedo variation (position hash), constant across the instance.
    @location(4) @interpolate(flat) tint: f32,
    // P2 LOD-mix channel: signed per-(segment x slot) crossfade position forwarded from the
    // record page (see `fieldLodBlend`); 0 = settled/unwritten (keep always). Flat: one decision
    // per instance, never perspective-smoothed across a plant.
    @location(5) @interpolate(flat) lodBlend: f32,
}

// Optional alpha-cutout gate for the pulled fragments (P1 early-Z conservatism): when the field
// has an authored alpha map + threshold, theta fragments discard like DepthMaterial's alpha
// groups; without a map the white fallback never discards.
fn fieldAlphaDiscard(uv: vec2f) {
    if (fieldInfo.alphaTest > 0.0) {
        let a = textureSample(u_fieldAlphaMap, fieldAlphaSampler, uv).a;
        if (a < fieldInfo.alphaTest) {
            discard;
        }
    }
}

// Stable per-instance tint variation derived from the instance position hash (ADR 0059: tint is
// derived in the shader, never stored); evaluated once per instance in the vertex stage.
fn fieldPositionHash(center: vec3f) -> u32 {
    var h = bitcast<u32>(center.x) ^ (bitcast<u32>(center.y) * 0x1f123bb5u) ^ (bitcast<u32>(center.z) * 0x860aa977u);
    h = ((h >> 16u) ^ h) * 0x45d9f3bu;
    h = ((h >> 16u) ^ h) * 0x45d9f3bu;
    return (h >> 16u) ^ h;
}

// ── Shared wind field (ADR 0059 step 1b) ─────────────────────────────────────────────────────
// Injected from the canonical `vegetation-extras` wind chunk via the `WIND_FIELD_FUNCS` registry
// id (functions only -- the `SwmWind` struct this module needs is already declared by the
// instance-field structs chunk; WGSL forbids duplicate module-scope structs). Single source: the
// same code every other wind consumer compiles, so trees move coherently across all field lanes.
// CPU mirror: `vegetation-extras` `WindField` (its `uniforms` array is the producer of
// `fieldInfo.wind`).
[WIND_FIELD_FUNCS]

// Pulled geometry transform: world instance position + yaw-around-Y + uniform scale, then the
// per-draw view-projection. The normal rotates with the yaw (uniform scale needs no inverse
// transpose). Every bucket geometry binds all four streams: the system completes missing normals
// (world up), uvs (zero) and colours (white, mask 1) once at setup, so one pipeline serves all.
fn fieldPullVertex(
    localPos: vec3f,
    localNormal: vec3f,
    uv: vec2f,
    color: vec4f,
    instanceIndex: u32,
) -> FieldVertOut {
    var o: FieldVertOut;
    // Clamp-at-capacity: the indirect count is the raw atomic cursor; an instance past the page
    // has no index -- emit a clipped vertex instead of reading a foreign page.
    if (instanceIndex >= fieldInfo.pageCapacity) {
        o.pos = vec4f(0.0, 0.0, 2.0, 1.0);
        o.wp = vec3f(0.0);
        o.uv = vec2f(0.0);
        o.n = vec3f(0.0, 1.0, 0.0);
        o.color = vec4f(0.0);
        o.tint = 1.0;
        o.lodBlend = 0.0;
        return o;
    }
    let bv = cullParams.segmentBase;
    let recordIndex = fieldVisibleIndices[bv * fieldInfo.pageCapacity + instanceIndex];
    let record = fieldRecords[recordIndex];
    let packed = bitcast<u32>(record.w);
    let yawWord = packed & 0xFFFFu;
    let yaw = (f32(yawWord) / 65535.0) * 6.283185307179586;
    let scaleWord = packed >> 16u;
    let scale = f32(scaleWord) * (1.0 / 256.0);

    let c = cos(yaw);
    let s = sin(yaw);
    let rotated = vec3f(c * localPos.x - s * localPos.z, localPos.y, s * localPos.x + c * localPos.z) * scale;
    let rootNormal = vec3f(c * localNormal.x - s * localNormal.z, localNormal.y, s * localNormal.x + c * localNormal.z);
    var worldPos = record.xyz + rotated;
    // Right-handed world space: +X right, +Y up, +Z backward -- yaw is around world +Y.
    // Shared wind field (ADR 0059 step 1b): per-instance lean from the root position hash
    // (travelling gust waves, calm phases, vertical profile via `windHeight`), quadratic bend
    // profile keeps the base planted and the crown leaning. `fieldInfo.windHeight` (crown top
    // at scale 1) is the master switch -- 0 = static field (fail-closed). Shelter is a constant
    // 0 in V1 (open field); canopy-density shelter arrives with ground cover.
    var bendLean = vec2f(0.0);
    var bendK = 0.0;
    if (fieldInfo.windHeight > 0.0) {
        let windHeight = fieldInfo.windHeight * scale;
        bendLean = swmWindLean(fieldInfo.wind, record.xyz.xz, windHeight, 0.0);
        worldPos = record.xyz + swmWindBend(rotated, bendLean, windHeight);
        // Wind-consistent normal: the bend tangent slope is 2 * lean * k (k = y / h), so the
        // shading normal is sheared against it instead of staying unbent (moving gusts would
        // otherwise produce zero Lambert/backlight modulation on the crown). Shear terms carry
        // the wind-off zero state; `o.n` is normalized only on this path (wind-off keeps the
        // raw rotated normal, exactly as before -- the fragment stage normalizes either way).
        bendK = clamp(rotated.y / windHeight, 0.0, 1.0);
        let shear = 2.0 * bendLean * bendK;
        o.n = normalize(vec3f(rootNormal.x - shear.x * rootNormal.y, rootNormal.y, rootNormal.z - shear.y * rootNormal.y));
    } else {
        o.n = rootNormal;
    }
    let clipPos = view.vp * vec4f(worldPos, 1.0);

    o.pos = clipPos;
    o.wp = worldPos;
    o.uv = uv;
    o.color = color;
    let h = fieldPositionHash(record.xyz);
    o.tint = 0.85 + 0.3 * (f32(h & 0x00FFFFFFu) * (1.0 / 16777216.0));
    // Same page lane the cull compacted into: the slot's signed blend rides beside its index.
    o.lodBlend = fieldLodBlend[bv * fieldInfo.pageCapacity + instanceIndex];
    return o;
}

@vertex
fn vsFieldPull(
    @location(0) pos: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
    @location(3) color: vec4f,
    @builtin(instance_index) instanceIndex: u32,
) -> FieldVertOut {
    return fieldPullVertex(pos, normal, uv, color, instanceIndex);
}

// ── depth variant (depth pre-pass + cascade/spot/point depth) ─────────────────────────────────
// Fragment writes the throwaway color attachment a constant; the depth-stencil state owns the
// actual depth write. Alpha test runs only when the field authors one (early-Z conservatism).

// ── LOD-mix dither crossfade (ADR 0059 step 2, P2-2) ─────────────────────────────────────────
// Complementary 8x8 Bayer mask split between the two bucket draws of a crossfade band, applied in
// EVERY fragment variant (color, normal-color, depth pre-pass, EVSM) so a fading instance keeps
// its silhouette, depth and shadow in step -- a variant that skipped the dither would leave a
// ghost depth/shadow that outlives the shaded surface. Grass is REAL geometry (P1b decision: no
// alpha-cutout, no alphaMap): this fades LOD bucket GEOMETRIES, it is not alpha-to-coverage.
//
// Complementary by construction: the two slots of one band pair carry the SAME |p| (crossfade
// position) and the fragment applies OPPOSITE comparisons per side -- the FINE-side entry
// discards the low masks (`m < |p|`, fades out), the COARSE-side entry discards the high masks
// (`m >= |p|`, fades in). Kept sets are exactly disjoint AND jointly cover the silhouette
// wherever both rasterize: no holes, no overdraw (P2 exit gate). The pattern is high-frequency
// per-pixel (period 8 px; a large static low-frequency mask is what TAA amplifies into shimmer)
// and screen-anchored, so TAA temporally averages the band instead of tracking a fixed grid. The
// mask is registered per FRAMEBUFFER pixel (`i.pos.xy`): the depth/prepass rasterizes the same
// viewport, so the discard set matches the color pass pixel-for-pixel per instance.
//
// Gate semantics: 0 (settled single-write / unwritten zero-filled page) or
// `fieldInfo.lodDitherMode != 0` (candidate C hard switch) keep EVERY fragment -- the dither is
// inert outside a band, and BEFORE the cull publishes writes the field draws exactly like P1.
// `|p| = 1` degenerates to the band edge: the fine side is fully gone, the coarse side fully
// shown (correct complement halves).
const FIELD_BAYER_8: array<u32, 64> = array<u32, 64>(
    0u, 32u, 8u, 40u, 2u, 34u, 10u, 42u,
    48u, 16u, 56u, 24u, 50u, 18u, 58u, 26u,
    12u, 44u, 4u, 36u, 14u, 46u, 6u, 38u,
    60u, 28u, 52u, 20u, 62u, 30u, 54u, 22u,
    3u, 35u, 11u, 43u, 1u, 33u, 9u, 41u,
    51u, 19u, 59u, 27u, 49u, 17u, 57u, 25u,
    15u, 47u, 7u, 39u, 13u, 45u, 5u, 37u,
    63u, 31u, 55u, 23u, 61u, 29u, 53u, 21u,
);

// True = drop this fragment under the LOD-mix dither. `fragPx` = framebuffer position (`i.pos.xy`).
// Sign convention is Bob's published one (slots of one pair share |p|; + = fine side, - = coarse
// side). Branch-free (select(f, t, c) = c ? t : f).
fn fieldLodDitherDiscard(blend: f32, fragPx: vec2f) -> bool {
    if (fieldInfo.lodDitherMode != 0u) {
        return false; // candidate C (hard switch + hysteresis in the cull): never dither
    }
    if (blend == 0.0) {
        return false; // settled slot / unwritten zero-filled page: keep
    }
    let p = abs(blend);
    let px = vec2u(fragPx);
    let idx = (px.y % 8u) * 8u + (px.x % 8u);
    let m = (f32(FIELD_BAYER_8[idx]) + 0.5) * (1.0 / 64.0);
    // Fine side (blend > 0, fades out) discards the low masks (m < p); coarse side (blend < 0,
    // fades in) discards the high masks (m >= p). Kept sets are complementary: fine keeps
    // [p, 1], coarse keeps [0, p) at the SAME p -- an exact partition of the unit mask range.
    return select((m < p), (m >= p), blend < 0.0);
}

@fragment
fn fsFieldDepth(i: FieldVertOut) -> @location(0) vec4f {
    fieldAlphaDiscard(i.uv);
    if (fieldLodDitherDiscard(i.lodBlend, i.pos.xy)) {
        discard;
    }
    return vec4f(0.0, 0.0, 0.0, 1.0);
}

// ── EVSM moment variant (ADR 0043, `field_evsm_pull`) ─────────────────────────────────────────
// Mirrors EvsmMoment.frag.wgsl byte-for-byte semantics: `i.pos.z` is the rasterized [0,1]
// fragment depth, unwarped and exponentially warped into the 4 moment channels the cascade
// moment pass stores -- moment variance stays correct for field casters.
@fragment
fn fsFieldEvsm(i: FieldVertOut) -> @location(0) vec4f {
    fieldAlphaDiscard(i.uv);
    if (fieldLodDitherDiscard(i.lodBlend, i.pos.xy)) {
        discard;
    }
    let depth = clamp(i.pos.z, 0.0, 1.0);
    let d = clamp(depth * 2.0 - 1.0, -1.0, 1.0);
    let c = 40.0;
    let e = exp(c * d);
    let e2 = e * e;
    let n = -1.0 / e;
    let n2 = n * n;
    return vec4f(e, e2, n, n2);
}

// ── main color variant ────────────────────────────────────────────────────────────────────────
// Vegetation shading: Lambert sun with the engine's cascaded shadows (same cascade selection,
// normal-offset bias and blend band as lighting_pbr.wgsl) + irradiance/ambient, two-sided normals,
// and the ADR 0060 leaf backlight (wrap from the unlit side + forward lobe toward the sun,
// transmission shadow sampled `backlight.w` metres toward the sun, cascade-blended / next-cascade
// fallback per WP-C2) weighted by the colour alpha mask. No specular. Two output shapes keep the
// pass's attachment count valid (1 or 2 targets, see MainRenderPass normal buffer).
fn fieldShadingNormal(i: FieldVertOut, frontFacing: bool) -> vec3f {
    let n = normalize(i.n);
    return select(-n, n, frontFacing);
}

fn fieldColorShade(i: FieldVertOut, frontFacing: bool) -> vec4f {
    fieldAlphaDiscard(i.uv);
    if (fieldLodDitherDiscard(i.lodBlend, i.pos.xy)) {
        discard;
    }
    let N = fieldShadingNormal(i, frontFacing);
    let albedo = i.color.rgb * i.tint;
    let L = normalize(global.dirLightDir.xyz);
    let V = normalize(global.viewPos.xyz - i.wp);
    let dotNL = max(dot(N, L), 0.0);
    let backlightOn = fieldInfo.backlight.w > 0.0 && i.color.a > 0.0;

    var shadow: f32 = 1.0;
    var backShadow: f32 = 1.0;
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
        // Cascade blending (same band law as lighting_pbr.wgsl / every tier -- cross-tier seam-fade
        // parity). WP-C2 extends it to the field dir shadow and the backlight transmission sample.
        var blendToNext: f32 = 0.0;
        if (cascadeIndex + 1u < numCascades) {
            let splitFar = global.cascadeSplits[cascadeIndex];
            let blendBand = max(splitFar * 0.1, 0.0001);
            blendToNext = 1.0 - clamp((splitFar - viewDist) / blendBand, 0.0, 1.0);
        }
        let samplePos = i.wp + N * global.dirShadowBias[cascadeIndex] * (1.0 - dotNL);
        let shadowPos = global.cascadeMatrices[cascadeIndex] * vec4f(samplePos, 1.0);
        var shadowA = getShadowDirMain(u_dirShadowMap, shadowSampler, shadowPos, cascadeIndex, global.dirShadowInfo.x);
        if (blendToNext > 0.0) {
            let nextShadowPos = global.cascadeMatrices[cascadeIndex + 1u] * vec4f(samplePos, 1.0);
            shadowA = mix(shadowA, getShadowDirMain(u_dirShadowMap, shadowSampler, nextShadowPos, cascadeIndex + 1u, global.dirShadowInfo.x), blendToNext);
        }
        shadow = shadowA;
        if (backlightOn) {
            // WP-C2: the +L*thickness offset can push the sample out of `cascadeIndex`'s ortho box
            // near a cascade split. Blend across to the next cascade in the blend band, or fall back
            // to it entirely, instead of the 1.0 (unshadowed) halo (see lighting_pbr.wgsl).
            let backPos = global.cascadeMatrices[cascadeIndex] * vec4f(i.wp + L * fieldInfo.backlight.w, 1.0);
            let backNdc = backPos.xyz / backPos.w;
            let backUv = vec2f(backNdc.x * 0.5 + 0.5, 0.5 - backNdc.y * 0.5);
            let backInRange = backUv.x >= 0.0 && backUv.x <= 1.0 && backUv.y >= 0.0 && backUv.y <= 1.0 && backNdc.z >= 0.0 && backNdc.z <= 1.0;
            if (backInRange) {
                backShadow = getShadowDirMain(u_dirShadowMap, shadowSampler, backPos, cascadeIndex, global.dirShadowInfo.x);
            }
            if (backInRange && blendToNext > 0.0 && cascadeIndex + 1u < numCascades) {
                let nextBackPos = global.cascadeMatrices[cascadeIndex + 1u] * vec4f(i.wp + L * fieldInfo.backlight.w, 1.0);
                backShadow = mix(backShadow, getShadowDirMain(u_dirShadowMap, shadowSampler, nextBackPos, cascadeIndex + 1u, global.dirShadowInfo.x), blendToNext);
            } else if (!backInRange && cascadeIndex + 1u < numCascades) {
                let nextBackPos = global.cascadeMatrices[cascadeIndex + 1u] * vec4f(i.wp + L * fieldInfo.backlight.w, 1.0);
                backShadow = getShadowDirMain(u_dirShadowMap, shadowSampler, nextBackPos, cascadeIndex + 1u, global.dirShadowInfo.x);
            }
        }
    }

    let invPi = 0.3183098861837907;
    let sun = global.dirLightColor.rgb * invPi;
    // Ambient exactly like lighting_pbr.wgsl: the baked irradiance cube (sRGB-encoded, ADR 0048)
    // when the scene has one, the flat ambient colour otherwise.
    var ambient = sRGBToLinear(textureSampleLevel(u_irradianceMap, globalSampler, N, 0.0).rgb) * global.envIntensity;
    if (dot(ambient, ambient) < 1e-6) {
        ambient = global.ambientColor.rgb;
    }
    var lit = albedo * sun * (dotNL * shadow) + ambient * albedo;
    if (backlightOn) {
        let lobe = max(dot(-N, L), 0.0) + pow(max(dot(-V, L), 0.0), 6.0);
        lit += fieldInfo.backlight.rgb * albedo * sun * (backShadow * lobe * i.color.a);
    }
    // Output stage identical to Standard.frag.wgsl: exposure, forward tone curve + display
    // encoding (both pass-through while post-processing owns them, gamma lane 1.0), then fog.
    var color = lit * global.exposure;
    color = forwardToneMap(color);
    color = linearToSRGB(color);
    [WGSL_FOG_CALC]
    return vec4f(color, 1.0);
}

@fragment
fn fsFieldColor(i: FieldVertOut, @builtin(front_facing) frontFacing: bool) -> @location(0) vec4f {
    return fieldColorShade(i, frontFacing);
}

// Octahedral encode of the world shading normal for the ADR 0028 normal target (rg16float), the
// established engine encoding (structs.wgsl `octEncode` -- re-declared here because the compute
// structs chunk stops before the material helpers).
fn fieldOctEncode(n: vec3f) -> vec2f {
    let p = n.xy / (abs(n.x) + abs(n.y) + abs(n.z));
    let folded = (vec2f(1.0) - abs(p.yx)) * select(vec2f(-1.0), vec2f(1.0), p >= vec2f(0.0));
    return select(p, folded, n.z < 0.0);
}

struct FieldColorNormalOut {
    @location(0) color: vec4f,
    @location(1) normal: vec4f,
}

@fragment
fn fsFieldColorNormal(i: FieldVertOut, @builtin(front_facing) frontFacing: bool) -> FieldColorNormalOut {
    let color = fieldColorShade(i, frontFacing);
    let n = fieldShadingNormal(i, frontFacing);
    return FieldColorNormalOut(color, vec4f(fieldOctEncode(n), 0.0, color.a));
}
