// Draw stage for `GPUParticleSystem` (WebGPU-only, camera-facing billboards). Runtime assembly:
//   renderer.computeStructsChunk()  // group(0)-only view of structs.wgsl -> `global`
//   + this file
// giving `global.vp`/`global.projScale`; this file only declares its own `@group(1)` bindings.
//
// Camera-facing quads are built in CLIP space with ZERO view-basis inputs (no camRight/camUp
// uniforms -- GlobalUniformLayout stays untouched): dropping the world position through
// `global.vp` yields its clip position, and an NDC corner offset of
// `corner * radius * global.projScale / clip.w` moves each vertex a camera-facing, screen-aligned
// amount -- the same world-radius->NDC-radius identity `worldRadiusToNdcRadius()`
// (screen_footprint.wgsl) uses. The billboard keeps the particle's projective depth, so the
// render pass's depth attachment (depthCompare "less-equal", depth write off) rejects quads
// occluded by the opaque scene.
//
// The pipeline blends ADDITIVELY (src=1,dst=1) with premultiplied output; per-particle RGBA comes
// from the `colors` storage buffer as NON-premultiplied data (alpha in w) and the fragment applies
// the premultiply `rgb * alpha` exactly once -- the storage write in csEmit never pre-multiplies.
//
// @invariant S34-SCREEN-COLLISION-TAPS is enforced in the simulate stage (exactly 2 texel loads
// per colliding particle); this draw stage performs no texture loads at all.

const PARTICLES_QUAD_CORNER: array<vec2f, 4> = array<vec2f, 4>(
    vec2f(-1.0, -1.0), // local vertex 0
    vec2f(1.0, -1.0),  // local vertex 1
    vec2f(1.0, 1.0),   // local vertex 2
    vec2f(-1.0, 1.0),  // local vertex 3
);

@group(1) @binding(21) var<storage, read> positionsAndSizes: array<vec4f>; // xyz = world pos, w = radius (quad half-extent)
@group(1) @binding(22) var<storage, read> colors: array<vec4f>;            // NON-premultiplied rgba; premultiplied on output below
// Pool slots are NOT a contiguous 0..n prefix (dead free list takes arbitrary slots), so the
// instance index must be mapped through THIS frame's emitted+survivor list -- the same "next"
// list csEmit/csSimulate appended to this frame (host binds the correct physical buffer through
// its parity rotation; see gpu_particles.wgsl head comment).
@group(1) @binding(23) var<storage, read> aliveIndices: array<u32>;

struct VsIn {
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32,
}

struct VsOut {
    @builtin(position) clipPos: vec4f,
    @location(0) color: vec4f,
}

@vertex
fn vsParticle(in: VsIn) -> VsOut {
    // Instances 0..drawInstanceCount map through this frame's alive list to pool slots -- see
    // the binding comment: arbitrary LIFO-recycled slots must never index storage directly.
    let slot = aliveIndices[in.instanceIndex];
    let data = positionsAndSizes[slot];
    let clip = global.vp * vec4f(data.xyz, 1.0);
    let corner = PARTICLES_QUAD_CORNER[in.vertexIndex];
    // Clip-space offset == NDC offset * clip.w, so after the perspective divide the quad spans
    // `corner * radius * projScale / clip.w` NDC: it shrinks with distance (true perspective).
    let clipOffset = corner * data.w * global.projScale;
    var out: VsOut;
    out.clipPos = vec4f(clip.xy + clipOffset, clip.z, clip.w);
    out.color = colors[slot];
    return out;
}

@fragment
fn fsParticle(in: VsOut) -> @location(0) vec4f {
    // ADR 0049: the tint is a display-referred sRGB authoring value (like Basic/Sprite).
    return vec4f(displayToTarget(in.color.rgb) * in.color.a, in.color.a);
}
