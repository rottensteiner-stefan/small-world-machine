// Instance-field GPU cull + segment-table reset -- ADR 0059 step 1 (P1-2) / step 2 (P2), WebGPU lane.
// Runtime assembly (composed by the renderer, mirrored by lint-wgsl.ts):
//   chunk instance_field_structs.wgsl   // SOLE declaration of FieldInfo/CullParams + the 12
//                                       // @group(2) bindings (INSTANCE_FIELD_BIND_GROUP, frozen)
//   + WGSL_SCREEN_FOOTPRINT chunk       // `worldRadiusToNdcRadius`
//   + this file                         // helpers + entries only, nothing re-declared
// plus `computeStructsChunk()` (group(0)-only structs -> `global`) prepended by the renderer.
// group 0 stays the shared `GlobalUniforms` layout every compute consumer binds
// (`global.vp`, `global.viewPos`, `global.projScale`, `global.resolution`).
//
// FRUSTUM CONVENTION (binding, see `InstanceField.ts` contract): planes face INWARD, a point is
// inside iff `n*p + d >= 0`. This file mirrors the frozen CPU oracle `sphereVisibleConservative`
// / `projectedDiameterPixels` exactly -- it must never be LESS conservative than those CPU
// functions (IF-CULL-NO-FALSE-NEGATIVE), and the per-instance cull / bucket selection must
// evaluate through the SAME math (`IF-PROJECTED-SIZE`).
//
// CULL MODES (runtime uniform `cullParams.cullMode`, set by the coordinator):
//   0 = C: frustum + projected-size only.
//   1 = A: + previous-frame HZB skip (main-camera view only, `hzbEnabled && !hzbSkip`).
//   2 = B: two-phase occlusion (Wihlidal / Haar & Aaltonen) is SPEC'D but not built -- until the
//         S3 A/B/C spike needs the depth-pre-pass split, mode 2 takes the mode-A path. The split
//         (prev-visible draw -> this-frame HZB rebuild -> cull the rest) is the documented TODO.
//   TODO(veg-p1-bob): mode 2B depth-pre-pass split at spike time (ADR 0059 decision protocol).
//
// SEGMENT TABLE (frozen `IndirectDrawSource`): `bv = view * MAX_LOD_BUCKETS + bucket` names one
// (view x bucket) segment. Each segment header is 8 u32 words (INDIRECT_SEGMENT_HEADER_BYTES 32):
//   [0] indexCount, [1] instanceCount (atomic cursor), [2] firstIndex, [3] baseVertex,
//   [4] firstInstance (0), [5] liveCount, [6] state, [7] reserved.
// The geometry words [0,2,3,4] are written once at setup (static V1 population); the RESET entry
// zeroes the producer-owned words [1,5,6,7] per frame BEFORE any cull dispatch (separate compute
// pass -- a dispatches-inside-one-pass pair has no cross-workgroup barrier in WGSL, same
// reasoning as `gpu_particles.wgsl`'s three-stage separation).
//
// CAPACITY POLICY (binding, IF-CULL-ROUTING / IF-BUDGET): clamp-at-capacity with drop. Each
// (view x bucket) page is sized at `fieldInfo.pageCapacity` = 2 * maxInstances -- the worst-case
// two-bucket routing bound, see `fieldEmit`'s capacity argument. Over-budget survivors are
// dropped (no OOB write, no cross-segment overrun) and the compaction cursor is CLAMPED so the
// drawn instance count never exceeds the page; `firstInstance + instanceCount <= page capacity`
// is a hard invariant the indirect draw can rely on (P0).

// @fixed: frozen segment-table constant (see `InstanceField.ts` MAX_LOD_BUCKETS *
//         MAX_INDIRECT_VIEWS -- 21 x 8 headers). 8 u32 words per header (INDIRECT_SEGMENT_HEADER_BYTES).
const FIELD_SEGMENTS: u32 = 168u;

// ── per-lane helpers ──────────────────────────────────────────────────────────────────────────

// Range-implicit prototype resolution (contract binding): the record buffer is partitioned into
// contiguous per-prototype ranges; the per-instance cull radius comes from the range's prototype
// bounds, never the record. Ranges ascend by start; binary search for the largest start <= inst.
fn fieldPrototypeOf(inst: u32) -> u32 {
    var lo = 0u;
    var hi = fieldInfo.prototypeCount;
    var best = 0u;
    while (lo < hi) {
        let mid = (lo + hi) / 2u;
        if (fieldPrototypeRange[mid].x <= inst) {
            best = mid;
            lo = mid + 1u;
        } else {
            hi = mid;
        }
    }
    return best;
}

// Conservative sphere-frustum, exact mirror of `sphereVisibleConservative` (IF-CULL-NO-FALSE-
// NEGATIVE): culled only when a plane provably separates the WHOLE sphere (dist < -radius).
fn fieldSphereVisible(center: vec3f, radius: f32) -> bool {
    for (var i = 0u; i < 6u; i++) {
        let p = cullParams.frustumPlanes[i];
        if (dot(p.xyz, center) + p.w < -radius) {
            return false;
        }
    }
    return true;
}

// Frozen projected-diameter metric (IF-PROJECTED-SIZE): `d_px = worldRadius * viewportHeightPx /
// (tan(fovY/2) * viewDistance)` -- identical to `projectedDiameterPixels`. Evaluated through the
// PRIMARY view's projection on every view (bucket selection is main-camera-driven, ADR 0059).
fn fieldProjectedDiameterPx(radius: f32, viewDist: f32) -> f32 {
    let halfTan = max(tan(cullParams.fovRadiansY * 0.5), 1e-6);
    return (radius * cullParams.viewportHeightPx) / (halfTan * viewDist);
}

// Deterministic per-instance threshold jitter in [-1, 1): the stateless hysteresis discriminator
// of candidate C (ADR 0059 step 2). Pure mirror of `instanceLodJitter` (InstanceField.ts) --
// identical finalizer constants, so the CPU reference reproduces the same effective thresholds
// (IF-CULL-DETERMINISM). Frame-stable because `inst` is the record index of the static V1
// population; identical in every view (shadows reuse the main camera's choice unchanged).
fn fieldLodJitter(inst: u32) -> f32 {
    var h = (inst ^ 0x9E3779B9u) * 0x85EBCA6Bu;
    h = (h ^ (h >> 13u)) * 0xC2B2AE35u;
    h = h ^ (h >> 16u);
    return (f32(h & 0x00FFFFFFu) * (1.0 / 8388608.0)) - 1.0;
}

// Effective upper band bound of one bucket: authored max + per-tier bias + per-instance hysteresis
// jitter (`effectiveBucketMaxPx` in InstanceField.ts). At default knobs (bias 0, hysteresis 0)
// this equals the authored max exactly -- the frozen IF-PROJECTED-SIZE selection is unchanged.
fn fieldEffectiveMaxPx(prototype: u32, bucket: u32, jitter: f32) -> f32 {
    let maxPx = fieldLodMaxima[prototype * 2u + bucket / 4u][bucket % 4u];
    return maxPx * (1.0 + cullParams.lodHysteresis * jitter) + cullParams.lodBiasPx;
}

// Ascending per-prototype bucket maxima, EFFECTIVE (bias + hysteresis adjusted); select the
// finest band whose upper bound is not exceeded. Bucket 0 is the smallest projected-size band
// (farthest under the near=detail authoring convention); the hidden coarsest band holds every
// diameter above all authored maxima. P1 fields route through this path from day 1 (bucketed
// compaction) -- IF-CULL-ROUTING.
fn fieldSelectBucket(prototype: u32, diam: f32, jitter: f32) -> u32 {
    let bucketCount = min(fieldPrototypeRange[prototype].z, 8u);
    var bucket = 0u;
    for (var b = 0u; b + 1u < bucketCount; b++) {
        if (diam > fieldEffectiveMaxPx(prototype, b, jitter)) {
            bucket = b + 1u;
        }
    }
    return bucket;
}

// Conservative previous-frame HZB decision (mode A), mirroring `hzb_visibility_test.wgsl`'s
// 4-corner max-mip load (same conservative spirit, IF-CULL-NO-FALSE-NEGATIVE / IF-CAMERA-CUT-HZB-
// SKIP): skipped only when every sampled texel is STRICTLY nearer than the sphere's nearest
// point. Only evaluated when `hzbEnabled && !hzbSkip` (main-camera view). The sample reads the
// PREVIOUS frame's pyramid (ping-pong, `getPreviousFrameHzb()`) -- never newer data.
fn fieldHzbVisible(center: vec3f, radius: f32) -> bool {
    // PREVIOUS-frame projection (Frame N-1's VP -- the frame whose depth built the sampled
    // pyramid): the HZB data is one frame old by construction, so the footprint AND the depth
    // compare must live in Frame N-1's space. Projecting with the current `global.vp` would test
    // a stale screen rect and a stale z against the old pyramid and falsely cull near the
    // frustum edges (frame-staleness fix; ping-pong slot served = last completed build).
    let prevClip = cullParams.prevVp * vec4f(center, 1.0);
    // Sphere reaching the eye / near plane cannot be projected reliably -> conservative visible
    // (the 1.05 margin replaces a 1x1 border-texel collapse, matching hzb_visibility_test).
    if (prevClip.w <= radius * 1.05) {
        return true;
    }
    let prevNdc = prevClip.xyz / prevClip.w;

    // Off-screen center: the frustum + size gate already ran, so the sphere may still clip the
    // frustum while its center projects off-screen; clamping the rect to [0,1] would collapse
    // the footprint to a 1x1 border texel and falsely cull -> conservative visible instead.
    let uvCenter = vec2f(prevNdc.x * 0.5 + 0.5, 1.0 - (prevNdc.y * 0.5 + 0.5));
    if (any(uvCenter < vec2f(0.0)) || any(uvCenter > vec2f(1.0))) {
        return true;
    }

    // Nearest point of the sphere for the depth compare. The euclidean nearest-to-eye point
    // (center + normalize(viewPos - center) * radius) minimizes EUCLIDEAN distance, not
    // view-space depth: 45 degrees off-axis its depth exceeds z_c - r, which OVER-estimates
    // nearDepth -> false cull. The conservative nearest point lies on the previous camera's VIEW
    // AXIS through the center. Clip depth is monotone in view-space z, so the sphere's extremal
    // view depth is reached at one of the two axis endpoints; taking the min of both is
    // sign-agnostic (no camera-basis convention to get wrong) and provably no deeper than any
    // other sphere point. The view axis in world space is prevVp's depth row -- in a column-
    // major mat4x4f the row's first three components are element [i][2]; the projection's P22
    // scale cancels under normalize(). `prevClip.w > radius` (checked above) guarantees both
    // endpoints project with w > 0, so the divisions are well-defined.
    let axis = normalize(vec3f(cullParams.prevVp[0][2], cullParams.prevVp[1][2], cullParams.prevVp[2][2]));
    let nearClipA = cullParams.prevVp * vec4f(center + axis * radius, 1.0);
    let nearClipB = cullParams.prevVp * vec4f(center - axis * radius, 1.0);
    let nearDepth = min(nearClipA.z / nearClipA.w, nearClipB.z / nearClipB.w);

    // Screen-space rect of the sphere in PREVIOUS-frame NDC (worldRadiusToNdcRadius is the
    // conservative tangent projection, see the screen-footprint chunk).
    let ndcRadius = worldRadiusToNdcRadius(radius, prevClip.w);
    let uvHalf = ndcRadius * 0.5;
    let uvMin = clamp(uvCenter - uvHalf, vec2f(0.0), vec2f(1.0));
    let uvMax = clamp(uvCenter + uvHalf, vec2f(0.0), vec2f(1.0));
    let rectPx = (uvMax - uvMin) * global.resolution.xy;
    let extentPx = max(max(rectPx.x, rectPx.y), 1.0);

    let mip = min(u32(ceil(log2(extentPx))), fieldInfo.hzbMipCount - 1u);

    // Mip-0 texel cover of the rect, then right-shift by `mip` (hzb_downsample_max.wgsl maps mip-L
    // texel t to mip-0 texels [t*2^L, (t+1)*2^L)). Directly computing uv * mipDims drifts by up
    // to one full texel on NPOT bases (1080p: mip 9 is 2 px wide) -- deriving from BASE dims and
    // shifting right is exact.
    let baseDims = vec2f(textureDimensions(fieldPrevHzb, 0u));
    let mipDimsI = vec2i(textureDimensions(fieldPrevHzb, mip));
    let maxCoord = mipDimsI - vec2i(1);
    let shift = vec2u(mip);
    let lo = clamp(vec2i(uvMin * baseDims) >> shift, vec2i(0), maxCoord);
    let hi = clamp(vec2i(uvMax * baseDims) >> shift, vec2i(0), maxCoord);
    let d00 = textureLoad(fieldPrevHzb, vec2i(lo.x, lo.y), i32(mip)).r;
    let d10 = textureLoad(fieldPrevHzb, vec2i(hi.x, lo.y), i32(mip)).r;
    let d01 = textureLoad(fieldPrevHzb, vec2i(lo.x, hi.y), i32(mip)).r;
    let d11 = textureLoad(fieldPrevHzb, vec2i(hi.x, hi.y), i32(mip)).r;
    let farthestInFootprint = max(max(d00, d10), max(d01, d11));

    return nearDepth <= farthestInFootprint;
}

// ── reset entry: frame-head zeroing of the producer-owned segment words (separate pass) ─────────

// One thread per segment; zeroes [instanceCount, liveCount, state, reserved] and leaves the
// setup-time geometry words [indexCount, firstIndex, baseVertex, firstInstance] untouched.
// Recorded by the coordinator at frame head BEFORE any cull dispatch (single submit orders them).
// Stage-specific bindings 2/3 of the field group (see instance_field_structs.wgsl): the segment
// table is atomic because `instanceCount` is the compaction cursor.
@group(2) @binding(2) var<storage, read_write> fieldIndirectArgs: array<atomic<u32>>; // 128 x 8 words
@group(2) @binding(3) var<storage, read_write> fieldVisibleIndices: array<u32>;       // pages [bv * pageCapacity, +cap)
// P2 crossfade channel (ADR 0059 step 2, candidate A): one SIGNED f32 per (segment, instance)
// slot, at the SAME page address as the visible index (page-indexed exactly like
// `fieldVisibleIndices`). Per-slot value [blend contract, aligned with the pull fragment
// `fieldLodDitherDiscard`, veg-p2-erin committed 2026-11-09 (5e44515)]:
//   +p (0 < p < 1) = FINE-side entry of a crossfade band pair (keeps dither >= p)
//   -p (0 < p < 1) = COARSE-side entry (keeps dither < p)
//   both slots of one pair carry the SAME magnitude p = 1 - t (t = band position, 0 at the
//   coarse end -> 1 at the fine end): the two draws' kept pixels are an exact partition.
//   0 = settled single-write / unwritten zero-filled slot: keep all (fail-closed = P1).
// The draw reads only slots < the segment's instanceCount, so no per-frame reset is needed.
@group(2) @binding(11) var<storage, read_write> fieldLodBlend: array<f32>;

@compute @workgroup_size(64)
fn resetFieldCounters(@builtin(global_invocation_id) id: vec3u) {
    let segment = id.x;
    if (segment >= FIELD_SEGMENTS) {
        return;
    }
    let base = segment * 8u;
    atomicStore(&fieldIndirectArgs[base + 1u], 0u); // instanceCount -- the compaction atomic cursor
    atomicStore(&fieldIndirectArgs[base + 5u], 0u); // liveCount (readback mirror)
    atomicStore(&fieldIndirectArgs[base + 6u], 1u); // state = CULLING (field producer lifecycle word)
    atomicStore(&fieldIndirectArgs[base + 7u], 0u); // reserved (must stay 0)
}

// ── cull entry ────────────────────────────────────────────────────────────────────────────────

// Emits one survivor into the (segment, slot) page of `bucket`: the draw-index atomic cursor
// reserves the slot, then index AND blend are written at the SAME page address (one writer per
// slot -> no cross-invocation race). WORST-CASE CAPACITY ARGUMENT (P0): an instance in a LOD
// crossfade band emits into the adjacent {coarse, fine} pair -- at most two slots, at most ONE
// per segment -- so a naive per-segment bound of `maxInstances` holds for the CURRENT routing,
// but the audited two-bucket worst case is `2 * maxInstances` total writes when routing is
// adversarial. `fieldInfo.pageCapacity` (= the buffer's per-segment page size = 2 * maxInstances,
// see InstanceFieldSystem) therefore makes every emission land in-bounds. Defense in depth: the
// atomicSub here CLAMPS the drawn instanceCount to the page capacity, so `drawIndexedIndirect`
// can never execute a vertex with iid >= pageCapacity (no OOB read of fieldVisibleIndices /
// fieldLodBlend) even if the two-bucket bound were ever exceeded by future routing logic.
fn fieldEmit(bucket: u32, inst: u32, blend: f32) {
    let bv = cullParams.segmentBase + bucket;
    let argsBase = bv * 8u;
    let slot = atomicAdd(&fieldIndirectArgs[argsBase + 1u], 1u);
    if (slot < fieldInfo.pageCapacity) {
        let page = bv * fieldInfo.pageCapacity + slot;
        fieldVisibleIndices[page] = inst;
        fieldLodBlend[page] = blend;
    } else {
        // Roll the cursor back so instanceCount never exceeds the page; the dropped emission is
        // an over-budget survivor (IF-BUDGET), the page is provably full, and count-1 still
        // describes the same compacted set. Ensures firstInstance + instanceCount <= capacity.
        atomicSub(&fieldIndirectArgs[argsBase + 1u], 1u);
    }
}

// One invocation per instance record. Order: range resolve -> conservative sphere-frustum ->
// projected-size sub-pixel drop -> (mode A/B) previous-frame HZB skip -> P2 LOD selection +
// crossfade-band split -> clamp-at-capacity atomic compaction into the (view x bucket) segment
// page (dual-write inside a transition band, ADR 0059 step 2 candidate A).
@compute @workgroup_size(64)
fn cullInstances(@builtin(global_invocation_id) id: vec3u) {
    let inst = id.x;
    if (inst >= fieldInfo.instanceCount) {
        return;
    }

    let record = fieldRecords[inst];
    let center = record.xyz;
    let packed = bitcast<u32>(record.w);
    let scaleWord = packed >> 16u;
    let scale = f32(scaleWord) * (1.0 / 256.0);
    let prototype = fieldPrototypeOf(inst);
    // Wind-bent bounding radius: the crown leans up to `windHeight * maxLean` horizontally
    // (maxLean = fieldInfo.wind.p3.x, the `SwmWind` authored max lean; windHeight 0 = the term
    // vanishes). A frustum/HZB test against the REST radius would cull a wind-bent crown that is
    // still on screen / in the shadow volume at the edges (IF-CULL-NO-FALSE-NEGATIVE).
    let radius = fieldPrototypeInfo[prototype].x * scale + fieldInfo.windHeight * scale * fieldInfo.wind.p3.x;

    // Conservative sphere-frustum against this view's inward planes (IF-CULL-NO-FALSE-NEGATIVE).
    var keep = fieldSphereVisible(center, radius);

    if (keep) {
        // Projected-size sub-pixel drop through the primary-view metric (IF-PROJECTED-SIZE).
        let toCam = center - global.viewPos.xyz;
        let viewDist = max(length(toCam), 1e-6);
        let diam = fieldProjectedDiameterPx(radius, viewDist);
        // The sub-pixel size gate applies ONLY to the main view: a caster that is sub-pixel from
        // the main camera can still cast a visible shadow, so shadow views keep EVERY frustum-
        // visible caster (casters whose shadows enter the frustum must be emitted; no perspective
        // maxCullRadius in the GPU lane).
        if (cullParams.isMainView != 0u) {
            keep = diam >= fieldInfo.cullPixelSize;
        }
        if (keep) {
            // Mode A/B previous-frame HZB skip (main-camera view only; coordinator never sets
            // `hzbEnabled` for shadow views). Mode 2 uses the mode-A path until the 2B split.
            if (cullParams.cullMode == 1u || cullParams.cullMode == 2u) {
                if (cullParams.hzbEnabled != 0u && cullParams.hzbSkip == 0u) {
                    if (!fieldHzbVisible(center, radius)) {
                        keep = false;
                    }
                }
            }
            if (keep) {
                // P2: selection + crossfade band through the EFFECTIVE (main-camera-metric)
                // thresholds. The jitter is per-record, so every view derives the SAME band/pair
                // as the main camera; shadow views only shift the targets toward the coarse end
                // by `lodBiasBuckets` (authored `shadowLodBias`, 0 = reuse the main choice).
                let jitter = fieldLodJitter(inst);
                let bucketCount = min(fieldPrototypeRange[prototype].z, 8u);
                let bias = min(cullParams.lodBiasBuckets, bucketCount - 1u);
                let bucket = fieldSelectBucket(prototype, diam, jitter);
                let band = cullParams.lodCrossfadeBand;

                // Crossfade band (candidate A): diameter STRICTLY inside `(T*(1-band), T*(1+band))`
                // of an EFFECTIVE boundary T -> dual-write into the adjacent {coarse, fine} pair
                // with the SHARED magnitude p = 1 - t (t: 0 at the coarse end -> 1 at the fine
                // end), written FINE +p / COARSE -p per the pull-fragment contract: fine keeps
                // dither >= p, coarse keeps dither < p on the SAME 8x8 Bayer -> kept sets are an
                // exact partition of the mask range (no holes, no overdraw; the fine share grows
                // with t). Strict membership keeps p in (0,1) -- the band edges fall to the single
                // write path below, so no slot ever carries the ambiguous p = 0/p = 1 endpoint.
                // Single prototype bands never apply (no coarser neighbour). band <= 0 = hard
                // switch (candidate C): always single-write, jitter-only decorrelation.
                var inBand = band > 0.0;
                var coarseBucket = bucket;
                var blend = 0.0;
                if (inBand) {
                    inBand = false;
                    for (var bl = 0u; bl + 1u < bucketCount; bl++) {
                        let eff = fieldEffectiveMaxPx(prototype, bl, jitter);
                        let lo = eff * (1.0 - band);
                        let hi = eff * (1.0 + band);
                        if (diam > lo && diam < hi) {
                            let t = clamp((diam - lo) / max(hi - lo, 1e-6), 0.0, 1.0);
                            inBand = true;
                            coarseBucket = bl;
                            blend = 1.0 - t;
                            break;
                        }
                    }
                }
                if (inBand) {
                    let fineBucket = coarseBucket + 1u;
                    let coarse = max(coarseBucket, bias) - bias;
                    let fine = max(fineBucket, bias) - bias;
                    if (coarse == fine) {
                        // Biased onto the same (coarsest) segment: settle on it, keep-all (0).
                        fieldEmit(fine, inst, 0.0);
                    } else {
                        fieldEmit(coarse, inst, -blend);
                        fieldEmit(fine, inst, blend);
                    }
                } else {
                    let selected = max(bucket, bias) - bias;
                    fieldEmit(selected, inst, 0.0);
                }
            }
        }
    }
}
