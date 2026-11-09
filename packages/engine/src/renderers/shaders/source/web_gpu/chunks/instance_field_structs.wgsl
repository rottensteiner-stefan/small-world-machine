// Shared `@group(2)` field-data declarations for the instance-field GPU lane (ADR 0059 step 1,
// frozen `INSTANCE_FIELD_BIND_GROUP`, folded to 2 in S2). Included by BOTH the cull compute module
// (`compute/instance_cull.wgsl`) and the pulled-draw module (`instance_field/field_pull.wgsl`)
// so the uniform structs and the bind-group slot numbering can never drift between the two
// consumers of the same per-field bind group (Bob D-1/D-2 single-source discipline).
//
// Requires `computeStructsChunk()` prepended (group(0)-only structs) -- this chunk itself only
// declares `@group(2)` resources (plus the field-owned `@group(3)` per-view uniform in the
// render module). The group-0 `global` binding is consumed by the cull (`global.viewPos`,
// `global.vp`, `global.projScale`, `global.resolution`) and the color fragment (`global.ambient*`
// / `global.dirLight*`); the group-3 `view` binding is consumed by the pull vertex. Groups 1 is
// deliberately absent (null in the pipeline layout): the field declares no material bindings.

// Shared vegetation wind block (ADR 0059 step 1b `SwmWind`): 4 x vec4f, written by the field's
// producer (e.g. `@small-world-machine/vegetation-extras` `WindField`), consumed by the pull
// vertex. Mirrors `vegetation-extras/.../wind/shaders/chunks/wind_field.wgsl`; byte parity is
// pinned by `WindShaders.test.ts`.
struct SwmWind {
    p0: vec4f,
    p1: vec4f,
    p2: vec4f,
    p3: vec4f,
}

// Static per-field composed data, bound once per field (non-dynamic uniform). All fields below
// are derived at setup from the authored options (Bob D-2); the ONLY per-frame members are the
// `wind` words, rewritten by the system every frame (like the HZB mip-count patch).
struct FieldInfo {
    // Count -- per-(view x bucket) page capacity in indices (clamp-at-capacity policy).
    pageCapacity: u32,
    // Count -- prototype roster size (>= 1, validated at register).
    prototypeCount: u32,
    // Count -- records in `fieldRecords`; dispatch bound = ceil(instanceCount / 64).
    instanceCount: u32,
    // Count -- mip levels of the bound previous-frame pyramid (mip clamp, >= 1).
    hzbMipCount: u32,
    // px -- mirror of `InstanceFieldOptions.cullPixelSize` (IF-PROJECTED-SIZE gate).
    cullPixelSize: f32,
    // [0,1] -- optional alpha-cutout threshold; 0 disables the alpha test (no map needed).
    alphaTest: f32,
    _pad: vec2f,
    // linear rgb -- leaf backlight tint (ADR 0060 semantics, black = off); w = transmission
    // shadow offset toward the sun in metres. Scaled per vertex by the colour alpha (foliage mask).
    backlight: vec4f,
    // metres -- prototype crown-top height at scale 1 (vertical wind profile / bend normalizer);
    // 0 disables wind entirely (fail-closed: no sway without an authored height).
    windHeight: f32,
    // P2 (ADR 0059 step 2): 0 = dither crossfade (candidate A, `field_pull.wgsl`); != 0 =
    // candidate C (hard switch + hysteresis in the cull) -- the fragment skips the LOD-mix
    // dither entirely. Reuses a previously padded word: byte offsets stay frozen (default 0 =
    // dither on matches the zeroed CPU write, no layout shift).
    lodDitherMode: u32,
    _pad3: vec2f,
    // Per-frame shared wind block (see `SwmWind` above); rewritten every frame by the system.
    wind: SwmWind,
}

// Per-frame, per-view dynamic-offset cull parameter block (256 B, dynamic offset per view).
// Byte layout mirrors the frozen `CullParams` TS interface; `segmentBase` is the view base
// `view * MAX_LOD_BUCKETS` -- the bucket selector is resolved in-shader from projected size.
struct CullParams {
    frustumPlanes: array<vec4f, 6>, // inward convention, order = Frustum.planes (right,left,bottom,top,near,far)
    viewportHeightPx: f32,          // primary-view metric input (IF-PROJECTED-SIZE)
    fovRadiansY: f32,               // primary-view metric input
    hzbEnabled: u32,                // 0/1 -- previous-frame pyramid may be consumed for this view
    hzbSkip: u32,                   // 0/1 -- one-frame camera-cut skip (IF-CAMERA-CUT-HZB-SKIP)
    segmentBase: u32,               // FULL (view x bucket) segment base `bv` (block index of the
                                    //   per-segment 256 B param block the draw/cull binds; the cull
                                    //   adds the in-shader bucket to this view base)
    cullMode: u32,                  // 0=C, 1=A, 2=B(->A path until the S3 spike)
    // ADR 0059 step 2 (P2) per-view LOD transition state (written by the coordinator every frame;
    // identical across views except `lodBiasBuckets`, which shadow views set to shift the main
    // camera's bucket choice toward the coarse end -- field-scoped knobs mirrored per view).
    lodBiasBuckets: u32,            // coarsening offset in LOD levels (shadow views; 0 = main choice)
    lodCrossfadeBand: f32,          // [0,1] -- transition band as a fraction of each threshold; 0 = hard switch
    lodHysteresis: f32,             // [0,1] -- per-instance deterministic threshold jitter fraction
    lodBiasPx: f32,                 // px -- additive per-tier threshold bias (negative = coarser earlier)
    _pad: array<u32, 30>,
}

// Visibility-layout contract (single source for blob group 2):
//   binding 0 records:              VERTEX | COMPUTE
//   binding 1 prototype info:       COMPUTE
//   binding 2 indirect args:        COMPUTE
//   binding 3 visible indices:      VERTEX | COMPUTE
//   binding 4 previous HZB tex:     COMPUTE
//   binding 5 field info (uniform): VERTEX | FRAGMENT | COMPUTE
//   binding 6 cull params (uniform, dynamic): VERTEX | COMPUTE
//   binding 7 alpha map:            FRAGMENT
//   binding 8 alpha sampler:        FRAGMENT
//   binding 9 lod maxima:           COMPUTE
//   binding 10 prototype ranges:    COMPUTE
//   binding 11 lod blend (P2):      VERTEX | COMPUTE
//   (bindings 2, 3 and 11 are declared by each consumer module -- their access differs per stage:
//    the cull writes them `read_write`, the pull vertex only reads them; WebGPU forbids
//    `read_write` storage in the vertex stage, validated on real Metal.)
//   binding 11 LOD blend pages:     VERTEX (pull reads) | COMPUTE (cull writes) -- P2 step 2
//                                   per-(segment x slot) signed crossfade blend, page-indexed
//                                   like `fieldVisibleIndices`. Declared PER CONSUMER (draw:
//                                   `field_pull.wgsl`, cull: `instance_cull.wgsl`) exactly like
//                                   bindings 2/3 -- WRITE (compute) vs READ (vertex) visibility
//                                   cannot share one module declaration. Slot number 11 is the
//                                   shared truth documented here; see field_pull.wgsl for the
//                                   value/sign semantics (veg-p2-bob + veg-p2-erin contract).
@group(2) @binding(0) var<storage, read> fieldRecords: array<vec4f>;           // 16 B/inst: xyz=pos, w=packedPose
@group(2) @binding(1) var<storage, read> fieldPrototypeInfo: array<vec4f>;     // x = boundingRadius @ scale 1
// bindings 2 (`fieldIndirectArgs`) and 3 (`fieldVisibleIndices`) are declared by each consumer
// module, not here: their access differs per stage. The cull writes them (`read_write`, the
// instance cursor atomic), the pull vertex only reads indices -- and WebGPU forbids `read_write`
// storage in the vertex stage (validated on real Metal: the shared declaration broke the draw).
@group(2) @binding(4) var fieldPrevHzb: texture_2d<f32>;                       // previous-frame pyramid
@group(2) @binding(5) var<uniform> fieldInfo: FieldInfo;
@group(2) @binding(6) var<uniform> cullParams: CullParams;
@group(2) @binding(7) var u_fieldAlphaMap: texture_2d<f32>;
@group(2) @binding(8) var fieldAlphaSampler: sampler;
@group(2) @binding(9) var<storage, read> fieldLodMaxima: array<vec4f>;         // row p*2+b/4, lane b%4 (f32 px)
@group(2) @binding(10) var<storage, read> fieldPrototypeRange: array<vec4u>;   // x=start, y=count, z=bucketCount
