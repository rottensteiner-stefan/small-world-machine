// GPU-resident particle simulation for `GPUParticleSystem` (WebGPU-only). Runtime assembly:
//   renderer.computeStructsChunk()  // group(0)-only view of structs.wgsl -> `global`
//   + this file
// giving `@group(0)` (GlobalUniforms: `global.vp`/`global.viewPos`/`global.projScale`) for free;
// this file only declares `@group(1)` bindings 21..30 (slots 21+ keep clear of the structs
// chunk's group(1) bindings 1..20, which some tooling assemblies inline).
//
// THREE-STAGE PIPELINE -- each stage runs in its OWN compute pass, recorded strictly in order by
// `GPUParticleSystem.recordSimulation()` (webgpu's memory model: a compute-pass boundary is a full
// memory barrier, whereas two dispatches inside one pass are NOT spec-guaranteed to be coherent):
//   csEmit            pops `emitCount` dead slots off the free list and initializes them
//   csSimulate        integrates gravity/wind, screen-space depth+normal collision (ADR 0028),
//                     reaps dead particles back onto the free list, appends survivors
//   csPrepareIndirect writes the indirect-draw argument block and resets the append cursor.
// Each stage therefore sees the previous stage's storage writes.
//
// ALIVE-INDEX PING-PONG IS HOST-SIDE: WGSL cannot swap storage bindings, so the host binds TWO
// physical alive-index buffers with a per-frame parity (frame N: simulate reads buffer A,
// emit/survivors append to B, the draw reads B; frame N+1 the roles swap). csSimulate always
// reads binding 25 ("list produced last frame") and appends to binding 26 ("list the draw reads
// this frame"); csPrepareIndirect snapshots the append cursor into the arguments it must persist
// -- the one thing the shader CAN persist across the host rotation.
//
// ZERO CPU READBACK: the draw instance count lives in the GPU counters buffer and
// `drawIndexedIndirect(counters, 0)` becomes a native no-op when the pool is empty -- the
// GPU-side equivalent of the `InstancedMesh` zero-count skip.
//
// POOL PARTITION (`@invariant S34-POOL-PARTITION`): the slot pool is partitioned into
// (alive + dead) == capacity at all times. csEmit can never pop more dead slots than exist (the
// bounded CAS pop below never underflows the counter) and csSimulate reaps exactly the particles
// whose remaining life expired, so both the alive-index list and the dead free list stay within
// [0, capacity) -- storage buffers can never overrun regardless of `emitCount`.
//
// SCREEN-SPACE COLLISION (`@invariant S34-SCREEN-COLLISION-TAPS`): exactly TWO texel loads per
// colliding particle -- one opaque depth tap, and only if the depth tap reports a surface within
// the collision slab, one ADR 0028 normal tap. No extra VRAM is allocated.

struct GpuParticleParams {
    // u32 lanes: capacity, emitCount, collisionEnabled, seed
    u0: vec4u,
    // f32: deltaTime, time, collisionThickness (world units along the view ray), bounce
    u1: vec4f,
    // gravity.xyz, speedFactor
    v2: vec4f,
    // wind.xyz, alphaMul
    v3: vec4f,
    // spawnMin.xyz, minSize (quad half-extent radius)
    v4: vec4f,
    // spawnMax.xyz, maxSize
    v5: vec4f,
    // minLife, maxLife, pad, pad
    v6: vec4f,
    // baseColor.rgb, baseColor.a
    v7: vec4f,
    // padding to an exact 256-byte uniform buffer
    _pad: array<vec4f, 8>,
}

// First five u32 lanes ARE the IndirectArgs block in exactly the order
// `drawIndexedIndirect` (indexCount, instanceCount, firstIndex, baseVertex, baseInstance) reads
// them, so `pass.drawIndexedIndirect(countersBuffer, 0)` needs no separate argument buffer.
struct CountersAndIndirectArgs {
    drawIndexCount: u32,
    drawInstanceCount: u32,
    drawFirstIndex: u32,
    drawBaseVertex: u32,
    drawBaseInstance: u32,
    // Alive slots to process next frame (== survivors + freshly emitted this frame).
    simulateCount: u32,
    // LIFO free-list size; atomically popped by csEmit and pushed by csSimulate.
    numDead: atomic<u32>,
    // Append cursor into `aliveIndicesNext`; reset by csPrepareIndirect every frame.
    appendCursor: atomic<u32>,
}

@group(1) @binding(21) var<storage, read_write> positionsAndSizes: array<vec4f>;   // xyz = world pos, w = radius (quad half-extent)
@group(1) @binding(22) var<storage, read_write> velocitiesAndLives: array<vec4f>; // xyz = velocity, w = remaining life (s)
@group(1) @binding(23) var<storage, read_write> colors: array<vec4f>;             // NON-premultiplied rgba (alpha in w); the draw fragment premultiplies on output
@group(1) @binding(24) var<storage, read_write> deadIndices: array<u32>;          // LIFO free list of dead slots
@group(1) @binding(25) var<storage, read_write> aliveIndicesCurr: array<u32>;     // slots to simulate this frame (ping-pong A)
@group(1) @binding(26) var<storage, read_write> aliveIndicesNext: array<u32>;     // survivors+emitted -> next frame's current (ping-pong B)
@group(1) @binding(27) var<storage, read_write> counters: CountersAndIndirectArgs;
@group(1) @binding(28) var<uniform> params: GpuParticleParams;
@group(1) @binding(29) var depthTex: texture_depth_2d;   // opaque scene depth (_depthTexture, depth32float)
@group(1) @binding(30) var normalTex: texture_2d<f32>;   // rg16float oct-encoded world normals (ADR 0028)

// ── deterministic per-lane hashing (no texture fetches) ──────────────────────────────────────

fn hash11(s: u32) -> u32 {
    var h = s;
    h = ((h >> 16u) ^ h) * 0x45d9f3bu;
    h = ((h >> 16u) ^ h) * 0x45d9f3bu;
    return (h >> 16u) ^ h;
}

fn rnd01(h: u32) -> f32 {
    return f32(h & 0x00FFFFFFu) * (1.0 / 16777216.0);
}

fn rndUnit(h: u32) -> vec3f {
    let u = rnd01(hash11(h + 0xAu)) * 2.0 - 1.0;
    let phi = rnd01(hash11(h + 0xBu)) * 6.283185307179586;
    let r = sqrt(max(1.0 - u * u, 0.0));
    return vec3f(r * cos(phi), u, r * sin(phi));
}

// ── dead free list ──────────────────────────────────────────────────────────────────────────

// Lock-free bounded pop. A plain atomicSub would wrap to 0xFFFFFFFF on an empty list and corrupt
// the stack forever (every later push would then write out of bounds); a compare-exchange loop
// keeps the counter inside [0, capacity]. Returns 0xFFFFFFFFu when the list is empty.
fn tryPopDeadIndex() -> u32 {
    loop {
        let cur = atomicLoad(&counters.numDead);
        if (cur == 0u) {
            return 0xFFFFFFFFu;
        }
        let res = atomicCompareExchangeWeak(&counters.numDead, cur, cur - 1u);
        if (res.exchanged) {
            let slot = cur - 1u;
            // Only this lane owns `slot` (it won the CAS), and csSimulate -- the only writer of
            // deadIndices -- runs in a later dispatch, so this read can never race a push.
            return deadIndices[slot];
        }
    }
}

// ── csEmit ──────────────────────────────────────────────────────────────────────────────────

@compute @workgroup_size(64)
fn csEmit(@builtin(global_invocation_id) gid: vec3u) {
    let lane = gid.x;
    if (lane >= params.u0.y) {
        return;
    }
    let idx = tryPopDeadIndex();
    if (idx == 0xFFFFFFFFu) {
        return;
    }

    // Frame time bits (`params.u1.y`, bit-cast) are mixed in so every emit dispatch draws fresh
    // randoms; CPU twin: `s34FrameSeed`.
    let seed = hash11((params.u0.w ^ bitcast<u32>(params.u1.y)) ^ (lane * 0x9E3779B9u));
    let pos = params.v4.xyz
        + (params.v5.xyz - params.v4.xyz)
            * vec3f(rnd01(hash11(seed + 0x10u)), rnd01(hash11(seed + 0x11u)), rnd01(hash11(seed + 0x12u)));
    let radius = mix(params.v4.w, params.v5.w, rnd01(hash11(seed + 0x13u)));
    let vel = rndUnit(seed) * params.v2.w;
    let life = mix(params.v6.x, params.v6.y, rnd01(hash11(seed + 0x14u)));
    let tint = 0.8 + 0.4 * rnd01(hash11(seed + 0x15u));

    positionsAndSizes[idx] = vec4f(pos, radius);
    velocitiesAndLives[idx] = vec4f(vel, life);
    colors[idx] = vec4f(params.v7.rgb * tint * params.v3.w, params.v7.a);

    // Newly spawned slots are handed straight to the draw set for THIS frame (their spawn
    // position/velocity are already initialized); simulation takes over next frame.
    let slot = atomicAdd(&counters.appendCursor, 1u);
    if (slot < params.u0.x) {
        aliveIndicesNext[slot] = idx;
    }
}

// ── ADR 0028 screen-space collision ─────────────────────────────────────────────────────────

// Mirrors structs.wgsl's octDecode() under a distinct name (the compute chunk only carries the
// group(0) half of structs.wgsl, so the helper is not available there). Out-of-range texels
// (NORMAL_TARGET_CLEAR = [-2,-2], "no normal recorded") resolve to world up -- the documented
// fallback when the normal buffer is off or a texel was never written.
fn decodeCollisionNormal(e: vec2f) -> vec3f {
    if (abs(e.x) > 1.5 || abs(e.y) > 1.5) {
        return vec3f(0.0, 1.0, 0.0);
    }
    let n = vec3f(e.x, e.y, 1.0 - abs(e.x) - abs(e.y));
    let folded = (vec2f(1.0) - abs(n.yx)) * select(vec2f(-1.0), vec2f(1.0), n.xy >= vec2f(0.0));
    let xy = select(n.xy, folded, n.z < 0.0);
    return normalize(vec3f(xy, n.z));
}

// Reflects `velocity` off `normal` with restitution, then separates the particle from the
// surface by its own radius so the next integration step cannot re-enter the surface.
fn resolveCollision(p: ptr<function, vec4f>, v: ptr<function, vec4f>, normal: vec3f) {
    let inv = 2.0 * dot(normal, (*v).xyz);
    (*v).xyz = ((*v).xyz - inv * normal) * params.u1.w;
    (*p).xyz += normal * ((*p).w + 0.01);
}

// Projects the particle to the opaque depth texture, and only when a surface lies within
// `params.u1.z` world units (measured along the view ray -- exact per particle, no projection
// internals) reflects velocity off the ADR 0028 surface normal. Exactly two texel loads.
fn collisionProbe(p: ptr<function, vec4f>, v: ptr<function, vec4f>) {
    let clip = global.vp * vec4f((*p).xyz, 1.0);
    if (clip.w <= 0.0001) {
        return;
    }
    let ndc = clip.xy / clip.w;
    if (any(abs(ndc) > vec2f(1.0))) {
        return;
    }
    let pz = clip.z / clip.w;
    if (pz <= 0.0 || pz >= 1.0) {
        return;
    }

    // NDC Y-up -> texel V-down, exactly the convention hzb_visibility_test.wgsl uses.
    let uv = vec2f(ndc.x * 0.5 + 0.5, 1.0 - (ndc.y * 0.5 + 0.5));
    let dim = vec2f(textureDimensions(depthTex));
    let px = vec2i(clamp(uv * dim, vec2f(0.0), dim - vec2f(1.0)));
    let sceneZ = textureLoad(depthTex, px, 0); // texel load 1/2
    if (!(sceneZ < pz)) {
        return;
    }

    let toCam = global.viewPos.xyz - (*p).xyz;
    let dist = length(toCam);
    if (dist < params.u1.z) {
        // Already inside the collision slab -- reflect off the documented up fallback.
        resolveCollision(p, v, vec3f(0.0, 1.0, 0.0));
        return;
    }
    if (dist < 0.0001) {
        return;
    }

    // The world-space slab maps to a per-particle depth interval between pz and pzNear; the
    // surface is within `collisionThickness` iff its depth lies inside it.
    let pNear = (*p).xyz + (toCam / dist) * params.u1.z;
    let clipNear = global.vp * vec4f(pNear, 1.0);
    let pzNear = clipNear.z / clipNear.w;
    if (sceneZ < pzNear) {
        return;
    }

    let nrg = textureLoad(normalTex, px, 0).xy; // texel load 2/2
    let n = decodeCollisionNormal(nrg);
    resolveCollision(p, v, n);
}

// ── csSimulate ───────────────────────────────────────────────────────────────────────────────

@compute @workgroup_size(64)
fn csSimulate(@builtin(global_invocation_id) gid: vec3u) {
    let lane = gid.x;
    if (lane >= counters.simulateCount) {
        return;
    }
    let idx = aliveIndicesCurr[lane];

    var pos = positionsAndSizes[idx];
    var vel = velocitiesAndLives[idx];
    let life = vel.w;
    // A slot spawned with life <= 0 (minLife <= 0) must still return to the dead list below;
    // an early return here would drop it from both lists for good (S34-POOL-PARTITION).
    var newLife = life;
    if (life > 0.0) {
        vel.xyz += (params.v2.xyz + params.v3.xyz) * params.u1.x;
        pos.xyz += vel.xyz * params.u1.x;

        if (params.u0.z != 0u) {
            collisionProbe(&pos, &vel);
        }

        newLife = life - params.u1.x;
        vel.w = newLife;
    }
    if (newLife > 0.0) {
        positionsAndSizes[idx] = pos;
        velocitiesAndLives[idx] = vel;
        let slot = atomicAdd(&counters.appendCursor, 1u);
        if (slot < params.u0.x) {
            aliveIndicesNext[slot] = idx;
        }
    } else {
        let slot = atomicAdd(&counters.numDead, 1u);
        if (slot < params.u0.x) {
            deadIndices[slot] = idx;
        }
    }
}

// ── csPrepareIndirect ───────────────────────────────────────────────────────────────────────-

// Single-workgroup stage: writes the IndirectArgs block plus the next frame's `simulateCount`,
// then resets the append cursor. Deterministic by construction (one lane, no atomics needed).
// The "next" list whose count it snapshots becomes the "current" list next frame ONLY through
// the host's per-frame parity rotation -- the shader itself cannot rotate storage bindings.
@compute @workgroup_size(1)
fn csPrepareIndirect() {
    let c = atomicLoad(&counters.appendCursor);
    counters.drawIndexCount = 6u;
    counters.drawInstanceCount = c;
    counters.drawFirstIndex = 0u;
    counters.drawBaseVertex = 0u;
    counters.drawBaseInstance = 0u;
    counters.simulateCount = c;
    atomicStore(&counters.appendCursor, 0u);
}
