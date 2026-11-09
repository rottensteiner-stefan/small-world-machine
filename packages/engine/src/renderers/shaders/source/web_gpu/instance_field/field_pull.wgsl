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

struct FieldVertOut {
    @builtin(position) pos: vec4f,
    @location(0) wp: vec3f,
    @location(1) uv: vec2f,
    @location(2) n: vec3f,
    // Linear albedo (rgb) + foliage/transmission mask (a), from the vertex colour stream.
    @location(3) color: vec4f,
    // Per-instance albedo variation (position hash), constant across the instance.
    @location(4) @interpolate(flat) tint: f32,
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
// Byte-parity mirror of `vegetation-extras/.../wind/shaders/chunks/wind_field.wgsl` (functions
// VERBATIM; `WindShaders.test.ts` pins equality), so trees move coherently with every other
// vegetation layer that consumes the same `SwmWind` block. CPU mirror: `vegetation-extras`
// `WindField` (its `uniforms` array is the producer of `fieldInfo.wind`).

const SWM_WIND_PERIOD: f32 = 256.0;
const SWM_WIND_TAU: f32 = 6.283185307179586;
const SWM_WIND_CROSS_FLUTTER: f32 = 0.35;
const SWM_WIND_FLUTTER_FLOOR: f32 = 0.25;

fn swmWindHash(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Value noise, periodic in x with `period` lattice cells so the scroll offset can wrap seamlessly.
fn swmWindNoise(p: vec2f, period: f32) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let x0 = i.x - period * floor(i.x / period);
  let x1 = (x0 + 1.0) - period * floor((x0 + 1.0) / period);
  let a = swmWindHash(vec2f(x0, i.y));
  let b = swmWindHash(vec2f(x1, i.y));
  let c = swmWindHash(vec2f(x0, i.y + 1.0));
  let d = swmWindHash(vec2f(x1, i.y + 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Gust envelope 0..1 at a world XZ position; gust blobs travel downwind and are stretched across it.
fn swmWindGust(w: SwmWind, xz: vec2f) -> f32 {
  let dir = w.p0.xy;
  let along = dot(xz, dir) * w.p1.z - w.p0.z;
  let across = dot(xz, vec2f(-dir.y, dir.x)) * w.p1.w;
  let n1 = swmWindNoise(vec2f(along, across), SWM_WIND_PERIOD);
  let n2 = swmWindNoise(vec2f(2.0 * along, 2.0 * across + 17.0), 2.0 * SWM_WIND_PERIOD);
  let n = (2.0 * n1 + n2) * (1.0 / 3.0);
  let g = clamp((n - w.p2.x) * w.p3.y, 0.0, 1.0);
  return g * g * (3.0 - 2.0 * g);
}

// Horizontal lean (tangent of the tip lean, world XZ) for one plant rooted at `rootXZ`.
// `height` = plant height in metres (vertical wind profile), `shelter` = 0 open field .. 1 fully sheltered.
fn swmWindLean(w: SwmWind, rootXZ: vec2f, height: f32, shelter: f32) -> vec2f {
  let dir = w.p0.xy;
  let g = swmWindGust(w, rootXZ);
  let profile = mix(w.p2.w, 1.0, clamp(height * w.p2.z, 0.0, 1.0));
  let phase = w.p0.w + SWM_WIND_TAU * swmWindHash(rootXZ * 0.73 + vec2f(11.1, 3.7));
  let flutter = w.p2.y * (SWM_WIND_FLUTTER_FLOOR + g);
  let alongLean = w.p1.x + w.p1.y * g + flutter * sin(phase);
  let crossLean = SWM_WIND_CROSS_FLUTTER * flutter * cos(phase);
  let lean = (dir * alongLean + vec2f(-dir.y, dir.x) * crossLean) * (profile * (1.0 - shelter));
  let len = length(lean);
  return lean * min(1.0, w.p3.x / max(len, 1e-5));
}

// Bends a vertex given relative to the plant root in world-aligned axes (after instance rotation and
// scale, before translation). Quadratic profile keeps the base planted; the drop term roughly
// preserves stem length so tips do not stretch.
fn swmWindBend(offset: vec3f, lean: vec2f, height: f32) -> vec3f {
  let h = max(height, 1e-4);
  let k = clamp(offset.y / h, 0.0, 1.0);
  let d = lean * (h * k * k);
  let drop = 0.5 * dot(d, d) / h;
  return vec3f(offset.x + d.x, offset.y - drop, offset.z + d.y);
}

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
    var worldPos = record.xyz + rotated;
    // Right-handed world space: +X right, +Y up, +Z backward -- yaw is around world +Y.
    // Shared wind field (ADR 0059 step 1b): per-instance lean from the root position hash
    // (travelling gust waves, calm phases, vertical profile via `windHeight`), quadratic bend
    // profile keeps the base planted and the crown leaning. `fieldInfo.windHeight` (crown top
    // at scale 1) is the master switch -- 0 = static field (fail-closed). Shelter is a constant
    // 0 in V1 (open field); canopy-density shelter arrives with ground cover. Position only:
    // the shading normal is not bent (accepted V1 approximation, see ADR 0059).
    if (fieldInfo.windHeight > 0.0) {
        let windHeight = fieldInfo.windHeight * scale;
        let lean = swmWindLean(fieldInfo.wind, record.xyz.xz, windHeight, 0.0);
        worldPos = record.xyz + swmWindBend(rotated, lean, windHeight);
    }
    let clipPos = view.vp * vec4f(worldPos, 1.0);

    o.pos = clipPos;
    o.wp = worldPos;
    o.uv = uv;
    o.n = vec3f(c * localNormal.x - s * localNormal.z, localNormal.y, s * localNormal.x + c * localNormal.z);
    o.color = color;
    let h = fieldPositionHash(record.xyz);
    o.tint = 0.85 + 0.3 * (f32(h & 0x00FFFFFFu) * (1.0 / 16777216.0));
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
@fragment
fn fsFieldDepth(i: FieldVertOut) -> @location(0) vec4f {
    fieldAlphaDiscard(i.uv);
    return vec4f(0.0, 0.0, 0.0, 1.0);
}

// ── EVSM moment variant (ADR 0043, `field_evsm_pull`) ─────────────────────────────────────────
// Mirrors EvsmMoment.frag.wgsl byte-for-byte semantics: `i.pos.z` is the rasterized [0,1]
// fragment depth, unwarped and exponentially warped into the 4 moment channels the cascade
// moment pass stores -- moment variance stays correct for field casters.
@fragment
fn fsFieldEvsm(i: FieldVertOut) -> @location(0) vec4f {
    fieldAlphaDiscard(i.uv);
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
// blend-free, normal-offset bias as lighting_pbr.wgsl) + irradiance/ambient, two-sided normals, and the
// ADR 0060 leaf backlight (wrap from the unlit side + forward lobe toward the sun, transmission
// shadow sampled `backlight.w` metres toward the sun) weighted by the colour alpha mask. No
// specular. Two output shapes keep the pass's attachment count valid (1 or 2
// targets, see MainRenderPass normal buffer).
fn fieldShadingNormal(i: FieldVertOut, frontFacing: bool) -> vec3f {
    let n = normalize(i.n);
    return select(-n, n, frontFacing);
}

fn fieldColorShade(i: FieldVertOut, frontFacing: bool) -> vec4f {
    fieldAlphaDiscard(i.uv);
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
        let samplePos = i.wp + N * global.dirShadowBias[cascadeIndex] * (1.0 - dotNL);
        let shadowPos = global.cascadeMatrices[cascadeIndex] * vec4f(samplePos, 1.0);
        shadow = getShadowDirMain(u_dirShadowMap, shadowSampler, shadowPos, cascadeIndex, global.dirShadowInfo.x);
        if (backlightOn) {
            let backPos = global.cascadeMatrices[cascadeIndex] * vec4f(i.wp + L * fieldInfo.backlight.w, 1.0);
            backShadow = getShadowDirMain(u_dirShadowMap, shadowSampler, backPos, cascadeIndex, global.dirShadowInfo.x);
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
