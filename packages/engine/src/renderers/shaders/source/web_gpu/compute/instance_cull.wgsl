// Instance-field GPU cull + segment-table reset -- ADR 0059 step 1 (P1-2) / step 2 (P2) / step 3, WebGPU lane.
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
//   2 = B: two-phase occlusion (Wihlidal / Haar & Aaltonen): phase 1 tests previous-frame HZB
//          and records frustum+size survivors rejected by prev-HZB into `fieldPhase2.indices`;
//          after DepthPrePass + current-frame HZB pyramid build, `finalizePhase2Args` +
//          `cullInstancesPhase2` rescue any disoccluded instances against current-frame HZB and
//          emit them into the phase-2 indirect draw buffer for depth patch + main color draw.
//
// SEGMENT TABLE (frozen `IndirectDrawSource`): `bv = view * MAX_LOD_BUCKETS + bucket` names one
// (view x bucket) segment. Each segment header is 8 u32 words (INDIRECT_SEGMENT_HEADER_BYTES 32):
//   [0] indexCount, [1] instanceCount (atomic cursor), [2] firstIndex, [3] baseVertex,
//   [4] firstInstance (0), [5] liveCount, [6] state, [7] reserved.
//
// CAPACITY POLICY (binding, IF-CULL-ROUTING / IF-BUDGET): clamp-at-capacity with drop. Each
// (view x bucket) page is sized at `fieldInfo.pageCapacity` = 2 * maxInstances -- the worst-case
// two-bucket routing bound, see `fieldEmit`'s capacity argument.

// @fixed: frozen segment-table constant (see `InstanceField.ts` MAX_LOD_BUCKETS *
//         MAX_INDIRECT_VIEWS -- 21 x 8 headers). 8 u32 words per header (INDIRECT_SEGMENT_HEADER_BYTES).
const FIELD_SEGMENTS: u32 = 168u;
const PHASE2_SEGMENTS: u32 = 8u;

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
// of candidate C (ADR 0059 step 2). Pure mirror of `instanceLodJitter` (InstanceField.ts).
fn fieldLodJitter(inst: u32) -> f32 {
    var h = (inst ^ 0x9E3779B9u) * 0x85EBCA6Bu;
    h = (h ^ (h >> 13u)) * 0xC2B2AE35u;
    h = h ^ (h >> 16u);
    return (f32(h & 0x00FFFFFFu) * (1.0 / 8388608.0)) - 1.0;
}

// Effective upper band bound of one bucket: authored max + per-tier bias + per-instance hysteresis
// jitter (`effectiveBucketMaxPx` in InstanceField.ts).
fn fieldEffectiveMaxPx(prototype: u32, bucket: u32, jitter: f32) -> f32 {
    let maxPx = fieldLodMaxima[prototype * 2u + bucket / 4u][bucket % 4u];
    return maxPx * (1.0 + cullParams.lodHysteresis * jitter) + cullParams.lodBiasPx;
}

// Ascending per-prototype bucket maxima, EFFECTIVE (bias + hysteresis adjusted); select the
// finest band whose upper bound is not exceeded.
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

// Conservative HZB decision against `vpMat` and the bound pyramid (`fieldPrevHzb` holds Frame N-1
// during phase 1 or Frame N during phase 2). Uses the tight wind-expanded vertical-cylinder AABB
// when `protoBounds.y > 0.0` (hzbRadiusXZ authored), else falls back to the bounding sphere.
fn fieldHzbVisible(
    center: vec3f,
    radius: f32,
    scale: f32,
    protoBounds: vec4f,
    vpMat: mat4x4f,
) -> bool {
    var uvMin = vec2f(0.0);
    var uvMax = vec2f(1.0);
    var nearDepth = 0.0;

    if (protoBounds.y > 0.0) {
        let rXZ = protoBounds.y * scale + fieldInfo.windHeight * scale * fieldInfo.wind.p3.x;
        var yMin = protoBounds.z * scale;
        var yMax = protoBounds.w * scale;
        if (fieldInfo.windHeight > 0.0) {
            yMin = min(yMin, yMin * 0.55);
            yMax = max(yMax, yMax * 0.55);
        }
        var minNdc = vec3f(1e9);
        var maxNdc = vec3f(-1e9);
        for (var corner = 0u; corner < 8u; corner++) {
            let sx = select(-rXZ, rXZ, (corner & 1u) != 0u);
            let sy = select(yMin, yMax, (corner & 2u) != 0u);
            let sz = select(-rXZ, rXZ, (corner & 4u) != 0u);
            let cornerClip = vpMat * vec4f(center + vec3f(sx, sy, sz), 1.0);
            if (cornerClip.w <= 1e-4 || cornerClip.z < 0.0) {
                return true;
            }
            let cornerNdc = cornerClip.xyz / cornerClip.w;
            minNdc = min(minNdc, cornerNdc);
            maxNdc = max(maxNdc, cornerNdc);
        }
        if (maxNdc.x < -1.0 || minNdc.x > 1.0 || maxNdc.y < -1.0 || minNdc.y > 1.0) {
            return true;
        }
        uvMin = clamp(
            vec2f(minNdc.x * 0.5 + 0.5, 1.0 - (maxNdc.y * 0.5 + 0.5)),
            vec2f(0.0),
            vec2f(1.0),
        );
        uvMax = clamp(
            vec2f(maxNdc.x * 0.5 + 0.5, 1.0 - (minNdc.y * 0.5 + 0.5)),
            vec2f(0.0),
            vec2f(1.0),
        );
        nearDepth = minNdc.z;
    } else {
        let clip = vpMat * vec4f(center, 1.0);
        if (clip.w <= radius * 1.05) {
            return true;
        }
        let ndc = clip.xyz / clip.w;
        let uvCenter = vec2f(ndc.x * 0.5 + 0.5, 1.0 - (ndc.y * 0.5 + 0.5));
        if (any(uvCenter < vec2f(0.0)) || any(uvCenter > vec2f(1.0))) {
            return true;
        }
        let axis = normalize(vec3f(vpMat[0][2], vpMat[1][2], vpMat[2][2]));
        let nearClipA = vpMat * vec4f(center + axis * radius, 1.0);
        let nearClipB = vpMat * vec4f(center - axis * radius, 1.0);
        nearDepth = min(nearClipA.z / nearClipA.w, nearClipB.z / nearClipB.w);

        let ndcRadius = worldRadiusToNdcRadius(radius, clip.w);
        let uvHalf = ndcRadius * 0.5;
        uvMin = clamp(uvCenter - uvHalf, vec2f(0.0), vec2f(1.0));
        uvMax = clamp(uvCenter + uvHalf, vec2f(0.0), vec2f(1.0));
    }

    let baseDims = vec2f(textureDimensions(fieldPrevHzb, 0u));
    let rectPx = (uvMax - uvMin) * baseDims;
    let extentPx = max(max(rectPx.x, rectPx.y), 1.0);

    let mip = min(u32(ceil(log2(extentPx))), fieldInfo.hzbMipCount - 1u);
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

// ── stage-specific bindings ───────────────────────────────────────────────────────────────────

struct FieldPhase2Rejects {
    rejectCount: atomic<u32>,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
    indices: array<u32>,
}

struct FieldPhase2DispatchArgs {
    dispatchX: u32,
    dispatchY: u32,
    dispatchZ: u32,
    count: u32,
}

@group(1) @binding(0) var<storage, read_write> fieldPhase2: FieldPhase2Rejects;
@group(1) @binding(1) var<storage, read_write> fieldPhase2Dispatch: FieldPhase2DispatchArgs;

@group(2) @binding(2) var<storage, read_write> fieldIndirectArgs: array<atomic<u32>>;
@group(2) @binding(3) var<storage, read_write> fieldVisibleIndices: array<u32>;
@group(2) @binding(11) var<storage, read_write> fieldLodBlend: array<f32>;

// ── reset entries (separate passes before cull dispatches) ────────────────────────────────────

@compute @workgroup_size(64)
fn resetFieldCounters(@builtin(global_invocation_id) id: vec3u) {
    let segment = id.x;
    if (segment >= FIELD_SEGMENTS) {
        return;
    }
    let base = segment * 8u;
    atomicStore(&fieldIndirectArgs[base + 1u], 0u); // instanceCount
    atomicStore(&fieldIndirectArgs[base + 5u], 0u); // liveCount
    atomicStore(&fieldIndirectArgs[base + 6u], 1u); // state = CULLING
    atomicStore(&fieldIndirectArgs[base + 7u], 0u); // reserved
}

// Zeros the phase-2 reject counter and the view-0 phase-2 indirect args headers.
@compute @workgroup_size(64)
fn resetPhase2Counters(@builtin(global_invocation_id) id: vec3u) {
    let segment = id.x;
    if (segment == 0u) {
        atomicStore(&fieldPhase2.rejectCount, 0u);
    }
    if (segment >= PHASE2_SEGMENTS) {
        return;
    }
    let base = segment * 8u;
    atomicStore(&fieldIndirectArgs[base + 1u], 0u);
    atomicStore(&fieldIndirectArgs[base + 5u], 0u);
    atomicStore(&fieldIndirectArgs[base + 6u], 1u);
    atomicStore(&fieldIndirectArgs[base + 7u], 0u);
}

// Writes the indirect compute dispatch dimensions for `cullInstancesPhase2`.
@compute @workgroup_size(1)
fn finalizePhase2Args() {
    let rawCount = atomicLoad(&fieldPhase2.rejectCount);
    let count = min(rawCount, arrayLength(&fieldPhase2.indices));
    fieldPhase2Dispatch.dispatchX = (count + 63u) / 64u;
    fieldPhase2Dispatch.dispatchY = 1u;
    fieldPhase2Dispatch.dispatchZ = 1u;
    fieldPhase2Dispatch.count = count;
}

// ── shared emission + LOD routing ─────────────────────────────────────────────────────────────

fn fieldEmit(bucket: u32, inst: u32, blend: f32) {
    let bv = cullParams.segmentBase + bucket;
    let argsBase = bv * 8u;
    let slot = atomicAdd(&fieldIndirectArgs[argsBase + 1u], 1u);
    if (slot < fieldInfo.pageCapacity) {
        let page = bv * fieldInfo.pageCapacity + slot;
        fieldVisibleIndices[page] = inst;
        fieldLodBlend[page] = blend;
    } else {
        atomicSub(&fieldIndirectArgs[argsBase + 1u], 1u);
    }
}

fn fieldRouteAndEmit(inst: u32, prototype: u32, diam: f32) {
    let jitter = fieldLodJitter(inst);
    let bucketCount = min(fieldPrototypeRange[prototype].z, 8u);
    let bias = min(cullParams.lodBiasBuckets, bucketCount - 1u);
    let bucket = fieldSelectBucket(prototype, diam, jitter);
    let band = cullParams.lodCrossfadeBand;

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

// ── cull entries ──────────────────────────────────────────────────────────────────────────────

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
    let protoBounds = fieldPrototypeInfo[prototype];
    let radius = protoBounds.x * scale + fieldInfo.windHeight * scale * fieldInfo.wind.p3.x;

    var keep = fieldSphereVisible(center, radius);
    if (!keep) {
        return;
    }

    let toCam = center - global.viewPos.xyz;
    let viewDist = max(length(toCam), 1e-6);
    let diam = fieldProjectedDiameterPx(radius, viewDist);
    if (cullParams.isMainView != 0u && diam < fieldInfo.cullPixelSize) {
        return;
    }

    if (cullParams.cullMode == 1u || cullParams.cullMode == 2u) {
        if (cullParams.hzbEnabled != 0u && cullParams.hzbSkip == 0u) {
            if (!fieldHzbVisible(center, radius, scale, protoBounds, cullParams.prevVp)) {
                if (cullParams.cullMode == 2u) {
                    let rSlot = atomicAdd(&fieldPhase2.rejectCount, 1u);
                    if (rSlot < arrayLength(&fieldPhase2.indices)) {
                        fieldPhase2.indices[rSlot] = inst;
                    }
                }
                return;
            }
        }
    }

    fieldRouteAndEmit(inst, prototype, diam);
}

// Phase 2 rescue pass (mode B, Wihlidal / Haar & Aaltonen): tests previous-frame HZB rejects
// against the current frame's HZB pyramid (`fieldPrevHzb` bound to Frame N's pyramid) using
// `global.vp` and emits disoccluded survivors into the phase-2 indirect draw buffer.
@compute @workgroup_size(64)
fn cullInstancesPhase2(@builtin(global_invocation_id) id: vec3u) {
    let rIdx = id.x;
    let count = min(atomicLoad(&fieldPhase2.rejectCount), arrayLength(&fieldPhase2.indices));
    if (rIdx >= count) {
        return;
    }

    let inst = fieldPhase2.indices[rIdx];
    let record = fieldRecords[inst];
    let center = record.xyz;
    let packed = bitcast<u32>(record.w);
    let scaleWord = packed >> 16u;
    let scale = f32(scaleWord) * (1.0 / 256.0);
    let prototype = fieldPrototypeOf(inst);
    let protoBounds = fieldPrototypeInfo[prototype];
    let radius = protoBounds.x * scale + fieldInfo.windHeight * scale * fieldInfo.wind.p3.x;

    if (!fieldHzbVisible(center, radius, scale, protoBounds, global.vp)) {
        return;
    }

    let toCam = center - global.viewPos.xyz;
    let viewDist = max(length(toCam), 1e-6);
    let diam = fieldProjectedDiameterPx(radius, viewDist);
    fieldRouteAndEmit(inst, prototype, diam);
}

