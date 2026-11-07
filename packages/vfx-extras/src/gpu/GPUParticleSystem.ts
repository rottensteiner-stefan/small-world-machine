import type { GpuParticleDrawable, GpuParticlePassHost } from "@small-world-machine/engine";

/**
 * WebGPU-only, GPU-resident particle system (`@invariant S34-GPU-CPU-PARITY`,
 * `@invariant S34-POOL-PARTITION`, `@invariant S34-SCREEN-COLLISION-TAPS`).
 *
 * Runs the whole simulation on the GPU: a three-stage compute pipeline (csEmit -> csSimulate ->
 * csPrepareIndirect) drives `drawIndexedIndirect` with ZERO CPU readback -- the instance count
 * lives in a GPU counters buffer and the draw becomes a native no-op when the pool is empty
 * (GPU-side equivalent of the `InstancedMesh` zero-count skip). Screen-space collision samples
 * the opaque scene depth + ADR 0028 normal buffer (exactly two texel loads per colliding
 * particle). WebGPU runs at maximal capability by design -- no WebGL2-style fallback path exists
 * or is needed; lower tiers keep their CPU `SdfColliderAffector` path untouched.
 *
 * A system is NOT a scene object. Register it with
 * `WebGPURenderer.registerGpuParticleSystem(this)`; the renderer feeds it a `GpuParticlePassHost`
 * (device, shared global bindings, composed WGSL, frame-live depth/normal views) and the engine's
 * `GpuParticlesPassGPU` drives `recordSimulation()` / `recordIndirectDraw()` every frame.
 *
 * The alive-index ping-pong is HOST-SIDE (WGSL cannot swap storage bindings): two physical
 * alive buffers rotate roles per frame through parity-keyed bind groups. `_frameParity` selects
 * the bind group pair for the simulation and is advanced at the END of `recordSimulation()`
 * (every simulation consumes "curr" and produces "next", so the rotation belongs to it, never to
 * a draw: a skipped pass or a second draw cannot desync the ping-pong). Draws read the list the
 * LAST simulation wrote, i.e. `_frameParity ^ 1`.
 *
 * JSDoc note: WGSL clauses are the exact byte-level contract; `s34GpuSpawnOracle()` is the CPU
 * twin of `gpu_particles.wgsl` csEmit (same hash constants, same lane math) -- the parity golden
 * in `tests/gpu/GPUParticleSystemParity.test.ts` pins them.
 */

/** Index count of a quad billboard (two triangles). */
const QUAD_INDEX_COUNT = 6;
/** Compute workgroup width of the emit/simulate stages (`gpu_particles.wgsl`). */
const WORKGROUP_SIZE = 64;
/** Exact byte size of `GpuParticleParams` (see `gpu_particles.wgsl`, `_pad: array<vec4f, 8>`). */
const PARAMS_BYTE_SIZE = 256;
/** `CountersAndIndirectArgs` = 8 u32 = 32 bytes (first 5 u32 are the IndirectArgs block). */
const COUNTERS_BYTE_SIZE = 32;
/** Indirect-arg block starts at byte 0 of the counters buffer. */
const INDIRECT_ARGS_OFFSET = 0;
/** ADR 0028 clear value written into the 1x1 world-up fallback normal texture. */
const NORMAL_CLEAR_X = -2;
const NORMAL_CLEAR_Y = -2;
/** Byte offset of each vec4 lane inside GpuParticleParams (must match the WGSL struct). */
const LANE_U1 = 16;
const LANE_V2 = 32;
const LANE_V3 = 48;
const LANE_V4 = 64;
const LANE_V5 = 80;
const LANE_V6 = 96;
const LANE_V7 = 112;

/** Immutable 3-component vector accepted by the public API (no engine math allocation). */
export interface GpuParticleVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Immutable RGBA accepted by the public API. */
export interface GpuParticleVec4 extends GpuParticleVec3 {
  readonly w: number;
}

export interface GpuParticleSpawnBox {
  readonly min: GpuParticleVec3;
  readonly max: GpuParticleVec3;
}

export interface GpuParticleSizeRange {
  readonly min: number;
  readonly max: number;
}

export interface GpuParticleLifeRange {
  readonly min: number;
  readonly max: number;
}

export interface GPUParticleSystemOptions {
  /**
   * Fixed slot-pool size. Defaults to 4096. The pool is partitioned into (alive + dead) ==
   * capacity at all times (`@invariant S34-POOL-PARTITION`); the GPU never overruns it.
   */
  capacity?: number;
  /** Axis-aligned spawn volume; every emitted particle starts inside it. */
  spawnBox: GpuParticleSpawnBox;
  /** Quad half-extent radius per particle. Defaults to [0.05, 0.2]. */
  sizeRange?: GpuParticleSizeRange;
  /** Remaining-life range in seconds. Defaults to [1, 4]. */
  lifeRange?: GpuParticleLifeRange;
  /** Gravity acceleration (world units/s^2). Defaults to zero. */
  gravity?: GpuParticleVec3;
  /** Constant wind acceleration. Defaults to zero. */
  wind?: GpuParticleVec3;
  /** Initial speed scale of emitted particles. Defaults to 1. */
  speedFactor?: number;
  /**
   * Screen-space collision slab thickness along the view ray, in world units. 0 (default)
   * disables depth/normal collision entirely (the two texel loads are skipped).
   */
  collisionThickness?: number;
  /** Collision restitution 0..1 (1 = perfectly elastic). Defaults to 0.5. */
  bounce?: number;
  /** Base RGBA tint of emitted particles. Defaults to white, alpha 1. */
  baseColor?: GpuParticleVec4;
  /** Global alpha multiplier applied at emit time. Defaults to 1. */
  alphaMul?: number;
  /** u32 seed for the deterministic per-lane spawn hash. Defaults to 1. */
  seed?: number;
}

/** A spawned particle exactly as `csEmit` initializes it (`s34GpuSpawnOracle` twin). */
export interface GpuSpawnSample {
  readonly posX: number;
  readonly posY: number;
  readonly posZ: number;
  readonly radius: number;
  readonly velX: number;
  readonly velY: number;
  readonly velZ: number;
  readonly life: number;
  readonly colorR: number;
  readonly colorG: number;
  readonly colorB: number;
  readonly colorA: number;
}

/** Numeric face of the spawn parameters, shared by the WGSL struct and its CPU oracle. */
export interface GpuSpawnOracleParams {
  readonly seed: number;
  readonly spawnMinX: number;
  readonly spawnMinY: number;
  readonly spawnMinZ: number;
  readonly spawnMaxX: number;
  readonly spawnMaxY: number;
  readonly spawnMaxZ: number;
  readonly minSize: number;
  readonly maxSize: number;
  readonly minLife: number;
  readonly maxLife: number;
  readonly speedFactor: number;
  readonly alphaMul: number;
  readonly baseColorR: number;
  readonly baseColorG: number;
  readonly baseColorB: number;
  readonly baseColorA: number;
}

/** WGSL `hash11` twin -- the exact same separable integer hash as `gpu_particles.wgsl`. WGSL
 * multiplies u32 with wrap-around semantics, so this MUST use `Math.imul` (a plain JS `*` would
 * be 64-bit float math and overflow 2^53 on the second mix). */
export function s34Hash11(s: number): number {
  let h = s >>> 0;
  h = Math.imul((h >>> 16) ^ h, 0x45d9f3b) >>> 0;
  h = Math.imul((h >>> 16) ^ h, 0x45d9f3b) >>> 0;
  return ((h >>> 16) ^ h) >>> 0;
}

/** WGSL `rnd01` twin: 24 mantissa bits mapped to [0, 1). */
export function s34Rnd01(h: number): number {
  return (h & 0x00ffffff) * (1 / 16777216);
}

const _seedF32 = new Float32Array(1);
const _seedU32 = new Uint32Array(_seedF32.buffer);

/**
 * CPU twin of the per-dispatch seed mix in `csEmit`: `params.u0.w ^ bitcast<u32>(params.u1.y)`
 * (f32 frame time bits). Feeding the result as `seed` into `s34GpuSpawnOracle` reproduces the
 * lane math of that frame; a different `time` yields a different spawn pattern.
 */
export function s34FrameSeed(seed: number, time: number): number {
  _seedF32[0] = time;
  return ((seed >>> 0) ^ _seedU32[0]!) >>> 0;
}

/** WGSL `rndUnit` twin: uniform direction on the unit sphere from a hashed u32. */
export function s34RndUnit(h: number): GpuParticleVec3 {
  const u = s34Rnd01(s34Hash11((h + 0xa) >>> 0)) * 2 - 1;
  const phi = s34Rnd01(s34Hash11((h + 0xb) >>> 0)) * 6.283185307179586;
  const r = Math.sqrt(Math.max(1 - u * u, 0));
  return { x: r * Math.cos(phi), y: u, z: r * Math.sin(phi) };
}

/**
 * CPU twin of `csEmit` in `gpu_particles.wgsl` -- bit-identical lane math for lane `lane` under
 * `seed` (the parity anchor for `@invariant S34-GPU-CPU-PARITY`: the GPU recipe, evaluated on
 * CPU, must reproduce the same position/life/velocity distribution; `gpu_particles.wgsl` source
 * is pinned against this oracle in `tests/gpu/GPUParticleSystemParity.test.ts`).
 */
export function s34GpuSpawnOracle(
  seed: number,
  lane: number,
  p: GpuSpawnOracleParams,
): GpuSpawnSample {
  const laneSeed = s34Hash11((seed >>> 0) ^ Math.imul(lane >>> 0, 0x9e3779b9));
  const posX =
    p.spawnMinX + (p.spawnMaxX - p.spawnMinX) * s34Rnd01(s34Hash11((laneSeed + 0x10) >>> 0));
  const posY =
    p.spawnMinY + (p.spawnMaxY - p.spawnMinY) * s34Rnd01(s34Hash11((laneSeed + 0x11) >>> 0));
  const posZ =
    p.spawnMinZ + (p.spawnMaxZ - p.spawnMinZ) * s34Rnd01(s34Hash11((laneSeed + 0x12) >>> 0));
  const radius = p.minSize + (p.maxSize - p.minSize) * s34Rnd01(s34Hash11((laneSeed + 0x13) >>> 0));
  const vel = s34RndUnit(laneSeed);
  const life = p.minLife + (p.maxLife - p.minLife) * s34Rnd01(s34Hash11((laneSeed + 0x14) >>> 0));
  const tint = 0.8 + 0.4 * s34Rnd01(s34Hash11((laneSeed + 0x15) >>> 0));
  return {
    posX,
    posY,
    posZ,
    radius,
    velX: vel.x * p.speedFactor,
    velY: vel.y * p.speedFactor,
    velZ: vel.z * p.speedFactor,
    life,
    colorR: p.baseColorR * tint * p.alphaMul,
    colorG: p.baseColorG * tint * p.alphaMul,
    colorB: p.baseColorB * tint * p.alphaMul,
    colorA: p.baseColorA,
  };
}

/**
 * WebGPU `GPUParticleSystem` (Bob T5/G2). See the module doc for the architectural contract.
 * Public parameter setters write into the CPU mirror only; `recordSimulation()` uploads the
 * 256-byte params block once per frame when dirty. Hot paths (`recordSimulation`,
 * `recordIndirectDraw`, `update`, setters) allocate nothing.
 */
export class GPUParticleSystem implements GpuParticleDrawable {
  private _host: GpuParticlePassHost | undefined = undefined;
  private _device: GPUDevice | undefined = undefined;
  private _active = false;

  // GPU resources (created in `attachHost`).
  private _paramsBuffer!: GPUBuffer;
  private _countersBuffer!: GPUBuffer;
  private _positionsBuffer!: GPUBuffer;
  private _velocitiesBuffer!: GPUBuffer;
  private _colorsBuffer!: GPUBuffer;
  private _deadIndicesBuffer!: GPUBuffer;
  private _indexBuffer!: GPUBuffer;
  private _fallbackNormalTexture!: GPUTexture;
  private _fallbackNormalView!: GPUTextureView;
  private _computeBGL!: GPUBindGroupLayout;
  /** Compute group 0: the `GlobalUniforms` buffer ONLY. The renderer's shared global layout carries
   * 7 compute-visible storage buffers (lights, clusters); adding this system's 7 would exceed the
   * common `maxStorageBuffersPerShaderStage` of 10 (Metal) -- 14 total. */
  private _computeGlobalBGL!: GPUBindGroupLayout;
  private _computeGlobalBindGroup!: GPUBindGroup;
  private _drawBGL!: GPUBindGroupLayout;
  private _emitPipeline!: GPUComputePipeline;
  private _simulatePipeline!: GPUComputePipeline;
  private _preparePipeline!: GPUComputePipeline;
  private readonly _drawPipelines: Map<GPUTextureFormat, GPURenderPipeline> = new Map();

  /**
   * Ping-pong alive-index buffers (host-side role rotation, see module doc). `aliveBuffers[p]`
   * is the "current" (simulate input) list on a frame with parity p; `aliveBuffers[1-p]` is the
   * "next" (emit/survivor output + draw input) list that frame.
   */
  private readonly _aliveBuffers: [GPUBuffer, GPUBuffer] = [undefined!, undefined!];
  /** Parity-selected compute bind groups: group[p] binds `aliveBuffers[p]` at 25 (curr) and
   * `aliveBuffers[1-p]` at 26 (next). */
  private readonly _computeBindGroups: [GPUBindGroup, GPUBindGroup] = [undefined!, undefined!];
  /** Parity-selected draw bind groups: group[p] binds `aliveBuffers[1-p]` at 23 (the list the
   * draw must read this frame). */
  private readonly _drawBindGroups: [GPUBindGroup, GPUBindGroup] = [undefined!, undefined!];
  private _frameParity = 0;

  // Frame-live views the compute bind groups currently reference (both rebuilt on change).
  private _boundDepthView: GPUTextureView | undefined = undefined;
  private _boundNormalView: GPUTextureView | undefined = undefined;

  // CPU mirror of `GpuParticleParams` -- exact byte layout, see the WGSL struct. Float lanes are
  // written through `_paramsF32`, the four u32 lanes (bytes 0..15) through `_paramsU32`; the two
  // views never overlap a byte.
  private readonly _paramsBytes = new ArrayBuffer(PARAMS_BYTE_SIZE);
  private readonly _paramsU32 = new Uint32Array(this._paramsBytes);
  private readonly _paramsF32 = new Float32Array(this._paramsBytes);
  private readonly _paramsU8 = new Uint8Array(this._paramsBytes);
  private _paramsDirty = true;

  private readonly _capacity: number;
  private _pendingEmit = 0;
  private _time = 0;

  constructor(options: GPUParticleSystemOptions) {
    const capacity = options.capacity ?? 4096;
    if (capacity <= 0 || !Number.isInteger(capacity)) {
      throw new Error(`[GPUParticleSystem] capacity must be a positive integer, got ${capacity}.`);
    }
    this._capacity = capacity;

    const size = options.sizeRange ?? { min: 0.05, max: 0.2 };
    const life = options.lifeRange ?? { min: 1, max: 4 };
    const gravity = options.gravity ?? { x: 0, y: 0, z: 0 };
    const wind = options.wind ?? { x: 0, y: 0, z: 0 };
    const color = options.baseColor ?? { x: 1, y: 1, z: 1, w: 1 };
    const spawn = options.spawnBox;

    this._paramsU32[0] = capacity; // u0.x
    this._paramsU32[3] = (options.seed ?? 1) >>> 0; // u0.w
    this._paramsU32[2] = (options.collisionThickness ?? 0) > 0 ? 1 : 0; // u0.z

    const f = this._paramsF32;
    f[LANE_U1 / 4 + 2] = options.collisionThickness ?? 0; // u1.z
    f[LANE_U1 / 4 + 3] = options.bounce ?? 0.5; // u1.w
    f[LANE_V2 / 4 + 0] = gravity.x;
    f[LANE_V2 / 4 + 1] = gravity.y;
    f[LANE_V2 / 4 + 2] = gravity.z;
    f[LANE_V2 / 4 + 3] = options.speedFactor ?? 1; // v2.w
    f[LANE_V3 / 4 + 0] = wind.x;
    f[LANE_V3 / 4 + 1] = wind.y;
    f[LANE_V3 / 4 + 2] = wind.z;
    f[LANE_V3 / 4 + 3] = options.alphaMul ?? 1; // v3.w
    f[LANE_V4 / 4 + 0] = spawn.min.x;
    f[LANE_V4 / 4 + 1] = spawn.min.y;
    f[LANE_V4 / 4 + 2] = spawn.min.z;
    f[LANE_V4 / 4 + 3] = size.min; // v4.w
    f[LANE_V5 / 4 + 0] = spawn.max.x;
    f[LANE_V5 / 4 + 1] = spawn.max.y;
    f[LANE_V5 / 4 + 2] = spawn.max.z;
    f[LANE_V5 / 4 + 3] = size.max; // v5.w
    f[LANE_V6 / 4 + 0] = life.min;
    f[LANE_V6 / 4 + 1] = life.max;
    f[LANE_V7 / 4 + 0] = color.x;
    f[LANE_V7 / 4 + 1] = color.y;
    f[LANE_V7 / 4 + 2] = color.z;
    f[LANE_V7 / 4 + 3] = color.w;
  }

  /** @inheritdoc -- false until `attachHost()` created every GPU resource. */
  public get particleActive(): boolean {
    return this._active;
  }

  /** @inheritdoc. Idempotent; re-attaching to a different renderer disposes the old resources. */
  public attachHost(host: GpuParticlePassHost): void {
    if (this._host === host && this._active) return;
    if (this._device) this.dispose();
    this._host = host;
    const device = host.gpuDevice;
    if (!device) {
      throw new Error(
        "[GPUParticleSystem] attachHost: renderer has no live GPU device (destroyed or not yet initialized).",
      );
    }
    this._device = device;
    this._frameParity = 0;
    this._createResources(device);
    this._active = true;
  }

  /** @inheritdoc -- frees every buffer/texture and detaches the host. Pipelines are owned by the
   * device and need no individual destruction. */
  public dispose(): void {
    if (!this._device) {
      this._host = undefined;
      this._active = false;
      return;
    }
    this._paramsBuffer.destroy();
    this._countersBuffer.destroy();
    this._positionsBuffer.destroy();
    this._velocitiesBuffer.destroy();
    this._colorsBuffer.destroy();
    this._deadIndicesBuffer.destroy();
    this._aliveBuffers[0].destroy();
    this._aliveBuffers[1].destroy();
    this._indexBuffer.destroy();
    this._fallbackNormalTexture.destroy();
    this._drawPipelines.clear();
    this._device = undefined;
    this._host = undefined;
    this._boundDepthView = undefined;
    this._boundNormalView = undefined;
    this._active = false;
    this._paramsDirty = true;
  }

  /**
   * Queues `count` particles against the next frame's csEmit stage. Over-emitting is safe: the
   * bounded CAS free-list pop never underflows, so the pool partition
   * (`@invariant S34-POOL-PARTITION`) holds regardless of the requested count.
   */
  public emit(count: number): void {
    if (count <= 0) return;
    this._pendingEmit += count;
  }

  /**
   * Per-frame CPU driver (call once per frame from the app, NOT from a render pass): advances the
   * simulation clock and bakes the pending emit count into the params mirror. Deterministic --
   * the GPU consumes exactly these values via `recordSimulation()`.
   */
  public update(deltaTime: number): void {
    this._time += deltaTime;
    // Accumulate: a second update() before the next recordSimulation() must not drop the first
    // one's dt/emit (the mirror lanes are zeroed once the GPU has consumed them).
    this._paramsF32[LANE_U1 / 4 + 0] = (this._paramsF32[LANE_U1 / 4 + 0] ?? 0) + deltaTime; // u1.x
    this._paramsF32[LANE_U1 / 4 + 1] = this._time; // u1.y
    this._paramsU32[1] = ((this._paramsU32[1] ?? 0) + this._pendingEmit) >>> 0; // u0.y
    this._pendingEmit = 0;
    this._paramsDirty = true;
  }

  public set collisionEnabled(enabled: boolean) {
    this._paramsU32[2] = enabled ? 1 : 0; // u0.z
    this._paramsDirty = true;
  }

  public set gravity(value: GpuParticleVec3) {
    this._paramsF32[LANE_V2 / 4 + 0] = value.x;
    this._paramsF32[LANE_V2 / 4 + 1] = value.y;
    this._paramsF32[LANE_V2 / 4 + 2] = value.z;
    this._paramsDirty = true;
  }

  public set wind(value: GpuParticleVec3) {
    this._paramsF32[LANE_V3 / 4 + 0] = value.x;
    this._paramsF32[LANE_V3 / 4 + 1] = value.y;
    this._paramsF32[LANE_V3 / 4 + 2] = value.z;
    this._paramsDirty = true;
  }

  public set speedFactor(value: number) {
    this._paramsF32[LANE_V2 / 4 + 3] = value;
    this._paramsDirty = true;
  }

  public set alphaMul(value: number) {
    this._paramsF32[LANE_V3 / 4 + 3] = value;
    this._paramsDirty = true;
  }

  public set collisionThickness(value: number) {
    this._paramsF32[LANE_U1 / 4 + 2] = value;
    this._paramsU32[2] = value > 0 ? 1 : 0; // u0.z -- thickness > 0 enables collision (see option doc)
    this._paramsDirty = true;
  }

  public set bounce(value: number) {
    this._paramsF32[LANE_U1 / 4 + 3] = value;
    this._paramsDirty = true;
  }

  /** @inheritdoc -- records the 3 compute stages, each in its OWN compute pass (a compute-pass
   * boundary is the spec-guaranteed memory barrier between stages). */
  public recordSimulation(ce: GPUCommandEncoder): void {
    const device = this._device;
    const host = this._host;
    if (!device || !host || !this._active) return;

    // Re-pin the compute bind groups when the frame-live depth/normal views rotated (resize,
    // offscreen-target toggle, normal-buffer enable/disable). Cheap compare, no-op in steady
    // state; both parity variants carry the same (new) views.
    this._bindCollisionViews(host);

    if (this._paramsDirty) {
      device.queue.writeBuffer(this._paramsBuffer, 0, this._paramsU8, 0, PARAMS_BYTE_SIZE);
      // dt and emit count are one-shot: zero them so a simulation WITHOUT a preceding update()
      // (pause, second camera, re-render) neither ages particles nor emits again. The zeroed
      // block stays dirty until it has been uploaded once more.
      const oneShot = this._paramsU32[1] !== 0 || this._paramsF32[LANE_U1 / 4 + 0] !== 0;
      this._paramsF32[LANE_U1 / 4 + 0] = 0;
      this._paramsU32[1] = 0;
      this._paramsDirty = oneShot;
    }
    const bindGroup = this._computeBindGroups[this._frameParity]!;

    const dispatchX = Math.ceil(this._capacity / WORKGROUP_SIZE);

    const emit = ce.beginComputePass();
    emit.setPipeline(this._emitPipeline);
    emit.setBindGroup(0, this._computeGlobalBindGroup);
    emit.setBindGroup(1, bindGroup);
    emit.dispatchWorkgroups(dispatchX);
    emit.end();

    const simulate = ce.beginComputePass();
    simulate.setPipeline(this._simulatePipeline);
    simulate.setBindGroup(0, this._computeGlobalBindGroup);
    simulate.setBindGroup(1, bindGroup);
    simulate.dispatchWorkgroups(dispatchX);
    simulate.end();

    const prepare = ce.beginComputePass();
    prepare.setPipeline(this._preparePipeline);
    prepare.setBindGroup(0, this._computeGlobalBindGroup);
    prepare.setBindGroup(1, bindGroup);
    prepare.dispatchWorkgroups(1);
    prepare.end();

    // Role rotation: the next simulation must read the list this one wrote (see module doc).
    this._frameParity ^= 1;
  }

  /** @inheritdoc -- `drawIndexedIndirect` off the counters buffer; native GPU no-op when the
   * pool is empty (draw instance count 0). Zero CPU readback by construction. */
  public recordIndirectDraw(rp: GPURenderPassEncoder): void {
    const device = this._device;
    const host = this._host;
    if (!device || !host || !this._active) return;

    const format = host.particleTargetFormat;
    let pipeline = this._drawPipelines.get(format);
    if (!pipeline) {
      pipeline = this._createDrawPipeline(device, host, format);
      this._drawPipelines.set(format, pipeline);
    }

    rp.setPipeline(pipeline);
    rp.setBindGroup(0, host.globalBindGroup);
    rp.setBindGroup(1, this._drawBindGroups[this._frameParity ^ 1]!);
    rp.setIndexBuffer(this._indexBuffer, "uint16");
    rp.drawIndexedIndirect(this._countersBuffer, INDIRECT_ARGS_OFFSET);
  }

  // ── GPU resource creation ───────────────────────────────────────────────────────────────────

  private _createResources(device: GPUDevice): void {
    this._paramsBuffer = device.createBuffer({
      size: PARAMS_BYTE_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const aliveBytes = this._capacity * 4;
    const particleBytes = this._capacity * 16;

    this._positionsBuffer = this._createStorage(device, particleBytes);
    this._velocitiesBuffer = this._createStorage(device, particleBytes);
    this._colorsBuffer = this._createStorage(device, particleBytes);
    this._aliveBuffers[0] = this._createStorage(device, aliveBytes);
    this._aliveBuffers[1] = this._createStorage(device, aliveBytes);

    // Dead free list must start as the full identity permutation [0..capacity-1] and the
    // counters with numDead == capacity + the indirect block's indexCount == 6 (quad). All
    // other state starts zeroed -- nothing is read before the first emit pop.
    this._deadIndicesBuffer = this._createStorage(device, aliveBytes, GPUBufferUsage.COPY_DST);
    const deadInit = new Uint32Array(this._capacity);
    for (let i = 0; i < this._capacity; i++) deadInit[i] = i;
    device.queue.writeBuffer(this._deadIndicesBuffer, 0, deadInit);

    this._countersBuffer = device.createBuffer({
      size: COUNTERS_BYTE_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    });
    const countersInit = new Uint32Array(COUNTERS_BYTE_SIZE / 4);
    countersInit[0] = QUAD_INDEX_COUNT; // drawIndexCount
    countersInit[6] = this._capacity; // numDead
    device.queue.writeBuffer(this._countersBuffer, 0, countersInit);

    const indices = new Uint16Array(QUAD_INDEX_COUNT);
    indices[0] = 0;
    indices[1] = 1;
    indices[2] = 2;
    indices[3] = 0;
    indices[4] = 2;
    indices[5] = 3;
    this._indexBuffer = device.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this._indexBuffer, 0, indices);

    // Documented degradation (`@invariant S34-SCREEN-COLLISION-TAPS`): when the renderer has no
    // live ADR 0028 normal view, the compute stage binds this 1x1 world-up fallback instead --
    // a binding is never left dangling. Content is the ADR 0028 clear value [-2,-2], which
    // `decodeCollisionNormal()` maps back to +Y.
    this._fallbackNormalTexture = device.createTexture({
      size: [1, 1],
      format: "rg16float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this._fallbackNormalView = this._fallbackNormalTexture.createView();
    device.queue.writeTexture(
      { texture: this._fallbackNormalTexture },
      new Float32Array([NORMAL_CLEAR_X, NORMAL_CLEAR_Y, 0, 0]),
      { bytesPerRow: 16 },
      [1, 1],
    );

    this._computeBGL = device.createBindGroupLayout({
      entries: [
        this._storageEntry(21),
        this._storageEntry(22),
        this._storageEntry(23),
        this._storageEntry(24),
        this._storageEntry(25),
        this._storageEntry(26),
        this._storageEntry(27),
        { binding: 28, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        {
          binding: 29,
          visibility: GPUShaderStage.COMPUTE,
          texture: { viewDimension: "2d", sampleType: "depth" },
        },
        {
          binding: 30,
          visibility: GPUShaderStage.COMPUTE,
          texture: { viewDimension: "2d", sampleType: "unfilterable-float" },
        },
      ],
    });

    this._drawBGL = device.createBindGroupLayout({
      entries: [
        {
          binding: 21,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 22,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 23,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "read-only-storage" },
        },
      ],
    });

    const host = this._host!;
    this._computeGlobalBGL = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } }],
    });
    this._computeGlobalBindGroup = device.createBindGroup({
      layout: this._computeGlobalBGL,
      entries: [{ binding: 0, resource: { buffer: host.globalUniformBuffer } }],
    });
    const computeLayout = device.createPipelineLayout({
      bindGroupLayouts: [this._computeGlobalBGL, this._computeBGL],
    });
    const module = this._createModule(device, host.particleComputeSource);
    this._emitPipeline = device.createComputePipeline({
      layout: computeLayout,
      compute: { module, entryPoint: "csEmit" },
    });
    this._simulatePipeline = device.createComputePipeline({
      layout: computeLayout,
      compute: { module, entryPoint: "csSimulate" },
    });
    this._preparePipeline = device.createComputePipeline({
      layout: computeLayout,
      compute: { module, entryPoint: "csPrepareIndirect" },
    });

    this._boundDepthView = undefined;
    this._boundNormalView = undefined;
    this._bindCollisionViews(host);
  }

  private _storageEntry(binding: number): GPUBindGroupLayoutEntry {
    return {
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: "storage" },
    };
  }

  private _createStorage(device: GPUDevice, size: number, extraUsage = 0): GPUBuffer {
    return device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | extraUsage });
  }

  private _createModule(device: GPUDevice, source: string): GPUShaderModule {
    return device.createShaderModule({ code: source });
  }

  /** Rebuilds the parity bind-group pair when the frame-live depth/normal views changed -- bind
   * groups pin views, never their contents, so a stable view is safe to keep across frames, but
   * a rotated view (resize / offscreen toggle) must be re-pinned. Both parity variants carry the
   * same (new) views. */
  private _bindCollisionViews(host: GpuParticlePassHost): void {
    const depth = host.activeDepthView;
    const normal = host.activeNormalView ?? this._fallbackNormalView;
    if (
      depth === this._boundDepthView &&
      normal === this._boundNormalView &&
      this._computeBindGroups[0] !== undefined
    ) {
      return;
    }
    this._buildParityBindGroups(depth, normal);
    this._boundDepthView = depth;
    this._boundNormalView = normal;
  }

  private _buildParityBindGroups(depth: GPUTextureView, normal: GPUTextureView): void {
    const device = this._device!;
    for (let p = 0; p < 2; p++) {
      this._computeBindGroups[p] = device.createBindGroup({
        layout: this._computeBGL,
        entries: [
          { binding: 21, resource: { buffer: this._positionsBuffer } },
          { binding: 22, resource: { buffer: this._velocitiesBuffer } },
          { binding: 23, resource: { buffer: this._colorsBuffer } },
          { binding: 24, resource: { buffer: this._deadIndicesBuffer } },
          { binding: 25, resource: { buffer: this._aliveBuffers[p]! } },
          { binding: 26, resource: { buffer: this._aliveBuffers[1 - p]! } },
          { binding: 27, resource: { buffer: this._countersBuffer } },
          { binding: 28, resource: { buffer: this._paramsBuffer } },
          { binding: 29, resource: depth },
          { binding: 30, resource: normal },
        ],
      });
      this._drawBindGroups[p] = device.createBindGroup({
        layout: this._drawBGL,
        entries: [
          { binding: 21, resource: { buffer: this._positionsBuffer } },
          { binding: 22, resource: { buffer: this._colorsBuffer } },
          { binding: 23, resource: { buffer: this._aliveBuffers[1 - p]! } },
        ],
      });
    }
  }

  /** Creates the draw pipeline for a given color-target format (cached per format -- the HDR
   * post-processing target and the canvas/offscreen target formats can differ). */
  private _createDrawPipeline(
    device: GPUDevice,
    host: GpuParticlePassHost,
    format: GPUTextureFormat,
  ): GPURenderPipeline {
    const layout = device.createPipelineLayout({
      bindGroupLayouts: [host.globalBGL, this._drawBGL],
    });
    return device.createRenderPipeline({
      layout,
      vertex: {
        module: this._createModule(device, host.particleDrawSource),
        entryPoint: "vsParticle",
      },
      fragment: {
        module: this._createModule(device, host.particleDrawSource),
        entryPoint: "fsParticle",
        targets: [
          // Additive composite of premultiplied output (src=1, dst=1): `dst + src.rgba`.
          {
            format,
            blend: {
              color: { srcFactor: "one", dstFactor: "one", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
            },
            writeMask: GPUColorWrite.ALL,
          },
        ],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: {
        format: "depth32float",
        depthWriteEnabled: false,
        depthCompare: "less-equal",
      },
      // The engine renders all targets at sampleCount 1 (no MSAA render targets), so no
      // multisample state is needed -- pipeline keying on color format alone is sound.
    });
  }
}
