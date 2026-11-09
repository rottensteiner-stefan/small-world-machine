// Instance-field GPU cull + segment-table reset -- ADR 0059 step 1 (P1-2), WebGPU lane.
// Runtime assembly (composed by the renderer, mirrored by lint-wgsl.ts):
//   chunk instance_field_structs.wgsl   // SOLE declaration of FieldInfo/CullParams + the 11
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
// CAPACITY POLICY (binding, IF-CULL-ROUTING / IF-BUDGET): clamp-at-capacity with drop. The
// instance cursor pins at `pageCapacity`, over-budget survivors are dropped (no OOB write, no
// cross-segment overrun), and the draw arg equals the compacted count exactly.

// @fixed: frozen segment-table constant (see `InstanceField.ts` MAX_LOD_BUCKETS *
//         MAX_INDIRECT_VIEWS -- 16 x 8 headers). 8 u32 words per header (INDIRECT_SEGMENT_HEADER_BYTES).
const FIELD_SEGMENTS: u32 = 128u;

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

// Ascending per-prototype bucket maxima (`lodBucketMaxima[p][b]`); select the finest bucket whose
// upper band is not exceeded. Bucket 0 is the finest. P1 fields route through this path from day
// 1 (bucketed compaction); drawn buckets today are 0..(authorized set) -- IF-CULL-ROUTING.
fn fieldSelectBucket(prototype: u32, diam: f32) -> u32 {
    let bucketCount = min(fieldPrototypeRange[prototype].z, 8u);
    var bucket = 0u;
    for (var b = 0u; b + 1u < bucketCount; b++) {
        // lodBucketMaxima is packed row-major: prototype p, bucket b -> row p*2 + b/4, lane b%4.
        let maxPx = fieldLodMaxima[prototype * 2u + b / 4u][b % 4u];
        if (diam > maxPx) {
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
    let clip = global.vp * vec4f(center, 1.0);
    // Behind/at the camera or reaching the near plane cannot be projected reliably -> visible.
    if (clip.w <= radius + 0.0001) {
        return true;
    }
    let ndc = clip.xyz / clip.w;

    // Nearest point of the sphere toward the camera, reprojected for the depth compare.
    let toCam = global.viewPos.xyz - center;
    let toCamLen = length(toCam);
    var nearestWorld = center;
    if (toCamLen > 0.0001) {
        nearestWorld = center + (toCam / toCamLen) * min(radius, toCamLen);
    }
    let nearClip = global.vp * vec4f(nearestWorld, 1.0);
    if (nearClip.w <= 0.0001) {
        return true;
    }
    let nearDepth = nearClip.z / nearClip.w;

    // Screen-space rect of the sphere; the frustum+size gate already ran, so the center may be
    // off-screen while the sphere clips the frustum -- the clamped rect stays conservative.
    let ndcRadius = worldRadiusToNdcRadius(radius, clip.w);
    let uvCenter = vec2f(ndc.x * 0.5 + 0.5, 1.0 - (ndc.y * 0.5 + 0.5));
    let uvHalf = ndcRadius * 0.5;
    let uvMin = clamp(uvCenter - uvHalf, vec2f(0.0), vec2f(1.0));
    let uvMax = clamp(uvCenter + uvHalf, vec2f(0.0), vec2f(1.0));
    let rectPx = (uvMax - uvMin) * global.resolution.xy;
    let extentPx = max(max(rectPx.x, rectPx.y), 1.0);

    let mip = min(u32(ceil(log2(extentPx))), fieldInfo.hzbMipCount - 1u);
    let mipDims = vec2f(textureDimensions(fieldPrevHzb, mip));
    let lo = vec2i(clamp(uvMin * mipDims, vec2f(0.0), mipDims - vec2f(1.0)));
    let hi = vec2i(clamp(uvMax * mipDims, vec2f(0.0), mipDims - vec2f(1.0)));
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

// One invocation per instance record. Order: range resolve -> conservative sphere-frustum ->
// projected-size sub-pixel drop -> LOD bucket selection -> (mode A/B) previous-frame HZB skip ->
// clamp-at-capacity atomic compaction into the (view x bucket) segment page.
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
    let radius = fieldPrototypeInfo[prototype].x * scale;

    // Conservative sphere-frustum against this view's inward planes (IF-CULL-NO-FALSE-NEGATIVE).
    var keep = fieldSphereVisible(center, radius);

    if (keep) {
        // Projected-size sub-pixel drop through the primary-view metric (IF-PROJECTED-SIZE).
        let toCam = center - global.viewPos.xyz;
        let viewDist = max(length(toCam), 1e-6);
        let diam = fieldProjectedDiameterPx(radius, viewDist);
        keep = diam >= fieldInfo.cullPixelSize;
        if (keep) {
            let bucket = fieldSelectBucket(prototype, diam);
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
                let bv = cullParams.segmentBase + bucket;
                let argsBase = bv * 8u;
                let slot = atomicAdd(&fieldIndirectArgs[argsBase + 1u], 1u);
                if (slot < fieldInfo.pageCapacity) {
                    fieldVisibleIndices[bv * fieldInfo.pageCapacity + slot] = inst;
                }
            }
        }
    }
}
